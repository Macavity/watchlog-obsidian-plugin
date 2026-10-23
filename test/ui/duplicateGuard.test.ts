import { describe, it, expect, vi } from 'vitest';
import { blockDuplicate, createDuplicateGuard } from '../../src/ui/DuplicateGuard';
import { El } from '../helpers/fakeEl';

function setup() {
	const content = new El('root');
	const form = content.createDiv({ cls: 'wl-modal-form' });
	const btnRow = form.createDiv({ cls: 'wl-modal-btn-row' });
	const guard = createDuplicateGuard();
	const retry = vi.fn();
	const check = (isDuplicate = true) =>
		blockDuplicate(content as unknown as HTMLElement, guard, { name: 'Dune', isDuplicate, verb: 'Add', retry });
	return { content, form, btnRow, guard, retry, check };
}

describe('blockDuplicate', () => {
	it('passes non-duplicates and resets a pending skip', () => {
		const { guard, check } = setup();
		guard.skip = true;
		expect(check(false)).toBe(false);
		expect(guard.skip).toBe(false);
	});

	it('shows one warning and lets Continue retry once', () => {
		const { btnRow, guard, retry, check } = setup();
		expect(check()).toBe(true);
		expect(check()).toBe(true);
		expect(btnRow.findAll('wl-duplicate-warning')).toHaveLength(1);
		const warn = btnRow.find('wl-duplicate-warning')!;
		expect(warn.children[0]!.text).toBe('"Dune" already exists. Add anyway?');
		warn.children[1]!.fire('click'); // Continue
		expect(retry).toHaveBeenCalledTimes(1);
		expect(guard.skip).toBe(true);
		expect(check()).toBe(false); // the retry passes once
		expect(check()).toBe(true); // and the next save is checked again
	});

	it('shows the warning again after the form was re-rendered', () => {
		const { form, check } = setup();
		expect(check()).toBe(true);
		form.empty(); // a re-render drops the button row and the warning
		const btnRow = form.createDiv({ cls: 'wl-modal-btn-row' });
		expect(check()).toBe(true);
		expect(btnRow.findAll('wl-duplicate-warning')).toHaveLength(1);
	});

	it('Cancel removes the warning without skipping', () => {
		const { btnRow, guard, check } = setup();
		check();
		btnRow.find('wl-duplicate-warning')!.children[2]!.fire('click');
		expect(btnRow.findAll('wl-duplicate-warning')).toHaveLength(0);
		expect(guard.skip).toBe(false);
	});
});
