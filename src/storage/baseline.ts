const BASELINE = Symbol('baseline');

/**
 * Remembers the stored state a UI copy was made from. The symbol property is enumerable so it
 * survives object spread; Object.keys, JSON and structuredClone skip it, so it never reaches
 * a note, a backup or a deep compare.
 */
export function setBaseline<T extends object>(view: T, base: T): void {
	Object.defineProperty(view, BASELINE, { value: base, enumerable: true, writable: true, configurable: true });
}

export function getBaseline<T extends object>(view: T): T | undefined {
	return (view as { [BASELINE]?: T })[BASELINE];
}

const NOTES_BASELINE = Symbol('notesBaseline');

/** The note body a copy was made from; the body lives outside the stored state, so it has its own baseline. */
export function setNotesBaseline(view: object, notes: string): void {
	Object.defineProperty(view, NOTES_BASELINE, { value: notes, enumerable: true, writable: true, configurable: true });
}

export function getNotesBaseline(view: object): string | undefined {
	return (view as { [NOTES_BASELINE]?: string })[NOTES_BASELINE];
}

/**
 * True when two copies hold the same stored state. The id is ignored: a rename keeps the state.
 * A false mismatch (key order) only costs a rebuilt view.
 */
export function sameStoredState(a: object, b: object): boolean {
	return a === b || JSON.stringify({ ...a, id: '' }) === JSON.stringify({ ...b, id: '' });
}
