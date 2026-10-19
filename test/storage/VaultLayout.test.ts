import { describe, it, expect } from 'vitest';
import { VaultLayout } from '../../src/storage/VaultLayout';
const l = new VaultLayout('Journal/WatchLog', () => ['Movie', 'TV Show']);
describe('VaultLayout', () => {
  it('classifies entries', () => {
    expect(l.classify('Journal/WatchLog/Movie/Hocus Pocus.md')).toEqual({ kind: 'title', id: 'Movie/Hocus Pocus', type: 'Movie' });
    expect(l.classify('Journal/WatchLog/Books/Dune.md')).toEqual({ kind: 'book', id: 'Books/Dune' });
    expect(l.classify('Journal/WatchLog/Games/Hades.md')?.kind).toBe('game');
  });
  it('ignores non-entries', () => {
    for (const p of ['Journal/WatchLog/WatchLog.base', 'Journal/WatchLog/History.md', 'Journal/WatchLog/CustomLists/Top.md',
      'Journal/WatchLog/Movie/sub/X.md', 'Journal/WatchLog/Movie/x.png', 'Journal/WatchLog/Unknown/X.md', 'Other/Movie/X.md'])
      expect(l.classify(p)).toBeNull();
  });
  it('maps ids and paths', () => {
    expect(l.pathFromId('Movie/Hocus Pocus')).toBe('Journal/WatchLog/Movie/Hocus Pocus.md');
    expect(l.idFromPath('Journal/WatchLog/Movie/Hocus Pocus.md')).toBe('Movie/Hocus Pocus');
    expect(l.notePath('title', 'Léon: The Professional', 'Movie')).toBe('Journal/WatchLog/Movie/Léon- The Professional.md');
    expect(l.notePath('manga', ' Berserk? ')).toBe('Journal/WatchLog/Manga/Berserk-.md');
  });
  it('finds the first watchlog base', () => {
    expect(VaultLayout.findRoot([{ path: 'b/WatchLog.base', hasWatchlogKey: true }, { path: 'a/X.base', hasWatchlogKey: false },
      { path: 'a/WatchLog.base', hasWatchlogKey: true }])).toBe('a');
    expect(VaultLayout.findRoot([])).toBeNull();
  });
});
