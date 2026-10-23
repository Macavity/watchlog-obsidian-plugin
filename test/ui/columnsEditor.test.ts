import { describe, it, expect } from 'vitest';
import { cloneColumns, moveColumn, normalizeColumns, validateColumns } from '../../src/ui/ColumnsEditor';
import type { CustomListColumn } from '../../src/types';

const col = (over: Partial<CustomListColumn> = {}): CustomListColumn => ({
	id: 'c1', label: 'A', type: 'text', bold: false, italic: false, ...over,
});

describe('cloneColumns', () => {
	it('copies options and colours so the source stays untouched', () => {
		const src = [col({ type: 'select', options: ['x'], optionColors: { x: '#fff' } })];
		const copy = cloneColumns(src);
		copy[0]!.options!.push('y');
		copy[0]!.optionColors!['y'] = '#000';
		expect(src[0]!.options).toEqual(['x']);
		expect(src[0]!.optionColors).toEqual({ x: '#fff' });
	});
});

describe('moveColumn', () => {
	const ids = (cols: CustomListColumn[]): string => cols.map(c => c.id).join('');
	const mk = (): CustomListColumn[] => ['a', 'b', 'c'].map(id => col({ id }));
	it('moves forward to a drop slot', () => {
		const cols = mk();
		moveColumn(cols, 0, 2);
		expect(ids(cols)).toBe('bac');
	});
	it('moves backward', () => {
		const cols = mk();
		moveColumn(cols, 2, 0);
		expect(ids(cols)).toBe('cab');
	});
});

describe('validateColumns', () => {
	it('accepts valid columns', () => {
		expect(validateColumns([col(), col({ type: 'select', options: ['x'] })])).toBeNull();
	});
	it('rejects blank labels', () => {
		expect(validateColumns([col({ label: '  ' })])).toBe('Column names cannot be empty.');
	});
	it('rejects select without options', () => {
		expect(validateColumns([col({ type: 'select', options: [] })]))
			.toBe('Column "A" must have at least one option.');
	});
});

describe('normalizeColumns', () => {
	it('trims labels and options and drops stale colours', () => {
		const cols = [col({ label: ' A ', type: 'select', options: [' x ', ' '], optionColors: { x: '#fff', gone: '#000' } })];
		normalizeColumns(cols);
		expect(cols[0]!.label).toBe('A');
		expect(cols[0]!.options).toEqual(['x']);
		expect(cols[0]!.optionColors).toEqual({ x: '#fff' });
	});
	it('removes colours from non-select columns', () => {
		const cols = [col({ optionColors: { x: '#fff' } })];
		normalizeColumns(cols);
		expect(cols[0]!.optionColors).toBeUndefined();
	});
});
