const NOTES_RE = /(^|\n)## Notes[ \t]*\r?\n([\s\S]*?)(?=\n## |\n# |$)/;

/** `## Notes` body of a note; null when the section is absent. */
export function extractNotes(content: string): string | null {
	const match = content.match(NOTES_RE);
	if (!match) return null;
	// strip the template's leading blank line and trailing whitespace, keep internal breaks
	return (match[2] ?? '').replace(/^\n+/, '').replace(/\s+$/, '');
}

/**
 * Replaces the `## Notes` body, preserving the heading, every other section, the frontmatter and
 * any prose outside it. Appends the heading when missing (never duplicated). The boundary matches
 * extractNotes, so read-then-write round-trips cleanly.
 */
export function replaceNotesSection(existing: string, notesBody: string): string {
	const headingMatch = existing.match(/(^|\n)## Notes[ \t]*\r?\n/);
	if (!headingMatch || headingMatch.index === undefined) {
		const sep = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
		return `${existing}${sep}\n## Notes\n\n${notesBody}\n`;
	}
	const bodyStart = headingMatch.index + headingMatch[0].length;
	const after = existing.slice(bodyStart);
	const nextHeading = after.match(/\n(?:## |# )/);
	const bodyEnd =
		nextHeading && nextHeading.index !== undefined
			? bodyStart + nextHeading.index
			: existing.length;
	const before = existing.slice(0, bodyStart);
	const rest = existing.slice(bodyEnd);
	return `${before}\n${notesBody}\n${rest}`;
}
