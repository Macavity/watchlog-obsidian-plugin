import type enDrafts from '../en/drafts';
import type { DeepPartial } from '../index';

const drafts = {
	hint: 'Schreib {tag} Titel in eine beliebige Notiz, und er erscheint hier automatisch. Mit „Hinzufügen“ schickst du ihn an Watchlist, Bücher, Manga oder Spiele.',
	pending: { one: 'Offener Entwurf', other: 'Offene Entwürfe' },
	empty: 'Keine Entwürfe gefunden. Schreib {tag} gefolgt von einem Titel in eine beliebige Notiz.',
	inLibrary: 'In {library}',
	existsWatchlist: 'Dieser Titel ist schon in deiner Watchlist',
	existsLibrary: 'Dieser Titel ist schon in deiner Bibliothek „{library}“',
	added: 'Hinzugefügt',
	dismiss: 'Verwerfen',
	libraryWatchlist: 'Watchlist',
	libraryBooks: 'Bücher',
	libraryManga: 'Manga',
	libraryGames: 'Spiele',
} satisfies DeepPartial<typeof enDrafts>;

export default drafts;
