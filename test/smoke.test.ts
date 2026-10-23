import { describe, it, expect } from 'vitest';
import { normalizePath } from 'obsidian';

describe('test setup', () => {
	it('resolves the obsidian stub', () => {
		expect(normalizePath('a//b/')).toBe('a/b');
	});
});
