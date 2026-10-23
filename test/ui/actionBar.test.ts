import { describe, it, expect, vi } from 'vitest';
import { renderMoveToGroupSelect } from '../../src/ui/ActionBar';
import { El } from '../helpers/fakeEl';

function openInlineInput(onCreate: (name: string) => Promise<void>) {
	const bar = new El('root');
	const onMove = vi.fn(() => Promise.resolve());
	const onCancel = vi.fn();
	renderMoveToGroupSelect(bar as unknown as HTMLElement, {
		groups: [{ id: 'g1', name: 'Favorites' }],
		disabled: false,
		onMove,
		onCreate,
		onCancel,
	});
	const select = bar.find('wl-select')!;
	select.value = '__new__';
	select.fire('change');
	const input = bar.find('wl-group-name-input')!;
	const confirm = bar.children.find((c) => c.text === '✓')!;
	return { bar, select, input, confirm, onMove, onCancel };
}

describe('renderMoveToGroupSelect', () => {
	it('moves into an existing group and resets the select', async () => {
		const bar = new El('root');
		const onMove = vi.fn(() => Promise.resolve());
		renderMoveToGroupSelect(bar as unknown as HTMLElement, {
			groups: [{ id: 'g1', name: 'Favorites' }], disabled: false, onMove, onCreate: vi.fn(), onCancel: vi.fn(),
		});
		const select = bar.find('wl-select')!;
		select.value = 'g1';
		select.fire('change');
		await Promise.resolve();
		expect(onMove).toHaveBeenCalledWith('g1');
		expect(select.value).toBe('');
	});

	it('swaps the select for the inline input and creates once per name', async () => {
		const onCreate = vi.fn(() => Promise.resolve());
		const { select, input, confirm } = openInlineInput(onCreate);
		expect(select.hidden).toBe(true);
		input.value = '  Weekend  ';
		input.fire('keydown', { key: 'Enter' });
		await Promise.resolve();
		expect(onCreate).toHaveBeenCalledWith('Weekend');
		expect(confirm.disabled).toBe(false);
	});

	it('ignores a second create while the first one is still running', async () => {
		let release: () => void = () => {};
		const onCreate = vi.fn(() => new Promise<void>((r) => { release = r; }));
		const { input, confirm } = openInlineInput(onCreate);
		input.value = 'Weekend';
		input.fire('keydown', { key: 'Enter' });
		input.fire('keydown', { key: 'Enter' });
		confirm.fire('click');
		expect(onCreate).toHaveBeenCalledTimes(1);
		expect(confirm.disabled).toBe(true);
		release();
		await Promise.resolve();
		await Promise.resolve();
		expect(confirm.disabled).toBe(false);
	});

	it('ignores empty names and cancels on Escape', () => {
		const onCreate = vi.fn(() => Promise.resolve());
		const { input, onCancel } = openInlineInput(onCreate);
		input.value = '   ';
		input.fire('keydown', { key: 'Enter' });
		expect(onCreate).not.toHaveBeenCalled();
		input.fire('keydown', { key: 'Escape' });
		expect(onCancel).toHaveBeenCalledTimes(1);
	});
});
