import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/i18n';
import { ConfirmModal } from '../../src/ConfirmModal';
import type { El } from '../helpers/fakeEl';

afterEach(() => {
	setLocale('en');
});

/** Depth-first search for the first element whose class list contains `cls`. */
function findByClass(root: El, cls: string): El | undefined {
	for (const child of root.children) {
		if (child.classes.has(cls)) return child;
		const hit = findByClass(child, cls);
		if (hit) return hit;
	}
	return undefined;
}

describe('misc modal i18n', () => {
	it('localizes the confirm modal title and confirm button', () => {
		setLocale('de');
		const modal = new ConfirmModal({} as never, 'Eintrag entfernen?', () => {});
		modal.open();
		expect(modal.titleEl.text).toBe('Bist du sicher?');
		expect(findByClass(modal.contentEl, 'wl-btn-danger')?.text).toBe('Bestätigen');
	});
});
