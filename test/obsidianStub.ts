// Minimal stand-in for the 'obsidian' module in unit tests. Extend as tests need more surface.
import { parse, stringify } from 'yaml';

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
	constructor(public message: string, public timeout?: number) {}
}

export const Platform = { isMobile: false, isDesktop: true };
