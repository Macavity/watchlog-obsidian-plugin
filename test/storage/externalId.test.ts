import { describe, it, expect } from 'vitest';
import { parseExternalId, formatExternalId, externalIdFromLink } from '../../src/storage/externalId';
describe('externalId', () => {
  it.each(['tmdb:tv:1399', 'tmdb:movie:27205', 'imdb:tt5843312', 'mal:anime:21', 'anilist:manga:30013', 'gbooks:zyTCAlFPjgYC', 'rawg:3498', 'igdb:1942'])
    ('round-trips %s', (s) => expect(formatExternalId(parseExternalId(s)!)).toBe(s));
  it('rejects unknown', () => {
    expect(parseExternalId('foo:1')).toBeNull();
    expect(parseExternalId('tmdb:1399')).toBeNull(); // tmdb needs kind
  });
  it('derives from links', () => {
    expect(externalIdFromLink('https://www.imdb.com/title/tt5843312')).toEqual({ source: 'imdb', id: 'tt5843312' });
    expect(externalIdFromLink('https://www.themoviedb.org/tv/1399-game-of-thrones')).toEqual({ source: 'tmdb', kind: 'tv', id: '1399' });
    expect(externalIdFromLink('https://myanimelist.net/anime/21/One_Piece')).toEqual({ source: 'mal', kind: 'anime', id: '21' });
    expect(externalIdFromLink('https://anilist.co/anime/21')).toEqual({ source: 'anilist', kind: 'anime', id: '21' });
    expect(externalIdFromLink('https://example.com')).toBeNull();
  });
});
