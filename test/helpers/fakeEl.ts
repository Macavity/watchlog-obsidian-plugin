/**
 * The HTMLElement surface the src/ui helpers call at runtime (through the `obsidian` alias and
 * duck typing), so every member below is reachable even when no test references it directly.
 */
export interface FakeDom {
	children: El[];
	classes: Set<string>;
	dataset: Record<string, string>;
	text: string;
	value: string;
	disabled: boolean;
	selected: boolean;
	readonly isConnected: boolean;
	createDiv(opts?: { cls?: string; text?: string }): El;
	createSpan(opts?: { cls?: string; text?: string }): El;
	createEl(tag: string, opts?: { cls?: string; text?: string; attr?: Record<string, string>; value?: string }): El;
	addEventListener(type: string, fn: () => void): void;
	fire(type: string): void;
	setText(text: string): void;
	remove(): void;
	empty(): void;
	addClass(...cs: string[]): void;
	removeClass(c: string): void;
	scrollTo(): void;
	querySelector(selector: string): El | null;
}

/** Minimal element double for the src/ui helpers: only the DOM surface they touch. */
export class El implements FakeDom {
	parent: El | null = null;
	selected = false;
	children: El[] = [];
	classes = new Set<string>();
	listeners = new Map<string, Array<() => void>>();
	dataset: Record<string, string> = {};
	text = '';
	value = '';
	disabled = false;
	attr: Record<string, string> = {};
	scrolled = false;

	constructor(public tag = 'div', opts: { cls?: string; text?: string; attr?: Record<string, string> } = {}) {
		for (const c of (opts.cls ?? '').split(' ').filter(Boolean)) this.classes.add(c);
		this.text = opts.text ?? '';
		this.attr = opts.attr ?? {};
	}
	createDiv(opts?: { cls?: string; text?: string }): El { return this.createEl('div', opts); }
	createSpan(opts?: { cls?: string; text?: string }): El { return this.createEl('span', opts); }
	createEl(tag: string, opts?: { cls?: string; text?: string; attr?: Record<string, string>; value?: string }): El {
		const el = new El(tag, opts);
		if (opts?.value !== undefined) el.value = opts.value;
		el.parent = this;
		this.children.push(el);
		return el;
	}
	setText(text: string): void { this.text = text; }
	remove(): void {
		if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
		this.parent = null;
	}
	/** True while attached to a root (mirrors Node.isConnected for a detached subtree). */
	get isConnected(): boolean {
		let node: El | null = this;
		while (node.parent) node = node.parent;
		return node.tag === 'root';
	}
	/** Class selectors only ('.a' or '.a.b'). */
	querySelector(selector: string): El | null {
		const classes = selector.split('.').filter(Boolean);
		return this.findAll(classes[0]!).find((e) => classes.every((c) => e.has(c))) ?? null;
	}
	addEventListener(type: string, fn: () => void): void {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
	}
	fire(type: string): void { for (const fn of this.listeners.get(type) ?? []) fn(); }
	empty(): void { for (const c of this.children) c.parent = null; this.children = []; }
	addClass(...cs: string[]): void { for (const c of cs) this.classes.add(c); }
	removeClass(c: string): void { this.classes.delete(c); }
	scrollTo(): void { this.scrolled = true; }
	has(c: string): boolean { return this.classes.has(c); }
	find(c: string): El | undefined {
		for (const child of this.children) {
			if (child.has(c)) return child;
			const hit = child.find(c);
			if (hit) return hit;
		}
		return undefined;
	}
	findAll(c: string): El[] {
		return this.children.flatMap((ch) => [...(ch.has(c) ? [ch] : []), ...ch.findAll(c)]);
	}
}
