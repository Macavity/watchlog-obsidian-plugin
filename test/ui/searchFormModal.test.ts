import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SearchFormModal, type SearchPickerOptions } from '../../src/ui/SearchFormModal';
import { El } from '../helpers/fakeEl';

/** Records the hook order and what the picker handed over. */
class StubModal extends SearchFormModal<string> {
	log: string[] = [];
	pending: Array<(v: string[]) => void> = [];
	selections: Array<{ result: string; isCurrent: () => boolean }> = [];
	type = 'Anime';

	constructor() {
		super({}, 'Add thing', ['wl-add-modal']);
	}
	protected pickerOptions(): SearchPickerOptions<string> {
		return {
			placeholder: 'Search...',
			debounceMs: 50,
			typeSelect: { names: ['Anime', 'Movie'], selected: this.type, onChange: (v) => { this.type = v; this.renderForm(); } },
		};
	}
	protected search(query: string): Promise<string[]> {
		this.log.push(`search:${query}`);
		return new Promise((r) => { this.pending.push(r); });
	}
	protected noApiMessage(): string | null { return null; }
	protected renderResult(host: HTMLElement, result: string, select: (itemEl: HTMLElement) => void): HTMLElement {
		const item = (host as unknown as El).createDiv({ cls: 'wl-result-item', text: result });
		item.addEventListener('click', () => select(item as unknown as HTMLElement));
		return item as unknown as HTMLElement;
	}
	protected selectResult(result: string, isCurrent: () => boolean): void {
		this.selections.push({ result, isCurrent });
	}
	protected renderForm(): void {
		this.log.push(`renderForm:${this.type}`);
		(this.formEl as unknown as El).empty();
		(this.formEl as unknown as El).createDiv({ cls: 'wl-field', text: this.type });
	}
}

const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

function open() {
	const modal = new StubModal();
	modal.open();
	const content = modal.contentEl as unknown as El;
	const results = content.find('wl-modal-results')!;
	const typeQuery = (q: string): void => {
		const input = content.find('wl-modal-input')!;
		input.value = q;
		input.fire('input');
	};
	return { modal, content, results, typeQuery };
}

describe('SearchFormModal', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('mounts picker then form, in that order, under the heading', () => {
		const { modal, content } = open();
		expect((modal.titleEl as unknown as El).text).toBe('Add thing');
		expect(content.has('wl-add-modal')).toBe(true);
		const classes = content.children.map((c) => [...c.classes][0]);
		expect(classes.indexOf('wl-modal-results')).toBeLessThan(classes.indexOf('wl-modal-form'));
		expect(modal.log).toEqual(['renderForm:Anime']);
	});

	it('hands selections to the subclass with a guard the next selection invalidates', async () => {
		const { modal, results, typeQuery } = open();
		typeQuery('dune');
		vi.advanceTimersByTime(50);
		modal.pending[0]!(['dune-1', 'dune-2']);
		await flush();
		const [a, b] = results.findAll('wl-result-item');
		a!.fire('click');
		expect(modal.selections[0]!.isCurrent()).toBe(true);
		b!.fire('click');
		expect(modal.selections[0]!.isCurrent()).toBe(false);
		expect(modal.selections[1]!.isCurrent()).toBe(true);
		expect(b!.has('is-selected')).toBe(true);
	});

	it('re-renders the form before the picker resets on a type change', async () => {
		const { modal, content, results, typeQuery } = open();
		typeQuery('dune');
		vi.advanceTimersByTime(50);
		modal.pending[0]!(['dune-1']);
		await flush();
		expect(results.findAll('wl-result-item')).toHaveLength(1);
		const select = content.find('wl-select')!;
		select.value = 'Movie';
		select.fire('change');
		expect(modal.log).toEqual(['renderForm:Anime', 'search:dune', 'renderForm:Movie']);
		expect(results.findAll('wl-result-item')).toHaveLength(0);
		expect(content.find('wl-field')!.text).toBe('Movie');
	});

	it('close cancels a pending debounced search', () => {
		const { modal, typeQuery } = open();
		typeQuery('dune');
		modal.close();
		vi.advanceTimersByTime(100);
		expect(modal.log).toEqual(['renderForm:Anime']);
	});
});
