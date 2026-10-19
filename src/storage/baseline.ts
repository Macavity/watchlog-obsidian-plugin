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
