import { afterEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'obsidian';
import { El } from '../helpers/fakeEl';
import { renderHeaderToolbar, renderToolbarWithMobileToggle } from '../../src/MobileToolbar';

const asEl = (e: El): HTMLElement => e as unknown as HTMLElement;
const setMobile = (on: boolean): void => { (Platform as { isMobile: boolean }).isMobile = on; };

function setup(mobile: boolean): { controls: El; addBtn: El; onToggleChange: ReturnType<typeof vi.fn> } {
	setMobile(mobile);
	const controls = new El('root');
	const onToggleChange = vi.fn();
	let addBtn: El | null = null;
	renderToolbarWithMobileToggle({
		controls: asEl(controls),
		renderSearch: (p) => { (p as unknown as El).createDiv({ cls: 'search' }); },
		renderActions: (p) => { (p as unknown as El).createDiv({ cls: 'actions' }); },
		renderAdd: (p) => {
			addBtn = (p as unknown as El).createEl('button', { cls: 'wl-add-btn', text: '+ add' });
			return addBtn as unknown as HTMLButtonElement;
		},
		expanded: false,
		onToggleChange,
	});
	return { controls, addBtn: addBtn as unknown as El, onToggleChange };
}

afterEach(() => setMobile(false));

describe('renderToolbarWithMobileToggle', () => {
	it('mobile: add button sits outside the fading panes, as an icon with the old text as label', () => {
		const { controls, addBtn } = setup(true);
		expect(controls.children.map((c) => (c === addBtn ? 'add' : [...c.classes][0])))
			.toEqual(['wl-toolbar-slot', 'add', 'wl-btn']);
		expect(controls.find('wl-toolbar-slot')!.find('wl-add-btn')).toBeUndefined();
		expect(addBtn.has('wl-toolbar-add-btn')).toBe(true);
		expect(addBtn.attr['aria-label']).toBe('+ add');
		expect(addBtn.attr['data-icon']).toBe('plus');
	});

	it('mobile: toggle shows a filter icon, switches to a search icon on click', () => {
		const { controls, onToggleChange } = setup(true);
		const toggle = controls.find('wl-toolbar-toggle-btn')!;
		expect(toggle.attr['data-icon']).toBe('sliders-horizontal');
		expect(toggle.attr['aria-label']).toBe('Show filters and actions');
		toggle.fire('click');
		expect(toggle.attr['data-icon']).toBe('search');
		expect(toggle.attr['aria-label']).toBe('Show search');
		expect(onToggleChange).toHaveBeenCalledWith(true);
	});

	it('desktop: search, actions, add inline in order; add keeps its text', () => {
		const { controls, addBtn } = setup(false);
		expect(controls.children.map((c) => [...c.classes][0])).toEqual(['search', 'actions', 'wl-add-btn']);
		expect(controls.find('wl-toolbar-toggle-btn')).toBeUndefined();
		expect(addBtn.text).toBe('+ add');
		expect(addBtn.has('wl-toolbar-add-btn')).toBe(false);
	});
});

describe('renderHeaderToolbar', () => {
	it('builds controls with an actions wrap and an add button that calls onAdd', () => {
		const header = new El('root');
		const onAdd = vi.fn();
		let actionsWrap: El | null = null;
		renderHeaderToolbar(asEl(header), {
			renderSearch: () => {},
			renderActions: (wrap) => { actionsWrap = wrap as unknown as El; },
			onAdd,
			expanded: false,
			onToggleChange: () => {},
		});
		const controls = header.find('wl-header-controls')!;
		expect(controls.find('wl-toolbar-actions')).toBe(actionsWrap);
		controls.find('wl-add-btn')!.fire('click');
		expect(onAdd).toHaveBeenCalledOnce();
	});
});
