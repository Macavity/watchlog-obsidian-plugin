import { describe, it, expect } from 'vitest';
import { parse, stringify } from 'yaml';
import * as base from '../../src/storage/baseFile';

const yaml = { parse, stringify };
const src = `improved-bases:
  icon: 🎬
filters:
  and:
    - file.inFolder("Journal/WatchLog")
    - status != "Dropped"
views:
  - type: table
    name: All   # user comment
`;

describe('baseFile', () => {
	it('adds and replaces the watchlog block without touching the rest', () => {
		const a = base.writeWatchlogBlock(src, { version: 1, statuses: [] }, yaml);
		expect(base.hasWatchlogKey(a)).toBe(true);
		expect(a).toContain('improved-bases:\n  icon: 🎬');
		expect(a).toContain('name: All   # user comment');
		const b = base.writeWatchlogBlock(a, { version: 1, statuses: [{ name: 'X', color: '#fff' }] }, yaml);
		expect(base.readWatchlogBlock(b, yaml)).toEqual({ version: 1, statuses: [{ name: 'X', color: '#fff' }] });
		expect(b.match(/^watchlog:/gm)?.length).toBe(1);
	});
	it('keeps surrounding text byte-identical when replacing a mid-file block', () => {
		const mid = `a: 1\nwatchlog:\n  version: 1\n\n# note\nb: 2\n`;
		const out = base.writeWatchlogBlock(mid, { version: 2 }, yaml);
		expect(out).toBe(`a: 1\nwatchlog:\n  version: 2\n\n# note\nb: 2\n`);
	});
	it('finds and replaces the inFolder line', () => {
		expect(base.findInFolderPath(src)).toBe('Journal/WatchLog');
		const r = base.replaceInFolderPath(src, 'Media/WatchLog')!;
		expect(base.findInFolderPath(r)).toBe('Media/WatchLog');
		expect(r).toContain('- status != "Dropped"');
	});
	it('returns null when the line is gone', () => {
		expect(base.replaceInFolderPath('filters:\n  or:\n    - file.inFolder("x")\n', 'y')).toBeNull();
		expect(base.findInFolderPath('filters:\n  or:\n    - file.inFolder("x")\n')).toBeNull();
	});
	it('returns null block when key is missing', () => {
		expect(base.hasWatchlogKey(src)).toBe(false);
		expect(base.readWatchlogBlock(src, yaml)).toBeNull();
	});
	it('creates a parseable base', () => {
		const c = base.createBaseFile('WatchLog', { version: 1 }, yaml);
		expect(base.findInFolderPath(c)).toBe('WatchLog');
		expect((yaml.parse(c) as { views: unknown[] }).views.length).toBe(1);
	});
});
