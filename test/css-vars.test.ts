import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileStyle } from '@vue/compiler-sfc';
import {
  defineComponent,
  h,
  nextTick,
  reactive,
  ref,
  registerElement,
  useCssModule,
  useCssVars,
} from '../src';
import { View, ViewBase } from './stubs/nativescript-core';
import { mount } from './helpers';

const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
afterEach(() => warn.mockClear());

const warnings = () => warn.mock.calls.map((c) => String(c[0]));
/** The variable set on the view itself (core would also look in the parents). */
const ownCssVar = (view: any, name: string): string | null =>
  view.style.unscopedCssVariables.get(name) ?? null;

/** The shape the SFC compiler emits for `v-bind()` in `<style>`. */
function withCssVars(
  vars: () => Record<string, unknown>,
  render: () => any = () => h('Label'),
) {
  return defineComponent({
    setup() {
      useCssVars(vars);
      return render;
    },
  });
}

describe('useCssVars', () => {
  it('sets the variables on the root view and updates them', async () => {
    const color = ref('red');
    const { el } = mount(
      withCssVars(
        () => ({ 'abc-color': color.value }),
        () => h('StackLayout', [h('Label')]),
      ),
    );
    expect(ownCssVar(el.nativeView, '--abc-color')).toBe('red');
    expect(ownCssVar(el.nativeView._children[0], '--abc-color')).toBeNull();

    color.value = 'blue';
    await nextTick();
    expect(ownCssVar(el.nativeView, '--abc-color')).toBe('blue');
  });

  it('passes the public instance to the getter', async () => {
    const { el, instance } = mount({
      data: () => ({ color: 'red' }),
      setup() {
        useCssVars((ctx) => ({ 'abc-color': ctx.color }));
      },
      render: () => h('Label'),
    });
    expect(ownCssVar(el.nativeView, '--abc-color')).toBe('red');

    (instance as any).color = 'blue';
    await nextTick();
    expect(ownCssVar(el.nativeView, '--abc-color')).toBe('blue');
  });

  it('registers the escaped name the stylesheet uses for expressions', () => {
    const theme = reactive({ size: 12 });
    const { el } = mount(withCssVars(() => ({ 'abc-theme.size': theme.size })));
    const { code } = compileStyle({
      source: `.a { font-size: v-bind('theme.size'); }`,
      filename: 'A.vue',
      id: 'data-v-abc',
    });
    const referenced = code.match(/var\((--[^)]+)\)/)[1];

    expect(referenced).toBe('--abc-theme\\.size');
    expect(ownCssVar(el.nativeView, referenced)).toBe('12');
    expect(ownCssVar(el.nativeView, '--abc-theme.size')).toBe('12');
  });

  it('maps blank values to unset and nullish values to initial', () => {
    const { el } = mount(
      withCssVars(() => ({
        'abc-empty': '',
        'abc-blank': '  ',
        'abc-null': null,
        'abc-undefined': undefined,
        'abc-number': 0,
      })),
    );
    expect(ownCssVar(el.nativeView, '--abc-empty')).toBe('unset');
    expect(ownCssVar(el.nativeView, '--abc-blank')).toBe('unset');
    expect(ownCssVar(el.nativeView, '--abc-null')).toBe('initial');
    expect(ownCssVar(el.nativeView, '--abc-undefined')).toBe('initial');
    expect(ownCssVar(el.nativeView, '--abc-number')).toBe('0');
  });

  it('restyles once per change and not when nothing changed', async () => {
    const restyleOnMount = vi.spyOn(ViewBase.prototype, '_onCssStateChange');
    const color = ref('red');
    const size = ref(12);
    const text = ref('a');
    const { el } = mount(
      withCssVars(
        () => ({ 'abc-color': color.value, 'abc-theme.size': size.value }),
        () => h('Label', { text: text.value }),
      ),
    );
    expect(restyleOnMount).toHaveBeenCalledTimes(1);
    restyleOnMount.mockRestore();

    const restyle = vi.spyOn(el.nativeView, '_onCssStateChange');
    text.value = 'b';
    await nextTick();
    expect(restyle).not.toHaveBeenCalled();

    color.value = 'blue';
    text.value = 'c';
    await nextTick();
    expect(restyle).toHaveBeenCalledTimes(1);

    // several values changed in one tick: still one restyle
    color.value = 'green';
    size.value = 14;
    await nextTick();
    expect(restyle).toHaveBeenCalledTimes(2);
    expect(ownCssVar(el.nativeView, '--abc-theme\\.size')).toBe('14');
  });

  it('writes a changed value to the new root, not the replaced one', async () => {
    const color = ref('red');
    const alt = ref(false);
    const { root } = mount(
      withCssVars(
        () => ({ 'abc-color': color.value }),
        () => (alt.value ? h('Button') : h('Label')),
      ),
    );
    const oldView = root.el.nativeView;
    const restyleOld = vi.spyOn(oldView, '_onCssStateChange');

    color.value = 'blue';
    alt.value = true;
    await nextTick();
    expect(root.el.tagName).toBe('button');
    expect(ownCssVar(root.el.nativeView, '--abc-color')).toBe('blue');
    expect(ownCssVar(oldView, '--abc-color')).toBe('red');
    expect(restyleOld).not.toHaveBeenCalled();
  });

  it('keeps the variables when the style prop changes', async () => {
    const style = ref<Record<string, any>>({ color: 'red' });
    const { el } = mount(
      withCssVars(
        () => ({ 'abc-size': 12 }),
        () => h('Label', { style: style.value }),
      ),
    );

    style.value = { fontSize: 10 };
    await nextTick();
    expect(el.nativeView.style.color).toBeUndefined();
    expect(ownCssVar(el.nativeView, '--abc-size')).toBe('12');
  });

  it('sets the variables on every root of a fragment', () => {
    const Comp = withCssVars(
      () => ({ 'abc-color': 'red' }),
      () => [h('Label'), h('Button')],
    );
    const { el } = mount({ render: () => h('StackLayout', [h(Comp)]) });

    expect(ownCssVar(el.nativeView, '--abc-color')).toBeNull();
    expect(
      el.nativeView._children.map((v: View) => ownCssVar(v, '--abc-color')),
    ).toEqual(['red', 'red']);
  });

  it('applies to a root that appears after mount', async () => {
    const show = ref(false);
    const Comp = withCssVars(
      () => ({ 'abc-color': 'red' }),
      () => (show.value ? h('Label') : null),
    );
    const { el } = mount({ render: () => h('StackLayout', [h(Comp)]) });
    expect(el.nativeView._children).toEqual([]);

    show.value = true;
    await nextTick();
    expect(ownCssVar(el.nativeView._children[0], '--abc-color')).toBe('red');
  });

  it('keeps parent and child variables on a shared root', async () => {
    const color = ref('red');
    const size = ref(12);
    const Child = withCssVars(() => ({ 'child-size': size.value }));
    const { el } = mount(
      withCssVars(
        () => ({ 'parent-color': color.value }),
        () => h(Child),
      ),
    );
    expect(ownCssVar(el.nativeView, '--parent-color')).toBe('red');
    expect(ownCssVar(el.nativeView, '--child-size')).toBe('12');

    color.value = 'blue';
    await nextTick();
    expect(ownCssVar(el.nativeView, '--parent-color')).toBe('blue');
    expect(ownCssVar(el.nativeView, '--child-size')).toBe('12');

    size.value = 14;
    await nextTick();
    expect(ownCssVar(el.nativeView, '--parent-color')).toBe('blue');
    expect(ownCssVar(el.nativeView, '--child-size')).toBe('14');
  });

  it('reapplies when a child component replaces the shared root', async () => {
    const alt = ref(false);
    const Child = defineComponent({
      setup: () => () => (alt.value ? h('Button') : h('Label')),
    });
    const { root } = mount(
      withCssVars(
        () => ({ 'abc-color': 'red' }),
        () => h(Child),
      ),
    );

    alt.value = true;
    await nextTick();
    expect(root.el.tagName).toBe('button');
    expect(ownCssVar(root.el.nativeView, '--abc-color')).toBe('red');
  });

  it('skips views without the css variable api', () => {
    class PlainStyleView extends View {
      style: any = {};
    }
    registerElement('PlainStyleView', () => PlainStyleView);

    const { el } = mount(
      withCssVars(
        () => ({ 'abc-color': 'red' }),
        () => h('PlainStyleView'),
      ),
    );
    expect(el.nativeView.style).toEqual({});
  });

  it('warns outside of a component', () => {
    useCssVars(() => ({ 'abc-color': 'red' }));
    expect(warnings()).toEqual([
      expect.stringMatching(/useCssVars is called without current active/),
    ]);
  });
});

describe('useCssModule', () => {
  const modules = {
    $style: { title: '_title_1' },
    named: { title: '_title_2' },
  };

  it('returns the class map templates read as $style', () => {
    let classes: Record<string, string>;
    let named: Record<string, string>;
    const { instance } = mount({
      __cssModules: modules,
      setup() {
        classes = useCssModule();
        named = useCssModule('named');
      },
      render: () => h('Label'),
    } as any);

    expect(classes).toBe(modules.$style);
    expect(named).toBe(modules.named);
    expect((instance as any).$style).toBe(classes);
    expect(warnings()).toEqual([]);
  });

  it('warns and returns an empty object when a module is missing', () => {
    let missing: Record<string, string>;
    let missingNamed: Record<string, string>;
    mount({
      setup() {
        missing = useCssModule();
      },
      render: () => h('Label'),
    });
    mount({
      __cssModules: modules,
      setup() {
        missingNamed = useCssModule('other');
      },
      render: () => h('Label'),
    } as any);

    expect(missing).toEqual({});
    expect(missingNamed).toEqual({});
    expect(warnings()).toEqual([
      expect.stringMatching(/does not have CSS modules injected/),
      expect.stringMatching(/does not have CSS module named "other"/),
    ]);
  });

  it('warns outside of setup', () => {
    expect(useCssModule()).toEqual({});
    expect(warnings()).toEqual([
      expect.stringMatching(/useCssModule must be called inside setup\(\)/),
    ]);
  });
});
