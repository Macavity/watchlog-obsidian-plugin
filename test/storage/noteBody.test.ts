import { describe, it, expect } from 'vitest';
import { extractNotes, replaceNotesSection } from '../../src/storage/noteBody';

describe('extractNotes', () => {
	it('returns null when the section is missing', () => {
		expect(extractNotes('---\na: 1\n---\n\n## Other\n\ntext\n')).toBeNull();
	});

	it('trims leading blank line and trailing whitespace, keeps inner breaks', () => {
		expect(extractNotes('## Notes\n\nline one\n\nline two  \n\n')).toBe('line one\n\nline two');
	});

	it('stops at the next heading', () => {
		expect(extractNotes('## Notes\n\nmine\n\n## Links\n\nother\n')).toBe('mine');
	});

	it('returns empty string for an empty section', () => {
		expect(extractNotes('## Notes\n')).toBe('');
	});
});

describe('replaceNotesSection', () => {
	it('appends the section when missing, with or without trailing newline', () => {
		expect(replaceNotesSection('body\n', 'hi')).toBe('body\n\n## Notes\n\nhi\n');
		expect(replaceNotesSection('body', 'hi')).toBe('body\n\n## Notes\n\nhi\n');
		expect(replaceNotesSection('', 'hi')).toBe('\n## Notes\n\nhi\n');
	});

	it('replaces only the body up to the next heading', () => {
		const existing = '---\na: 1\n---\n\n## Notes\n\nold\n\n## Links\n\nkeep\n';
		expect(replaceNotesSection(existing, 'new')).toBe('---\na: 1\n---\n\n## Notes\n\nnew\n\n## Links\n\nkeep\n');
	});

	it('stops at a level-one heading and replaces to the end otherwise', () => {
		expect(replaceNotesSection('## Notes\n\nold\n\n# Top\n\nx\n', 'new')).toBe('## Notes\n\nnew\n\n# Top\n\nx\n');
		expect(replaceNotesSection('intro\n\n## Notes\n\nold', 'new')).toBe('intro\n\n## Notes\n\nnew\n');
	});

	it('round-trips through extractNotes', () => {
		const body = 'a\n\nb';
		expect(extractNotes(replaceNotesSection('x\n', body))).toBe(body);
		expect(extractNotes(replaceNotesSection('## Notes\n\nold\n\n## Z\n', body))).toBe(body);
	});
});
