const drafts = {
	hint: 'Write {tag} Title in any note and it appears here automatically. Hit Add when you\'re ready to send it to your Watchlist, Books, Manga or Games.',
	pending: { one: 'Pending draft', other: 'Pending drafts' },
	empty: 'No drafts found. Add {tag} followed by a title in any vault note.',
	inLibrary: 'In {library}',
	existsWatchlist: 'This title already exists in your Watchlist',
	existsLibrary: 'This title already exists in your {library} library',
	added: 'Added',
	dismiss: 'Dismiss',
	libraryWatchlist: 'Watchlist',
	libraryBooks: 'Books',
	libraryManga: 'Manga',
	libraryGames: 'Games',
} as const;

export default drafts;
