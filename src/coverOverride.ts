/**
 * Whether a cover URL from an add/edit form is a user override (written to the note, E9) rather than
 * API data (cache only). `apiUrl` is the URL last prefilled from an API result; an unchanged one stays
 * cache-only. `wasOverride` keeps an existing override while a URL is set.
 */
export function isCoverOverride(url: string, apiUrl: string, wasOverride = false): boolean {
	const typed = url.trim();
	if (!typed) return false;
	return wasOverride || typed !== apiUrl.trim();
}
