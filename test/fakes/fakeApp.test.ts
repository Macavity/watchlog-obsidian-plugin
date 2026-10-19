import { describe, it, expect, vi } from 'vitest';
import { createFakeApp } from './fakeApp';
describe('fakeApp', () => {
  it('processFrontMatter keeps the body and fires changed', async () => {
    const f = createFakeApp({ 'A/x.md': '---\na: 1\n---\n\n## Notes\nhi\n' });
    const spy = vi.fn();
    f.app.metadataCache.on('changed', spy);
    const file = f.app.vault.getAbstractFileByPath('A/x.md')!;
    await f.app.fileManager.processFrontMatter(file as never, (fm) => { fm.b = 2; });
    await Promise.resolve();
    expect(f.files.get('A/x.md')).toContain('## Notes\nhi');
    expect(f.app.metadataCache.getFileCache(file as never)?.frontmatter).toMatchObject({ a: 1, b: 2 });
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('renames and deletes with events', async () => {
    const f = createFakeApp({ 'A/x.md': 'x' });
    const ren = vi.fn(), del = vi.fn();
    f.app.vault.on('rename', ren); f.app.vault.on('delete', del);
    f.externalRename('A/x.md', 'A/y.md'); f.externalDelete('A/y.md');
    await Promise.resolve();
    expect(ren).toHaveBeenCalledWith(expect.objectContaining({ path: 'A/y.md' }), 'A/x.md');
    expect(del).toHaveBeenCalled();
    expect(f.files.size).toBe(0);
  });
  it('creates a missing block, tolerates invalid yaml, offref works', async () => {
    const f = createFakeApp({ 'B/n.md': 'body\n', 'B/bad.md': '---\na: [\n---\nz' });
    const n = f.app.vault.getAbstractFileByPath('B/n.md') as never;
    expect(f.app.vault.getAbstractFileByPath('B/n.md')).toBe(n);
    expect(f.app.vault.getAbstractFileByPath('B')).toBeTruthy();
    await f.app.fileManager.processFrontMatter(n, (fm) => { fm.k = 'v'; });
    expect(f.files.get('B/n.md')).toBe('---\nk: v\n---\nbody\n');
    const bad = f.app.vault.getAbstractFileByPath('B/bad.md') as never;
    expect(f.app.metadataCache.getFileCache(bad)?.frontmatter).toBeUndefined();
    const spy = vi.fn();
    const ref = f.app.vault.on('modify', spy);
    f.app.vault.offref(ref);
    f.externalWrite('B/n.md', 'q');
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
    await f.app.vault.adapter.write('.obsidian/plugins/watchlog/data.json', '{}');
    expect(f.adapterFiles.get('.obsidian/plugins/watchlog/data.json')).toBe('{}');
    expect(await f.app.vault.adapter.exists('.obsidian/plugins/watchlog/data.json')).toBe(true);
  });
});
