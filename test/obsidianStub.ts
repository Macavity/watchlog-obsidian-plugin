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
export class Component {}
export class Setting {}
export class MarkdownView {}
export class MarkdownRenderer {}
export class WorkspaceLeaf {}

export const Platform = { isMobile: false, isDesktop: true };

/** Records the icon name as `data-icon` so tests can assert which icon was set. */
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
