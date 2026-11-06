import { afterEach, describe, expect, it, vi } from 'vitest';
import { Notice } from 'obsidian';
import { CsvModalBase, type CsvImportRow } from '../src/CsvModalBase';
import { setLocale } from '../src/i18n';
import { El } from './helpers/fakeEl';

afterEach(() => {
	setLocale('en');
	Notice.shown = [];
	vi.restoreAllMocks();
});

type Entry = { title?: string };
type Harness = {
	importInChunks: CsvModalBase<Entry>['importInChunks'];
	finishImportUi: CsvModalBase<Entry>['finishImportUi'];
	importCancelled: boolean;
	importFailed: boolean;
	cancelBtn: El;
	progressText: El;
	close: () => void;
};

/** A bare CsvModalBase with only the fields the import loop and its finish step touch. */
function harness(): Harness {
	const h = Object.create(CsvModalBase.prototype) as Harness;
	h.importCancelled = false;
	h.importFailed = false;
	h.cancelBtn = new El('button');
	h.cancelBtn.disabled = true;
	h.progressText = new El('span');
	h.close = vi.fn();
	return h;
}

function rows(n: number): CsvImportRow<Entry>[] {
	return Array.from({ length: n }, (_, i) => ({ entry: { title: `T${i}` }, isDuplicate: false, selected: true, rawRating: '' }));
}

describe('csv import failure handling', () => {
	it('keeps the rows stored before a failing batch and marks the import as failed', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const h = harness();
		const batches: number[] = [];
		const added = await h.importInChunks(rows(120), (r) => r.entry, async (chunk) => {
			batches.push(chunk.length);
			if (batches.length === 2) throw new Error('vault write failed');
		});
		expect(batches.length).toBe(2);
		expect(added).toBe(batches[0]);
		expect(h.importFailed).toBe(true);
	});

	it('reports a partial import and re-enables the close button after a failure', () => {
		const h = harness();
		h.importFailed = true;
		h.finishImportUi(50, 120, { cancelled: 'c', done: 'd' });
		expect(h.progressText.text).toContain('50');
		expect(h.progressText.text).toContain('120');
		expect(h.cancelBtn.disabled).toBe(false);
		expect(Notice.shown).toHaveLength(1);
		expect(Notice.shown[0]).toContain('50');
		expect(h.close).not.toHaveBeenCalled();
	});
});
