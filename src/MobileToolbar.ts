import { Platform, setIcon } from 'obsidian';
import { renderAddButton } from './ui/TabToolbar';

export interface MobileToolbarOptions {
	/** The flex container row that holds the toolbar (e.g. wl-header-controls / wl-reading-toolbar). */
	controls: HTMLElement;
	/** Builds the search input into the given parent. */
	renderSearch: (parent: HTMLElement) => void;
	/** Builds the full set of action buttons into the given parent. */
	renderActions: (parent: HTMLElement) => void;
	/** Builds the add button into the given parent. Stays visible on mobile, outside the toggle. */
	renderAdd: (parent: HTMLElement) => HTMLButtonElement;
	/** Current toggle state — true shows actions, false (retracted, default) shows search. */
	expanded: boolean;
	/** Persists the new toggle state on the caller so it survives re-renders. */
	onToggleChange: (expanded: boolean) => void;
}

/**
 * Renders a toolbar that, on mobile only, crossfades between a search input (default, retracted)
 * and its action buttons via a toggle. Both panes are absolutely positioned inside a fixed-height
 * slot so swapping causes no reflow — only opacity animates. The add button sits outside the slot
 * as an icon, so it is always reachable. Desktop renders everything inline, unchanged.
 *
 * Shared by the Watchlist, Reading and Games toolbars, so the toggle lives in one place.
 */
export function renderToolbarWithMobileToggle(options: MobileToolbarOptions): void {
	const { controls, renderSearch, renderActions, renderAdd } = options;

	if (!Platform.isMobile) {
		// desktop: search inline, followed by the full set of action buttons and the add button
		renderSearch(controls);
		renderActions(controls);
		renderAdd(controls);
		return;
	}

	let expanded = options.expanded;

	const slot = controls.createDiv({ cls: 'wl-toolbar-slot' });
	const searchWrap = slot.createDiv({ cls: 'wl-toolbar-slot-pane wl-toolbar-fade' });
	renderSearch(searchWrap);
	const actionsWrap = slot.createDiv({ cls: 'wl-toolbar-slot-pane wl-toolbar-fade' });
	renderActions(actionsWrap);

	const applyState = (): void => {
		searchWrap.toggleClass('wl-toolbar-pane-hidden', expanded);
		actionsWrap.toggleClass('wl-toolbar-pane-hidden', !expanded);
	};
	applyState();

	// icon-only add button; its text label moves to the accessible name
	const addBtn = renderAdd(controls);
	const addLabel = addBtn.textContent ?? '';
	setIcon(addBtn, 'plus');
	addBtn.setAttr('aria-label', addLabel);
	addBtn.addClass('wl-toolbar-add-btn');

	const toggleBtn = controls.createEl('button', { cls: 'wl-btn wl-btn-sm wl-toolbar-toggle-btn' });
	const applyIcon = (): void => {
		setIcon(toggleBtn, expanded ? 'search' : 'sliders-horizontal');
		toggleBtn.setAttr('aria-label', expanded ? 'Show search' : 'Show filters and actions');
	};
	applyIcon();
	toggleBtn.addEventListener('click', () => {
		expanded = !expanded;
		options.onToggleChange(expanded);
		applyState();
		applyIcon();
	});
}

export interface HeaderToolbarOptions {
	renderSearch: (parent: HTMLElement) => void;
	/** Builds the action buttons into their wrap; keep the wrap to rebuild them in isolation. */
	renderActions: (wrap: HTMLElement) => void;
	onAdd: () => void;
	expanded: boolean;
	onToggleChange: (expanded: boolean) => void;
}

/** Watchlist/Games header row: search, a rebuildable actions wrap and the add button. */
export function renderHeaderToolbar(header: HTMLElement, options: HeaderToolbarOptions): void {
	renderToolbarWithMobileToggle({
		controls: header.createDiv({ cls: 'wl-header-controls' }),
		renderSearch: options.renderSearch,
		// display: contents — children stay in the flex row, buttons rebuild in isolation
		renderActions: (parent) => options.renderActions(parent.createDiv({ cls: 'wl-toolbar-actions' })),
		renderAdd: (parent) => renderAddButton(parent, options.onAdd),
		expanded: options.expanded,
		onToggleChange: options.onToggleChange,
	});
}
