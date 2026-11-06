import { App, Notice, TFile, setIcon } from 'obsidian';
import { t } from './i18n';

/**
 * The shared "Open note" file-text icon button used by the Watchlist and Reading detail modals.
 * Callers resolve their own `.md` target (paths differ per tab) and pass it here; this only renders
 * the icon and wires open-on-click with graceful failure.
 *
 * @param target The resolved note as a `TFile`, or a vault path to look up.
 * @param onOpen Optional callback after a successful open (e.g. close the modal).
 */
export function appendNoteLinkButton(
	app: App,
	parent: HTMLElement,
	target: TFile | string,
	onOpen?: () => void,
): HTMLElement {
	// sizing/alignment come from .wl-acc-link-icon (matches the globe)
	const noteIcon = parent.createSpan({ cls: 'wl-acc-link-icon' });
	setIcon(noteIcon, 'file-text');
	noteIcon.setAttr('aria-label', t('misc.noteLink.open'));
	noteIcon.title = t('misc.noteLink.open');
	noteIcon.addEventListener('click', (e) => {
		e.stopPropagation();
		const file =
			target instanceof TFile ? target : app.vault.getAbstractFileByPath(target);
		if (!(file instanceof TFile)) {
			new Notice(t('misc.noteLink.notFound'));
			return;
		}
		void app.workspace.getLeaf().openFile(file);
		onOpen?.();
	});
	return noteIcon;
}
