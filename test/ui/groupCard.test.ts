import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/CollageUtil', () => ({ renderGroupCollage: vi.fn() }));
vi.mock('../../src/ConfirmModal', () => ({ ConfirmModal: class { open(): void {} } }));
vi.mock('../../src/PosterCard', () => ({ openCardMenu: vi.fn() }));

import { groupCountLabel, groupLetter, renderGroupCard, type GroupCardOptions } from '../../src/ui/GroupCard';
import { renderGroupCollage } from '../../src/CollageUtil';
import { openCardMenu } from '../../src/PosterCard';

/** Minimal element double: only what the group card touches. */
class El {
	children: El[] = [];
	classes = new Set<string>();
	listeners = new Map<string, Array<(e: unknown) => void>>();
	dataset: Record<string, string> = {};
	style: Record<string, string> = {};
	attrs: Record<string, string> = {};
	textContent = '';
	text = '';
	constructor(public tag = 'div', opts: { cls?: string; text?: string } = {}) {
		for (const c of (opts.cls ?? '').split(' ').filter(Boolean)) this.classes.add(c);
		this.text = opts.text ?? '';
	}
	createDiv(opts?: { cls?: string }): El { return this.createEl('div', opts); }
	createSpan(opts?: { cls?: string; text?: string }): El { return this.createEl('span', opts); }
	createEl(tag: string, opts?: { cls?: string; text?: string }): El {
		const el = new El(tag, opts);
		this.children.push(el);
		return el;
	}
	addClass(c: string): void { this.classes.add(c); }
	setAttr(k: string, v: string): void { this.attrs[k] = v; }
	addEventListener(type: string, fn: (e: unknown) => void): void {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
	}
	fire(type: string, e: unknown = { stopPropagation: () => {} }): void {
		for (const fn of this.listeners.get(type) ?? []) fn(e);
	}
	find(cls: string): El | undefined {
		for (const c of this.children) {
			if (c.classes.has(cls)) return c;
			const hit = c.find(cls);
			if (hit) return hit;
		}
		return undefined;
	}
}

const opts = (over: Partial<GroupCardOptions<string>> = {}): GroupCardOptions<string> => ({
	app: {} as never,
	group: { id: 'g1', name: 'zelda' },
	members: ['a', 'b'],
	getCover: (m) => m,
	typeColor: '#123456',
	textUnder: false,
	selected: false,
	unit: 'game',
	container: new El() as unknown as HTMLElement,
	cleanups: [],
	onRename: vi.fn(),
	deleteMessage: 'sure?',
	onDelete: vi.fn(),
	onActivate: vi.fn(),
	...over,
});

describe('group card pure helpers', () => {
	it('groupLetter uppercases the first letter or falls back to ?', () => {
		expect(groupLetter('  zelda')).toBe('Z');
		expect(groupLetter('   ')).toBe('?');
	});

	it('groupCountLabel pluralizes', () => {
		expect(groupCountLabel(1, 'title')).toBe('1 title');
		expect(groupCountLabel(0, 'title')).toBe('0 titles');
		expect(groupCountLabel(3, 'game')).toBe('3 games');
	});
});

describe('renderGroupCard', () => {
	it('overlay mode: card in parent, overlay text, count badge, select class', () => {
		const parent = new El();
		renderGroupCard(parent as unknown as HTMLElement, opts({ selected: true }));
		const card = parent.children[0]!;
		expect(card.classes.has('wl-card-group')).toBe(true);
		expect(card.classes.has('wl-card-selected')).toBe(true);
		expect(card.dataset.groupId).toBe('g1');
		expect(card.find('wl-card-overlay')).toBeDefined();
		expect(card.find('wl-card-title')!.text).toBe('zelda');
		const badge = card.find('wl-card-type-badge')!;
		expect(badge.textContent).toBe('2 games');
		expect(badge.style.backgroundColor).toBe('#123456');
		expect(vi.mocked(renderGroupCollage)).toHaveBeenCalled();
	});

	it('under mode: wraps in a cell, pins the height on the cell, click is on the cell', () => {
		const parent = new El();
		const o = opts({ textUnder: true, cardHeight: 200 });
		renderGroupCard(parent as unknown as HTMLElement, o);
		const cell = parent.children[0]!;
		expect(cell.classes.has('wl-card-cell')).toBe(true);
		expect(cell.style.height).toBe('200px');
		expect(cell.find('wl-card-under-title')!.text).toBe('zelda');
		cell.fire('click');
		expect(o.onActivate).toHaveBeenCalledWith(cell.children[0]);
	});

	it('menu button opens the card menu with rename and delete entries', () => {
		const parent = new El();
		const o = opts();
		renderGroupCard(parent as unknown as HTMLElement, o);
		const card = parent.children[0]!;
		const stop = vi.fn();
		card.find('wl-card-menu-btn')!.fire('click', { stopPropagation: stop });
		expect(stop).toHaveBeenCalled();
		const items = vi.mocked(openCardMenu).mock.calls[0]![2];
		expect(items.map((i) => i.label)).toEqual(['Edit name', 'Delete group']);
		items[0]!.onClick();
		expect(o.onRename).toHaveBeenCalled();
	});
});
