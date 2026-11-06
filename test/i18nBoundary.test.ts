import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Translated text must never reach note properties: the storage/data layer
// stays free of i18n imports.
const root = join(__dirname, '..');

const storageFiles = readdirSync(join(root, 'src/storage'), { recursive: true })
	.map(String)
	.filter((f) => f.endsWith('.ts'))
	.map((f) => `src/storage/${f}`);

const files = [
	...storageFiles,
	'src/types.ts',
	'src/DataManager.ts',
	'src/ReadingDataManager.ts',
	'src/GameDataManager.ts',
	'src/HistoryManager.ts',
	'src/settingsSplit.ts',
	'src/backup.ts',
	'src/airtimeScheduler.ts',
];

describe('i18n import boundary', () => {
	it.each(files)('%s does not import i18n', (file) => {
		const offending = readFileSync(join(root, file), 'utf8')
			.split('\n')
			.filter((line) => /from\s+['"][^'"]*i18n/.test(line));
		expect(offending).toEqual([]);
	});
});
