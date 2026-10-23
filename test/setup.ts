// vitest runs in the node environment; the plugin uses window.setTimeout/clearTimeout
// (obsidianmd/prefer-window-timers) so give it a window that is the global object.
if (typeof globalThis.window === 'undefined') {
	(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}
