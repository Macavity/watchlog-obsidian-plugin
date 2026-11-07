// Minimal stand-in for the 'obsidian' module in unit tests. Extend as tests need more surface.
import { parse, stringify } from 'yaml';
import { El } from './helpers/fakeEl';
import { vi } from 'vitest';

export function normalizePath(path: string): string {
	return path
		.replace(/\\/g, '/')
		.replace(/\/+/g, '/')
		.replace(/^\/|\/$/g, '');
}

export function parseYaml(src: string): unknown {
	return parse(src);
}

export function stringifyYaml(obj: unknown): string {
	return stringify(obj);
}

export class TAbstractFile {
	path = '';
	name = '';
	parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
	basename = '';
	extension = '';
	stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}

export class Notice {
	/** Messages of every notice shown, for assertions. */
	static shown: string[] = [];
	constructor(public message: string, public timeout?: number) {
		Notice.shown.push(message);
	}
}

/** Modal base with element doubles; open()/close() run the subclass hooks like Obsidian does. */
export class Modal {
	titleEl = new El('root');
	contentEl = new El('root');
	constructor(public app: unknown) {}
	onOpen(): void {}
	onClose(): void {}
	open(): void { this.onOpen(); }
	close(): void { this.onClose(); }
}

/** Bare base classes so modules that extend Obsidian types can be imported. */
export class FuzzySuggestModal extends Modal {}
export class ItemView {
	containerEl = new El('root');
	contentEl = new El('root');
	constructor(public leaf: unknown) {}
}
export class Plugin {
	app: unknown;
	manifest: unknown;
}
export class PluginSettingTab {
	containerEl = new El('root');
	constructor(public app: unknown, public plugin: unknown) {}
}

/** Form-control doubles behind `Setting`: they render their labels into the element tree. */
type Change<T> = (v: T) => unknown;
export class DropdownComponent {
	selectEl: El;
	private changed: Change<string> = () => undefined;
	constructor(parent: El) { this.selectEl = parent.createEl('select'); }
	addOption(value: string, label: string): this {
		this.selectEl.createEl('option', { text: label, value });
		return this;
	}
	addOptions(options: Record<string, string>): this {
		for (const [value, label] of Object.entries(options)) this.addOption(value, label);
		return this;
	}
	setValue(v: string): this { this.selectEl.value = v; return this; }
	onChange(fn: Change<string>): this { this.changed = fn; return this; }
	fire(v: string): unknown { return this.changed(v); }
}
export class ToggleComponent {
	toggleEl: El;
	private changed: Change<boolean> = () => undefined;
	constructor(parent: El) { this.toggleEl = parent.createDiv({ cls: 'checkbox-container' }); }
	setValue(_v: boolean): this { return this; }
	onChange(fn: Change<boolean>): this { this.changed = fn; return this; }
	fire(v: boolean): unknown { return this.changed(v); }
}
export class ButtonComponent {
	buttonEl: El;
	constructor(parent: El) { this.buttonEl = parent.createEl('button'); }
	setButtonText(text: string): this { this.buttonEl.text = text; return this; }
	setTooltip(text: string): this { this.buttonEl.attr['aria-label'] = text; return this; }
	setCta(): this { return this; }
	onClick(fn: () => unknown): this { this.buttonEl.addEventListener('click', () => { void fn(); }); return this; }
}
export class TextComponent {
	inputEl: El;
	private changed: Change<string> = () => undefined;
	constructor(parent: El) { this.inputEl = parent.createEl('input'); }
	setValue(v: string): this { this.inputEl.value = v; return this; }
	setPlaceholder(text: string): this { this.inputEl.attr.placeholder = text; return this; }
	onChange(fn: Change<string>): this { this.changed = fn; return this; }
	fire(v: string): unknown { return this.changed(v); }
}
export class SliderComponent {
	sliderEl: El;
	constructor(parent: El) { this.sliderEl = parent.createEl('input'); }
	setLimits(_min: number, _max: number, _step: number): this { return this; }
	setValue(_v: number): this { return this; }
	onChange(_fn: Change<number>): this { return this; }
}
export class Component {}
export class Setting {
	settingEl: El;
	nameEl: El;
	descEl: El;
	controlEl: El;
	constructor(containerEl: El) {
		this.settingEl = containerEl.createDiv({ cls: 'setting-item' });
		const info = this.settingEl.createDiv({ cls: 'setting-item-info' });
		this.nameEl = info.createDiv({ cls: 'setting-item-name' });
		this.descEl = info.createDiv({ cls: 'setting-item-description' });
		this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
	}
	setName(name: string): this { this.nameEl.text = name; return this; }
	setDesc(desc: string): this { this.descEl.text = desc; return this; }
	addDropdown(cb: (c: DropdownComponent) => unknown): this { cb(new DropdownComponent(this.controlEl)); return this; }
	addToggle(cb: (c: ToggleComponent) => unknown): this { cb(new ToggleComponent(this.controlEl)); return this; }
	addButton(cb: (c: ButtonComponent) => unknown): this { cb(new ButtonComponent(this.controlEl)); return this; }
	addText(cb: (c: TextComponent) => unknown): this { cb(new TextComponent(this.controlEl)); return this; }
}
export class MarkdownView {}
export class MarkdownRenderer {}
export class WorkspaceLeaf {}

export const Platform = { isMobile: false, isDesktop: true };

/** Records the icon name as `data-icon` so tests can assert which icon was set. */
/** Mirrors the API: the tooltip text lands in aria-label. */
export function setTooltip(el: El, tooltip: string): void {
	el.attr['aria-label'] = tooltip;
}

export function setIcon(el: El, icon: string): void {
	el.empty();
	el.text = '';
	el.attr['data-icon'] = icon;
}

/** Network stand-in; tests set the response with mockResolvedValue and read the sent params from mock.calls. */
export const requestUrl = vi.fn(async (_params: unknown) => ({ status: 200, text: '{}', json: {} as unknown }));

/** App language stand-in: getLanguage() returns the code Obsidian reports ('en', 'de', 'de-AT'). */
export let language = 'en';
export function getLanguage(): string { return language; }
export function setStubLanguage(l: string): void { language = l; }
