import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL('./test/obsidianStub.ts', import.meta.url)),
		},
	},
	test: {
		include: ['test/**/*.test.ts'],
		setupFiles: ['test/setup.ts'],
	},
});
