import { TFile, type App, type EventRef } from 'obsidian';
import type { HistoryEntry } from '../HistoryManager';
import { formatHistoryLine, parseHistoryLine, type HistoryLine } from './historyLine';
import type { VaultLayout } from './VaultLayout';

export const MAX_HISTORY_ENTRIES = 1000;
const GROUP_CREATED = /^Group "(.+)" was created$/;

/** `target` is the wikilink target (the note path); history lines carry the title name for everything else. */
function toLine(e: HistoryEntry, isLink: boolean, linkTarget?: string): HistoryLine {
	const group = e.action ? null : GROUP_CREATED.exec(e.message);
	const target = group ? (group[1] ?? '') : (e.titleName || '(unknown)');
	const line: HistoryLine = {
		timestamp: e.timestamp,
		action: group ? 'group-created' : (e.action ?? 'added'),
		target: isLink && !group && linkTarget ? linkTarget : target,
		isLink: isLink && !group && !!e.titleName,
	};
	// the group message is derived from the target on load
	if (e.message && !group) line.message = e.message.replace(/\s+/g, ' ').trim();
	if (e.source) line.source = e.source;
	return line;
}

/** Identity of an event for de-duplication: timestamp, action and target. */
export function historyKey(e: HistoryEntry): string {
	const l = toLine(e, false);
	return `${l.timestamp}|${l.action}|${l.target}`;
}

function toEntry(l: HistoryLine, index: number): HistoryEntry {
	const group = l.action === 'group-created';
	// a link target is a note path ("TV Show/Dark"); the entry keeps the plain name
	const name = l.isLink ? (l.target.split('|')[0] ?? '').split('/').pop() || l.target : l.target;
	return {
		id: `${l.timestamp}#${index}`,
		timestamp: l.timestamp,
		message: l.message ?? (group ? `Group "${l.target}" was created` : ''),
		source: l.source,
		// group-created has no HistoryAction; the Log tab infers 'added' from the message
		action: l.action === 'group-created' ? undefined : l.action,
		titleName: group ? undefined : name,
	};
}

/** History.md: one bullet per event. Lines that do not parse are foreign and always preserved. */
export class HistoryStore {
	private modifyRef: EventRef | null = null;
	private own = new Set<string>();

	constructor(
		private app: App,
		private layout: () => VaultLayout,
		private titleExists: (name: string) => boolean = () => false,
		private register: (ref: EventRef) => void = () => {},
	) {}

	private file(): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(this.layout().historyPath);
		return f instanceof TFile ? f : null;
	}

	/** Links to the title note by path (unambiguous when two notes share a name); falls back to the name. */
	private format(e: HistoryEntry): string {
		const name = e.titleName ?? '';
		const isLink = this.titleExists(name);
		let target: string | undefined;
		if (isLink) {
			const layout = this.layout();
			const note = this.app.vault.getMarkdownFiles()
				.find((f) => f.basename === name && layout.classify(f.path)?.kind === 'title');
			if (note) target = layout.idFromPath(note.path);
		}
		return formatHistoryLine(toLine(e, isLink, target));
	}

	async load(): Promise<HistoryEntry[]> {
		const f = this.file();
		if (!f) return [];
		const out: HistoryEntry[] = [];
		(await this.app.vault.read(f)).split('\n').forEach((raw, i) => {
			const l = parseHistoryLine(raw.replace(/\r$/, ''));
			if (l) out.push(toEntry(l, i));
		});
		return out.slice(-MAX_HISTORY_ENTRIES);
	}

	async append(e: HistoryEntry): Promise<void> {
		await this.appendMany([e]);
	}

	/** Appends several entries in one write. */
	async appendMany(entries: HistoryEntry[]): Promise<void> {
		if (entries.length === 0) return;
		const texts = entries.map((e) => this.format(e));
		await this.write((src) => {
			const lines = (src === '' || src.endsWith('\n') ? src : src + '\n').split('\n');
			lines.splice(lines.length - 1, 0, ...texts); // before the trailing empty element
			return this.cap(lines).join('\n');
		});
	}

	/** Replaces all history lines with `entries`, keeping foreign lines in place. */
	async replaceAll(entries: HistoryEntry[]): Promise<void> {
		const lines = entries.slice(-MAX_HISTORY_ENTRIES).map((e) => this.format(e));
		await this.write((src) => {
			const out: string[] = [];
			let inserted = false;
			for (const raw of src.split('\n')) {
				if (parseHistoryLine(raw.replace(/\r$/, ''))) {
					if (!inserted) { out.push(...lines); inserted = true; }
					continue;
				}
				out.push(raw);
			}
			if (!inserted && lines.length) {
				if (out.length && out[out.length - 1] === '') out.splice(out.length - 1, 0, ...lines);
				else out.push(...lines, '');
			}
			return out.join('\n');
		});
	}

	/** Drops the oldest history lines beyond the limit; foreign lines stay. */
	private cap(lines: string[]): string[] {
		const idx = lines.flatMap((l, i) => (parseHistoryLine(l.replace(/\r$/, '')) ? [i] : []));
		const drop = new Set(idx.slice(0, Math.max(0, idx.length - MAX_HISTORY_ENTRIES)));
		return drop.size ? lines.filter((_, i) => !drop.has(i)) : lines;
	}

	private async write(fn: (src: string) => string): Promise<void> {
		const f = this.file();
		const remember = (s: string) => { this.own.add(s); return s; };
		if (!f) {
			const content = remember(fn('# History\n\n'));
			await this.app.vault.create(this.layout().historyPath, content);
			return;
		}
		await this.app.vault.process(f, (src) => remember(fn(src)));
	}

	/** Calls `onExternal` when History.md changes from outside; own writes are ignored. */
	start(onExternal: () => void): void {
		this.stop();
		this.modifyRef = this.app.vault.on('modify', (file: unknown) => {
			if (!(file instanceof TFile) || file.path !== this.layout().historyPath) return;
			void this.app.vault.read(file).then((content) => {
				if (this.own.delete(content)) return;
				onExternal();
			});
		});
		this.register(this.modifyRef);
	}

	stop(): void {
		if (this.modifyRef) this.app.vault.offref(this.modifyRef);
		this.modifyRef = null;
	}
}
