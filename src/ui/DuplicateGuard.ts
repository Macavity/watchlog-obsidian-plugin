/** Per-modal duplicate-warning state. */
export interface DuplicateGuard {
	/** Set by "Continue": the next check passes. */
	skip: boolean;
	warningEl: HTMLElement | null;
}

export function createDuplicateGuard(): DuplicateGuard {
	return { skip: false, warningEl: null };
}

function showWarning(
	guard: DuplicateGuard,
	btnRow: HTMLElement,
	text: string,
	retry: () => void,
): void {
	if (guard.warningEl) return;
	const warn = btnRow.createDiv({ cls: 'wl-duplicate-warning' });
	guard.warningEl = warn;
	warn.createSpan({ text });
	const continueBtn = warn.createEl('button', { cls: 'wl-btn wl-btn-primary', text: 'Continue' });
	const cancelBtn = warn.createEl('button', { cls: 'wl-btn', text: 'Cancel' });
	continueBtn.addEventListener('click', () => {
		guard.skip = true;
		warn.remove();
		guard.warningEl = null;
		retry();
	});
	cancelBtn.addEventListener('click', () => {
		warn.remove();
		guard.warningEl = null;
		guard.skip = false;
	});
}

export interface DuplicateCheck {
	name: string;
	isDuplicate: boolean;
	/** Wording of the confirmation: "<name> already exists. <verb> anyway?" */
	verb: 'Add' | 'Save';
	/** Re-runs the save after "Continue". */
	retry: () => void;
}

/**
 * Returns true when the save must stop because the name is a duplicate and the warning is shown;
 * a pending "Continue" lets the check pass once.
 */
export function blockDuplicate(contentEl: HTMLElement, guard: DuplicateGuard, check: DuplicateCheck): boolean {
	if (!guard.skip && check.isDuplicate) {
		const btnRow = contentEl.querySelector<HTMLElement>('.wl-modal-btn-row');
		if (btnRow) {
			showWarning(guard, btnRow, `"${check.name}" already exists. ${check.verb} anyway?`, check.retry);
		}
		return true;
	}
	guard.skip = false;
	return false;
}
