import { App, Modal, Notice } from 'obsidian';
import { t } from './i18n';
import { createIconButton } from './ui/IconButton';
import type WatchLogPlugin from './main';
import type { ReadingDataManager } from './ReadingDataManager';
import { ReadingCustomColumn, DEFAULT_FIELD_COLOR } from './types';
import { ConfirmModal } from './ConfirmModal';
import { openColorPicker } from './ColorPicker';
import { attachCardDrag, renderTypeSelect, type DragState } from './ui/ColumnsEditor';

type Kind = 'book' | 'manga';

export class ReadingManageColumnsModal extends Modal {
	private plugin: WatchLogPlugin;
	private readingData: ReadingDataManager;
	private kind: Kind;
	private onChanged: () => void;
	private listEl: HTMLElement | null = null;
	private styleGroupEl: HTMLElement | null = null;
	private drag: DragState = { from: -1 };

	constructor(
		app: App,
		plugin: WatchLogPlugin,
		readingData: ReadingDataManager,
		kind: Kind,
		onChanged: () => void,
	) {
		super(app);
		this.plugin = plugin;
		this.readingData = readingData;
		this.kind = kind;
		this.onChanged = onChanged;
	}

	onOpen(): void {
		const colorTheme = this.plugin.settings.colorTheme ?? 'default';
		this.modalEl.setAttribute('data-theme', colorTheme);
		this.contentEl.setAttribute('data-theme', colorTheme);
		this.contentEl.addClass('wl-view');
		this.contentEl.addClass('wl-reading-modal');
		this.contentEl.addClass('wl-reading-manage-cols');
		this.titleEl.setText(this.title());
		this.build();
	}

	private title(): string {
		return t(this.kind === 'book' ? 'reading.columns.titleBook' : 'reading.columns.titleManga');
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private build(): void {
		const c = this.contentEl;
		c.empty();

		const header = c.createDiv({ cls: 'wl-reading-modal-header' });
		header.createSpan({
			cls: 'wl-reading-modal-header-icon',
			text: this.kind === 'book' ? '📖' : '📓',
		});
		header.createSpan({
			cls: 'wl-reading-modal-header-title',
			text: this.title(),
		});

		c.createDiv({
			cls: 'wl-reading-manage-cols-desc',
			text: t('reading.columns.description'),
		});

		this.renderStyleToggle(c);

		this.listEl = c.createDiv({ cls: 'wl-reading-manage-cols-list' });
		this.renderList();

		c.createDiv({ cls: 'wl-reading-modal-divider' });
		this.renderAddSection(c);

		const footer = c.createDiv({ cls: 'wl-reading-modal-footer' });
		const closeBtn = footer.createEl('button', { cls: 'wl-btn', text: t('common.close') });
		closeBtn.addEventListener('click', () => this.close());
	}

	private renderStyleToggle(parent: HTMLElement): void {
		const settings = this.readingData.getSettings();
		const currentStyle = this.kind === 'book'
			? (settings.bookCustomFieldStyle ?? 'fill')
			: (settings.mangaCustomFieldStyle ?? 'fill');

		const row = parent.createDiv({ cls: 'wl-reading-cols-style-row' });
		row.createSpan({ cls: 'wl-reading-cols-style-label', text: t('reading.columns.displayStyle') });

		this.styleGroupEl = row.createDiv({ cls: 'wl-reading-cols-style-group' });

		for (const opt of ['fill', 'border'] as const) {
			const btn = this.styleGroupEl.createEl('button', {
				cls: `wl-reading-cols-style-btn${currentStyle === opt ? ' is-active' : ''}`,
				text: t(opt === 'fill' ? 'reading.columns.styleFill' : 'reading.columns.styleBorder'),
			});
			btn.addEventListener('click', () => {
				void (async () => {
					const key = this.kind === 'book' ? 'bookCustomFieldStyle' : 'mangaCustomFieldStyle';
					await this.readingData.updateSettings({ [key]: opt });
					this.onChanged();
					this.styleGroupEl?.querySelectorAll('.wl-reading-cols-style-btn').forEach((b) => {
						b.removeClass('is-active');
					});
					btn.addClass('is-active');
				})();
			});
		}
	}

	private getColumns(): ReadingCustomColumn[] {
		return this.kind === 'book'
			? this.readingData.getBookColumns()
			: this.readingData.getMangaColumns();
	}

	private renderList(): void {
		if (!this.listEl) return;
		this.listEl.empty();
		const cols = this.getColumns();

		if (cols.length === 0) {
			this.listEl.createDiv({
				cls: 'wl-reading-manage-cols-empty',
				text: t('reading.columns.empty'),
			});
			return;
		}

		cols.forEach((col, idx) => {
			const card = this.listEl!.createDiv({ cls: 'wl-editcol-card wl-reading-col-card' });

			attachCardDrag(card, idx, this.drag, (from, to) => void this.reorder(from, to));

			const nameInput = card.createEl('input', {
				cls: 'wl-modal-input wl-editcol-card-name',
				attr: { type: 'text', placeholder: t('reading.columns.fieldName') },
			});
			nameInput.value = col.name;
			nameInput.addEventListener('change', () => {
				const next = nameInput.value.trim();
				if (!next) {
					nameInput.value = col.name;
					return;
				}
				if (next === col.name) return;
				void this.updateColumn({ ...col, name: next });
			});

			const typeSelect = renderTypeSelect(card, col.type);

			const colorDot = card.createEl('button', { cls: 'wl-reading-col-color-dot' });
			colorDot.style.backgroundColor = col.color ?? DEFAULT_FIELD_COLOR;
			colorDot.title = t('reading.columns.chooseColor');
			colorDot.addEventListener('click', (e) => {
				e.stopPropagation();
				this.openColorPalette(colorDot, col);
			});

			const optsInput = card.createEl('input', {
				cls: 'wl-modal-input wl-reading-col-opts-input',
				attr: { type: 'text', placeholder: t('reading.columns.optionValues') },
			});
			optsInput.value = col.options.join(', ');
			optsInput.style.visibility = col.type === 'select' ? '' : 'hidden';
			optsInput.addEventListener('change', () => {
				const parsed = optsInput.value
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean);
				void this.updateColumn({ ...col, options: parsed });
			});

			typeSelect.addEventListener('change', () => {
				const type = typeSelect.value as ReadingCustomColumn['type'];
				optsInput.style.visibility = type === 'select' ? '' : 'hidden';
				void this.updateColumn({ ...col, type });
			});

			const delBtn = createIconButton(card, { icon: 'x', label: t('reading.columns.deleteField'), cls: 'wl-editcol-card-del' });
			delBtn.addEventListener('click', () => {
				new ConfirmModal(
					this.plugin.app,
					t(
						this.kind === 'book' ? 'reading.columns.deleteConfirmBook' : 'reading.columns.deleteConfirmManga',
						{ name: col.name },
					),
					() => void this.deleteColumn(col.id),
				).open();
			});
		});
	}

	private openColorPalette(anchor: HTMLElement, col: ReadingCustomColumn): void {
		openColorPicker({
			anchor,
			container: this.contentEl,
			current: col.color ?? DEFAULT_FIELD_COLOR,
			allowCustom: true,
			onPick: (color) => { void this.updateColumn({ ...col, color: color ?? undefined }); },
		});
	}

	private renderAddSection(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: 'wl-reading-add-col' });
		wrap.createDiv({ cls: 'wl-reading-section-label', text: t('reading.columns.addField') });

		const row = wrap.createDiv({ cls: 'wl-reading-add-col-row' });

		const nameInput = row.createEl('input', {
			cls: 'wl-modal-input wl-reading-add-col-name',
			attr: { type: 'text', placeholder: t('reading.columns.fieldName') },
		});

		const typeSelect = row.createEl('select', { cls: 'wl-select wl-reading-add-col-type' });
		const typeLabels = {
			text: t('ui.columns.typeText'),
			number: t('ui.columns.typeNumber'),
			select: t('ui.columns.typeSelect'),
		};
		for (const type of ['text', 'number', 'select'] as const) {
			typeSelect.createEl('option', { value: type, text: typeLabels[type] });
		}

		const optsInput = row.createEl('input', {
			cls: 'wl-modal-input wl-reading-add-col-opts',
			attr: {
				type: 'text',
				placeholder: t('reading.columns.optionsPlaceholder'),
			},
		});
		const refreshOpts = (): void => {
			optsInput.style.display = typeSelect.value === 'select' ? '' : 'none';
		};
		typeSelect.addEventListener('change', refreshOpts);
		refreshOpts();

		const addBtn = row.createEl('button', {
			cls: 'wl-reading-add-btn wl-btn-success wl-reading-add-col-btn',
			text: t('common.add'),
		});
		addBtn.addEventListener('click', () => {
			const name = nameInput.value.trim();
			if (!name) {
				new Notice(t('reading.columns.enterName'));
				return;
			}
			const type = typeSelect.value as ReadingCustomColumn['type'];
			const options =
				type === 'select'
					? optsInput.value
							.split(',')
							.map((s) => s.trim())
							.filter(Boolean)
					: [];
			const col: ReadingCustomColumn = {
				id: this.readingData.generateColumnId(this.kind, name),
				name,
				type,
				options,
				color: DEFAULT_FIELD_COLOR,
			};
			void this.addColumn(col).then(() => {
				nameInput.value = '';
				optsInput.value = '';
				typeSelect.value = 'text';
				refreshOpts();
			});
		});
	}

	private async addColumn(col: ReadingCustomColumn): Promise<void> {
		await this.readingData.addColumn(this.kind, col);
		this.renderList();
		this.onChanged();
	}

	private async updateColumn(col: ReadingCustomColumn): Promise<void> {
		await this.readingData.updateColumn(this.kind, col);
		this.renderList();
		this.onChanged();
	}

	private async deleteColumn(id: string): Promise<void> {
		await this.readingData.removeColumn(this.kind, id);
		this.renderList();
		this.onChanged();
	}

	private async reorder(from: number, to: number): Promise<void> {
		await this.readingData.reorderColumns(this.kind, from, to);
		this.renderList();
		this.onChanged();
	}
}
