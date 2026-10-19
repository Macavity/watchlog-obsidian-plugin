import { TFile, type App, type EventRef } from 'obsidian';
import type { HistoryEntry } from '../HistoryManager';
import { formatHistoryLine, parseHistoryLine, type HistoryLine } from './historyLine';
import type { VaultLayout } from './VaultLayout';

export const MAX_HISTORY_ENTRIES = 1000;
const GROUP_CREATED = /^Group "(.+)" was created$/;

/** Entries with a `titleId` link to their note (`[[<id>]]`); everything else is plain text. */
function toLine(e: HistoryEntry, link: boolean): HistoryLine {
	const group = e.action ? null : GROUP_CREATED.exec(e.message);
	const isLink = link && !group && !!e.titleId;
	const line: HistoryLine = {
		timestamp: e.timestamp,
		action: group ? 'group-created' : (e.action ?? 'added'),
		target: group ? (group[1] ?? '') : isLink ? e.titleId! : (e.titleName || '(unknown)'),
		isLink,
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

const time = (timestamp: string): number => Date.parse(timestamp);

/** Stable sort by timestamp, oldest first. */
function byTime<T extends { timestamp: string }>(items: T[]): T[] {
	return [...items].sort((a, b) => time(a.timestamp) - time(b.timestamp));
}

function toEntry(l: HistoryLine, index: number): HistoryEntry {
	const group = l.action === 'group-created';
	// a link target is the note id ("TV Show/Dark", or "id|alias"); the entry keeps the plain name
	const id = l.isLink ? (l.target.split('|')[0] ?? l.target) : undefined;
	const name = id ? id.split('/').pop() || l.target : l.target;
	return {
		id: `${l.timestamp}#${index}`,
		timestamp: l.timestamp,
		message: l.message ?? (group ? `Group "${l.target}" was created` : ''),
		source: l.source,
		// group-created has no HistoryAction; the Log tab infers 'added' from the message
		action: l.action === 'group-created' ? undefined : l.action,
		titleName: group ? undefined : name,
		titleId: group ? undefined : id,
	};
}

/** History.md: one bullet per event. Lines that do not parse are foreign and always preserved. */
export class HistoryStore {
	private modifyRef: EventRef | null = null;
	private own = new Set<string>();

	constructor(
		private app: App,
		private layout: () => VaultLayout,
		private register: (ref: EventRef) => void = () => {},
	) {}

	private file(): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(this.layout().historyPath);
		return f instanceof TFile ? f : null;
	}

	private format(e: HistoryEntry): string {
		return formatHistoryLine(toLine(e, true));
	}

	async load(): Promise<HistoryEntry[]> {
		const f = this.file();
		if (!f) return [];
		const out: HistoryEntry[] = [];
		(await this.app.vault.read(f)).split('\n').forEach((raw, i) => {
			const l = parseHistoryLine(raw.replace(/\r$/, ''));
			if (l) out.push(toEntry(l, i));
		});
		return byTime(out).slice(-MAX_HISTORY_ENTRIES);
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
		const lines = byTime(entries).slice(-MAX_HISTORY_ENTRIES).map((e) => this.format(e));
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

	/** Drops the oldest history lines by timestamp beyond the limit; foreign lines stay. */
	private cap(lines: string[]): string[] {
		const parsed = lines.flatMap((l, i) => {
			const h = parseHistoryLine(l.replace(/\r$/, ''));
			return h ? [{ i, t: time(h.timestamp) }] : [];
		});
		const oldest = [...parsed].sort((a, b) => a.t - b.t);
		const drop = new Set(oldest.slice(0, Math.max(0, parsed.length - MAX_HISTORY_ENTRIES)).map((p) => p.i));
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
