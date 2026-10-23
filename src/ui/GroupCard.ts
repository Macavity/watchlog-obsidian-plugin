import type { App } from 'obsidian';
import { renderGroupCollage } from '../CollageUtil';
import { ConfirmModal } from '../ConfirmModal';
import { openCardMenu } from '../PosterCard';

export interface GroupCardOptions<M> {
	app: App;
	group: { id: string; name: string };
	members: readonly M[];
	/** Cover url of a member, for the collage. */
	getCover: (member: M) => string;
	typeColor: string;
	/** Name and count below the collage instead of overlaid. */
	textUnder: boolean;
	selected: boolean;
	cardHeight?: number;
	/** Singular noun for the count badge ("game", "title"). */
	unit: string;
	/** Scope for the card menu and its render-scoped cleanups. */
	container: HTMLElement;
	cleanups: Array<() => void>;
	onRename: () => void;
	deleteMessage: string;
	/** Runs after the user confirmed the delete. */
	onDelete: () => void;
	/** Click on the card (or its cell in under mode); the tab decides between select and open. */
	onActivate: (card: HTMLElement) => void;
}

/** First letter of the group name for the collage fallback. */
export function groupLetter(name: string): string {
	return (name.trim().charAt(0) || '?').toUpperCase();
}

/** "1 game" / "3 games". */
export function groupCountLabel(count: number, unit: string): string {
	return `${count} ${unit}${count !== 1 ? 's' : ''}`;
}

function renderGroupText(textHost: HTMLElement, under: boolean, name: string, label: string, color: string): void {
	textHost.createSpan({ cls: under ? 'wl-card-under-title' : 'wl-card-title', text: name });
	const badge = textHost.createDiv({ cls: 'wl-card-meta-row' }).createSpan({ cls: 'wl-card-type-badge' });
	badge.style.backgroundColor = color;
	badge.textContent = label;
}

function renderGroupMenuButton<M>(card: HTMLElement, opts: GroupCardOptions<M>): void {
	const menuBtn = card.createEl('button', { cls: 'wl-card-menu-btn', text: '⋮' });
	menuBtn.setAttr('aria-label', 'Group actions');
	menuBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		openCardMenu(card, menuBtn, [
			{ label: 'Edit name', onClick: opts.onRename },
			{
				label: 'Delete group',
				onClick: () => { new ConfirmModal(opts.app, opts.deleteMessage, opts.onDelete).open(); },
			},
		], { container: opts.container, cleanups: opts.cleanups });
	});
}

/** Group cover card: member-cover collage, name + count badge, ⋮ menu (rename / delete). */
export function renderGroupCard<M>(parent: HTMLElement, opts: GroupCardOptions<M>): void {
	const { group, members, typeColor } = opts;
	// under mode wraps the collage in a cell with name + count below (see buildPosterCard)
	const cell = opts.textUnder ? parent.createDiv({ cls: 'wl-card-cell' }) : null;
	const outer = cell ?? parent;
	const card = outer.createDiv({ cls: 'wl-card wl-card-group' });
	card.dataset.groupId = group.id;
	if (opts.selected) card.addClass('wl-card-selected');
	if (opts.cardHeight !== undefined) (cell ?? card).style.height = `${opts.cardHeight}px`;

	renderGroupCollage(card, members, opts.getCover, { letter: groupLetter(group.name), color: typeColor });
	const textHost = cell
		? cell.createDiv({ cls: 'wl-card-under-info' })
		: card.createDiv({ cls: 'wl-card-overlay' });
	renderGroupText(textHost, !!cell, group.name, groupCountLabel(members.length, opts.unit), typeColor);
	renderGroupMenuButton(card, opts);

	// under mode: the whole cell opens the group
	(cell ?? card).addEventListener('click', () => opts.onActivate(card));
}
