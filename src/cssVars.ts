import {
  ComponentInternalInstance,
  Fragment,
  getCurrentInstance,
  onBeforeUpdate,
  onMounted,
  onUpdated,
  queuePostFlushCb,
  VNode,
  warn,
  watch,
} from '@vue/runtime-core';
import {
  EMPTY_OBJ,
  getEscapedCssVarName,
  isString,
  normalizeCssVarValue,
  NOOP,
  ShapeFlags,
} from '@vue/shared';

import { NSVElement } from './dom';

// last value written per variable, so unchanged values skip the restyle
const appliedCssVars = new WeakMap<NSVElement, Map<string, string>>();

/**
 * Runtime half of `v-bind()` in SFC `<style>` blocks; the SFC compiler
 * injects the call. The variables are set as unscoped css variables on the
 * component's root views, where `var()` resolves them for the views and
 * their descendants.
 */
export function useCssVars(getter: (ctx: any) => Record<string, unknown>) {
  const instance = getCurrentInstance();
  if (!instance) {
    if (__DEV__) {
      warn(`useCssVars is called without current active component instance.`);
    }
    return;
  }

  const trackedChildren = new WeakSet<ComponentInternalInstance>();
  // a child re-rendering its own root needs the variables again
  const trackChild = (child: ComponentInternalInstance) => {
    if (!trackedChildren.has(child)) {
      trackedChildren.add(child);
      onUpdated(() => queuePostFlushCb(setVars), child);
    }
  };
  const setVars = () => {
    setVarsOnVNode(instance.subTree, getter(instance.proxy), trackChild);
  };

  onBeforeUpdate(() => {
    queuePostFlushCb(setVars);
  });
  onMounted(() => {
    watch(setVars, NOOP, { flush: 'post' });
  });
}

function setVarsOnVNode(
  vnode: VNode,
  vars: Record<string, unknown>,
  trackChild: (child: ComponentInternalInstance) => void,
) {
  while (vnode.component) {
    trackChild(vnode.component);
    vnode = vnode.component.subTree;
  }

  if (vnode.shapeFlag & ShapeFlags.ELEMENT && vnode.el) {
    setVarsOnNode(vnode.el as NSVElement, vars);
  } else if (vnode.type === Fragment) {
    (vnode.children as VNode[]).forEach((child) =>
      setVarsOnVNode(child, vars, trackChild),
    );
  }
}

function setVarsOnNode(el: NSVElement, vars: Record<string, unknown>) {
  const view = el.nativeView;
  const style = view.style;
  if (typeof style?.setUnscopedCssVariable !== 'function') {
    return;
  }

  let applied = appliedCssVars.get(el);
  if (!applied) {
    appliedCssVars.set(el, (applied = new Map()));
  }

  let changed = false;
  for (const key in vars) {
    const raw = vars[key];
    // core applies blank values literally; the DOM unsets the declaration
    const value =
      isString(raw) && !raw.trim() ? 'unset' : normalizeCssVarValue(raw);
    // stylesheets keep expression keys escaped: --id-theme\.size
    const names = [`--${key}`, `--${getEscapedCssVarName(key, false)}`];

    for (const name of names) {
      if (applied.get(name) !== value) {
        style.setUnscopedCssVariable(name, value);
        applied.set(name, value);
        changed = true;
      }
    }
  }

  if (changed) {
    view._onCssStateChange();
  }
}

/**
 * Returns the class map of a `<style module>` block, the object templates
 * read as `$style`.
 */
export function useCssModule(name = '$style'): Record<string, string> {
  const instance = getCurrentInstance();
  if (!instance) {
    if (__DEV__) {
      warn(`useCssModule must be called inside setup()`);
    }
    return EMPTY_OBJ;
  }

  const modules = (instance.type as any).__cssModules;
  if (!modules) {
    if (__DEV__) {
      warn(`Current instance does not have CSS modules injected.`);
    }
    return EMPTY_OBJ;
  }

  const mod = modules[name];
  if (!mod) {
    if (__DEV__) {
      warn(`Current instance does not have CSS module named "${name}".`);
    }
    return EMPTY_OBJ;
  }

  return mod;
}
