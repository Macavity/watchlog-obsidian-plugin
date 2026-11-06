import { t } from '../i18n';

/** Heart toggle of the detail modals: active class, tooltip and aria-label follow `fav`. */
export function paintFavoriteButton(btn: HTMLElement, fav: boolean): void {
	btn.toggleClass('is-active', fav);
	const label = fav ? t('detail.favorite.remove') : t('detail.favorite.add');
	btn.title = label;
	btn.setAttr('aria-label', label);
}

/** Click-to-edit heading of the Reading and Games detail modals. */
export function renderEditableTitle(wrap: HTMLElement, text: string, onEdit: () => void): void {
	wrap.empty();
	const el = wrap.createEl('h2', {
		cls: 'wl-reading-detail-title wl-reading-detail-editable-text',
		text,
	});
	el.title = t('detail.clickToEdit');
	el.addEventListener('click', onEdit);
}

/** Header of the group detail modals: group name, member count and a progress block with its bar. */
export function renderGroupDetailHeader(
	parent: HTMLElement,
	opts: { name: string; countText: string; progress: number },
): void {
	const header = parent.createDiv({ cls: 'wl-detail-header' });
	const left = header.createDiv({ cls: 'wl-detail-header-left' });
	left.createEl('h2', { cls: 'wl-detail-title', text: opts.name });
	left.createDiv({ cls: 'wl-detail-group-meta', text: opts.countText });

	const statsBox = header.createDiv({ cls: 'wl-detail-stats-box' });
	const progBlock = statsBox.createDiv({ cls: 'wl-acc-header-right' });
	progBlock.createDiv({ cls: 'wl-acc-percent', text: `${opts.progress}%` });
	progBlock.createDiv({ cls: 'wl-acc-progress-label', text: t('list.stat.progress') });
	const barWrap = progBlock.createDiv({ cls: 'wl-acc-progress-wrap' });
	barWrap.createDiv({ cls: 'wl-progress-bar' }).style.width = `${opts.progress}%`;
}

/** Localized fill-button labels and episode tooltip of the shared episode grid. */
export function episodeGridText(): {
	labels: { clearAll: string; markAll: string };
	episodeTooltip: (epNum: number, isSkipped: boolean) => string;
} {
	return {
		labels: { clearAll: t('list.season.clearAll'), markAll: t('list.season.markAll') },
		episodeTooltip: (epNum, isSkipped) =>
			t(isSkipped ? 'list.episodeSkipped' : 'list.episode', { num: epNum }),
	};
}
