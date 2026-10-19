/** URL from an API response, kept only when it is `https:`; '' otherwise. */
export function httpsOrEmpty(url: string | null | undefined): string {
	if (!url) return '';
	try {
		return new URL(url).protocol === 'https:' ? url : '';
	} catch {
		return '';
	}
}
