import { describe, it, expect, vi } from 'vitest';
import {
	buildShelfSelect,
	applySortState,
	renderAddButton,
	sortStateOf,
	renderSelectionButtons,
	renderToolbarCore,
	syncSelectionClasses,
	toggleCardSelected,
} from '../../src/ui/TabToolbar';

/** Minimal element double: only what TabToolbar touches. */
class El {
	children: El[] = [];
	classes = new Set<string>();
	listeners = new Map<string, Array<(e: unknown) => void>>();
	dataset: Record<string, string> = {};
	title = '';
	text = '';
	constructor(public tag = 'div', opts: { cls?: string; text?: string } = {}) {
		for (const c of (opts.cls ?? '').split(' ').filter(Boolean)) this.classes.add(c);
		this.text = opts.text ?? '';
	}
	createDiv(opts?: { cls?: string; text?: string }): El { return this.createEl('div', opts); }
	createEl(tag: string, opts?: { cls?: string; text?: string }): El {
		const el = new El(tag, opts);
		this.children.push(el);
		return el;
	}
	addEventListener(type: string, fn: (e: unknown) => void): void {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
	}
	fire(type: string, e: unknown = { stopPropagation: () => {} }): void {
		for (const fn of this.listeners.get(type) ?? []) fn(e);
	}
	classList = {
		toggle: (c: string, on: boolean): void => { if (on) this.classes.add(c); else this.classes.delete(c); },
	};
	/** Flat list of all descendants (selector matching is faked by the tests). */
	all: El[] = [];
	querySelectorAll(): { forEach: (fn: (el: El) => void) => void } {
		return { forEach: (fn) => this.all.forEach(fn) };
	}
}

const asEl = (e: El): HTMLElement => e as unknown as HTMLElement;
const selected = (e: El): boolean => e.classes.has('wl-card-selected');

describe('renderSelectionButtons', () => {
	const opts = (over: Partial<Parameters<typeof renderSelectionButtons>[1]> = {}) => ({
		selectionMode: false,
		hasSelection: false,
		onToggleAll: vi.fn(),
		onToggleMode: vi.fn(),
		...over,
	});

	it('shows only the Select button outside selection mode', () => {
		const parent = new El();
		const o = opts();
		renderSelectionButtons(asEl(parent), o);
		expect(parent.children.map((c) => c.text)).toEqual(['Select']);
		parent.children[0]!.fire('click');
		expect(o.onToggleMode).toHaveBeenCalledOnce();
	});

	it('adds All and a red Cancel in selection mode', () => {
		const parent = new El();
		const o = opts({ selectionMode: true });
		renderSelectionButtons(asEl(parent), o);
		expect(parent.children.map((c) => c.text)).toEqual(['All', 'Cancel']);
		expect(parent.children[0]!.title).toBe('Select all visible');
		expect(parent.children[1]!.classes.has('wl-btn-cancel')).toBe(true);
		parent.children[0]!.fire('click');
		expect(o.onToggleAll).toHaveBeenCalledOnce();
	});

	it('labels the toggle None while something is selected', () => {
		const parent = new El();
		renderSelectionButtons(asEl(parent), opts({ selectionMode: true, hasSelection: true }));
		expect(parent.children[0]!.text).toBe('None');
		expect(parent.children[0]!.title).toBe('Deselect all');
	});
});

describe('renderToolbarCore', () => {
	const make = (over: Partial<Parameters<typeof renderToolbarCore>[1]> = {}) => {
		const order: string[] = [];
		const onApply = vi.fn();
		const opts = {
			preset: null,
			renderFilters: () => order.push('filters'),
			renderSorting: () => order.push('sorting'),
			selection: { selectionMode: false, hasSelection: false, onToggleAll: vi.fn(), onToggleMode: vi.fn() },
			...over,
		};
		const parent = new El();
		const saved = renderToolbarCore(asEl(parent), opts);
		return { parent, saved, order, onApply };
	};

	it('renders filters, sorting, then the selection button; no saved button without preset', () => {
		const { parent, saved, order } = make();
		expect(saved).toBeNull();
		expect(order).toEqual(['filters', 'sorting']);
		expect(parent.children.map((c) => c.text)).toEqual(['Select']);
	});

	it('renders the saved filter button first and wires it', () => {
		const onApply = vi.fn();
		const { parent, saved } = make({ preset: { active: true, onApply } });
		expect(parent.children[0]).toBe(saved as unknown as El);
		expect(parent.children[0]!.classes.has('wl-btn-preset-active')).toBe(true);
		parent.children[0]!.fire('click');
		expect(onApply).toHaveBeenCalledOnce();
	});

	it('renders the action bar between sorting and the selection buttons', () => {
		const order: string[] = [];
		make({
			renderFilters: () => order.push('filters'),
			renderSorting: () => order.push('sorting'),
			renderActionBar: () => order.push('bar'),
		});
		expect(order).toEqual(['filters', 'sorting', 'bar']);
	});
});

describe('renderAddButton', () => {
	it('wraps the button and stops click propagation', () => {
		const parent = new El();
		const onClick = vi.fn();
		const btn = renderAddButton(asEl(parent), onClick) as unknown as El;
		expect(parent.children[0]!.classes.has('wl-add-btn-wrap')).toBe(true);
		const stop = vi.fn();
		btn.fire('click', { stopPropagation: stop });
		expect(stop).toHaveBeenCalledOnce();
		expect(onClick).toHaveBeenCalledOnce();
	});
});

describe('buildShelfSelect', () => {
	it('is undefined outside selection mode', () => {
		expect(buildShelfSelect(false, ['a'], new Set(), [], vi.fn())).toBeUndefined();
	});

	it('adds/removes ids, repaints and registers refreshers', () => {
		const set = new Set(['x']);
		const refreshers: Array<() => void> = [];
		const after = vi.fn();
		const spec = buildShelfSelect(true, ['a', 'b'], set, refreshers, after)!;
		spec.onToggle(['a', 'b'], true);
		expect([...set].sort()).toEqual(['a', 'b', 'x']);
		spec.onToggle(['a'], false);
		expect([...set].sort()).toEqual(['b', 'x']);
		expect(after).toHaveBeenCalledTimes(2);
		const refresh = vi.fn();
		spec.register!(refresh);
		expect(refreshers).toEqual([refresh]);
	});
});

describe('selection class helpers', () => {
	it('syncSelectionClasses mirrors the set onto cards via idOf', () => {
		const container = new El();
		const a = new El(); a.dataset.id = 'a';
		const b = new El(); b.dataset.id = 'b';
		const c = new El();
		container.all = [a, b, c];
		syncSelectionClasses(asEl(container), new Set(['a']), (card) => (card as unknown as El).dataset.id);
		expect([selected(a), selected(b), selected(c)]).toEqual([true, false, false]);
	});

	it('toggleCardSelected flips the set and every matching card', () => {
		const container = new El();
		const card = new El();
		container.all = [card];
		const set = new Set<string>();
		expect(toggleCardSelected(asEl(container), set, 'a', '.x')).toBe(true);
		expect(set.has('a')).toBe(true);
		expect(selected(card)).toBe(true);
		expect(toggleCardSelected(asEl(container), set, 'a', '.x')).toBe(false);
		expect(set.has('a')).toBe(false);
		expect(selected(card)).toBe(false);
	});
});

describe('sort fields', () => {
	const fields = () => ({
		filterSort: 'dateAdded',
		filterSortDir: 'desc' as const,
		filterSecondSort: 'none',
		filterSecondSortDir: 'asc' as const,
	});

	it('sortStateOf reads primary and secondary', () => {
		expect(sortStateOf(fields())).toEqual({
			primary: { key: 'dateAdded', dir: 'desc' },
			secondary: { key: 'none', dir: 'asc' },
		});
	});

	it('applySortState writes all four fields incl. directions', () => {
		const f = fields();
		applySortState(f, { key: 'rating', dir: 'asc' }, { key: 'title', dir: 'desc' });
		expect(f).toEqual({
			filterSort: 'rating',
			filterSortDir: 'asc',
			filterSecondSort: 'title',
			filterSecondSortDir: 'desc',
		});
		expect(sortStateOf(f).secondary).toEqual({ key: 'title', dir: 'desc' });
	});
});
