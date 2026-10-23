import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSearchPicker, type SearchPickerConfig } from '../../src/ui/SearchPicker';

/** Minimal element double: only what SearchPicker touches. */
class El {
	children: El[] = [];
	classes = new Set<string>();
	listeners = new Map<string, Array<() => void>>();
	dataset: Record<string, string> = {};
	text = '';
	value = '';
	disabled = false;
	attr: Record<string, string> = {};
	scrolled = false;

	constructor(public tag = 'div', opts: { cls?: string; text?: string; attr?: Record<string, string> } = {}) {
		for (const c of (opts.cls ?? '').split(' ').filter(Boolean)) this.classes.add(c);
		this.text = opts.text ?? '';
		this.attr = opts.attr ?? {};
	}
	createDiv(opts?: { cls?: string; text?: string }): El { return this.createEl('div', opts); }
	createSpan(opts?: { cls?: string; text?: string }): El { return this.createEl('span', opts); }
	createEl(tag: string, opts?: { cls?: string; text?: string; attr?: Record<string, string> }): El {
		const el = new El(tag, opts);
		this.children.push(el);
		return el;
	}
	addEventListener(type: string, fn: () => void): void {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
	}
	fire(type: string): void { for (const fn of this.listeners.get(type) ?? []) fn(); }
	empty(): void { this.children = []; }
	addClass(c: string): void { this.classes.add(c); }
	removeClass(c: string): void { this.classes.delete(c); }
	scrollTo(): void { this.scrolled = true; }
	has(c: string): boolean { return this.classes.has(c); }
	find(c: string): El | undefined {
		for (const child of this.children) {
			if (child.has(c)) return child;
			const hit = child.find(c);
			if (hit) return hit;
		}
		return undefined;
	}
	findAll(c: string): El[] {
		return this.children.flatMap((ch) => [...(ch.has(c) ? [ch] : []), ...ch.findAll(c)]);
	}
}

const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

function setup(over: Partial<SearchPickerConfig<string>> = {}) {
	const search = vi.fn((q: string) => Promise.resolve([`${q}-1`, `${q}-2`, `${q}-3`]));
	const onSelect = vi.fn();
	const picker = createSearchPicker<string>({
		placeholder: 'Search...',
		search,
		noApiMessage: () => null,
		renderResult: (host, result, select) => {
			const item = (host as unknown as El).createDiv({ cls: 'wl-result-item', text: result });
			item.addEventListener('click', () => select(item as unknown as HTMLElement));
			return item as unknown as HTMLElement;
		},
		onSelect,
		pageSize: 2,
		withYear: true,
		...over,
	});
	const root = new El();
	picker.mount(root as unknown as HTMLElement);
	const results = root.find('wl-modal-results')!;
	const pager = root.find('wl-result-pager');
	const type = (q: string): void => {
		const input = root.find('wl-search-query')!;
		input.value = q;
		input.fire('input');
	};
	return { picker, root, results, pager, search, onSelect, type };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('SearchPicker', () => {
	it('mounts the stacked search row with year, results and pager', () => {
		const { root, pager } = setup();
		const row = root.find('wl-search-row')!;
		expect(row.find('wl-search-fields')!.find('wl-search-year')).toBeDefined();
		expect(pager).toBeDefined();
	});

	it('mounts the plain row without year and pager', () => {
		const { root, pager } = setup({ withYear: false, pageSize: undefined, grid: true });
		expect(root.find('wl-search-row')).toBeUndefined();
		expect(root.find('wl-search-year')).toBeUndefined();
		expect(pager).toBeUndefined();
		expect(root.find('wl-results-grid')).toBeDefined();
	});

	it('debounces typing by 600ms and searches', async () => {
		const { type, search, results } = setup();
		type('a');
		type('ab');
		vi.advanceTimersByTime(599);
		expect(search).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		await flush();
		expect(search).toHaveBeenCalledTimes(1);
		expect(search).toHaveBeenCalledWith('ab', '');
		expect(results.findAll('wl-result-item')).toHaveLength(2);
	});

	it('honors debounceMs and destroy cancels the pending search', () => {
		const { type, search, picker } = setup({ debounceMs: 100 });
		type('a');
		picker.destroy();
		vi.advanceTimersByTime(1000);
		expect(search).not.toHaveBeenCalled();
	});

	it('strips non-digits from the year and passes it on', async () => {
		const { root, type, search } = setup();
		const year = root.find('wl-search-year')!;
		year.value = '19x9';
		year.fire('input');
		expect(year.value).toBe('199');
		type('q');
		vi.advanceTimersByTime(600);
		await flush();
		expect(search).toHaveBeenCalledWith('q', '199');
	});

	it('ignores empty queries', async () => {
		const { picker, search } = setup();
		await picker.search();
		expect(search).not.toHaveBeenCalled();
	});

	it('shows the loading state while searching', async () => {
		let resolve: (v: string[]) => void = () => {};
		const { picker, results, type } = setup({ search: () => new Promise((r) => { resolve = r; }) });
		type('q');
		const run = picker.search();
		expect(results.find('wl-modal-loading')).toBeDefined();
		resolve(['x']);
		await run;
		expect(results.find('wl-modal-loading')).toBeUndefined();
		expect(results.findAll('wl-result-item')).toHaveLength(1);
	});

	it('pages through results', async () => {
		const { picker, results, pager, type } = setup();
		type('q');
		await picker.search();
		const info = (): string => pager!.find('wl-result-pager-info')!.text;
		expect(info()).toBe('Page 1 of 2');
		const [prev, next] = pager!.findAll('wl-result-pager-btn');
		expect(prev!.disabled).toBe(true);
		next!.fire('click');
		expect(info()).toBe('Page 2 of 2');
		expect(results.findAll('wl-result-item').map((e) => [e.text, e.dataset['idx']])).toEqual([['q-3', '2']]);
		expect(results.scrolled).toBe(true);
		expect(pager!.findAll('wl-result-pager-btn')[1]!.disabled).toBe(true);
	});

	it('renders everything without a pageSize', async () => {
		const { picker, results, type } = setup({ pageSize: undefined });
		type('q');
		await picker.search();
		expect(results.findAll('wl-result-item')).toHaveLength(3);
	});

	it('drops stale responses', async () => {
		const pending: Array<(v: string[]) => void> = [];
		const { picker, results, type } = setup({ search: () => new Promise((r) => { pending.push(r); }) });
		type('a');
		const first = picker.search();
		type('b');
		const second = picker.search();
		pending[1]!(['fresh']);
		await second;
		pending[0]!(['stale']);
		await first;
		expect(results.findAll('wl-result-item').map((e) => e.text)).toEqual(['fresh']);
	});

	it('renders the no-API message and skips the search', async () => {
		const { picker, results, search, type } = setup({ noApiMessage: () => 'No key' });
		type('q');
		await picker.search();
		expect(search).not.toHaveBeenCalled();
		const msg = results.find('wl-modal-no-api')!;
		expect(msg.find('wl-modal-no-api-icon')!.text).toBe('ℹ');
		expect(msg.find('wl-modal-no-api-text')!.text).toBe('No key');
		expect(msg.has('wl-modal-api-error')).toBe(false);
	});

	it('renders API errors in the panel', async () => {
		const { picker, results, type } = setup({ search: () => Promise.reject(new Error('boom')) });
		type('q');
		await picker.search();
		const msg = results.find('wl-modal-no-api')!;
		expect(msg.has('wl-modal-api-error')).toBe(true);
		expect(msg.find('wl-modal-no-api-icon')!.text).toBe('⚠');
		expect(results.findAll('wl-result-item')).toHaveLength(0);
	});

	it('reset clears results and messages', async () => {
		const { picker, results, type } = setup({ search: () => Promise.reject(new Error('boom')) });
		type('q');
		await picker.search();
		picker.reset();
		expect(results.children).toHaveLength(0);
	});

	it('highlights the selection and invalidates it on the next search', async () => {
		const { picker, results, onSelect, type } = setup();
		type('q');
		await picker.search();
		const [a, b] = results.findAll('wl-result-item');
		a!.fire('click');
		b!.fire('click');
		expect(a!.has('is-selected')).toBe(false);
		expect(b!.has('is-selected')).toBe(true);
		const [first, second] = onSelect.mock.calls as Array<[string, () => boolean]>;
		expect(first![0]).toBe('q-1');
		expect(first![1]()).toBe(false); // superseded by the second selection
		expect(second![1]()).toBe(true);
		await picker.search();
		expect(second![1]()).toBe(false); // a new search supersedes the selection
	});

	it('seeds the query input from initialQuery', () => {
		const { root } = setup({ initialQuery: 'seed' });
		expect(root.find('wl-search-query')!.value).toBe('seed');
	});
});
