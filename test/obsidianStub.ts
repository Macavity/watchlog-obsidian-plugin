// Minimal stand-in for the 'obsidian' module in unit tests. Extend as tests need more surface.
import { parse, stringify } from 'yaml';
import { El } from './helpers/fakeEl';

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

export const Platform = { isMobile: false, isDesktop: true };
