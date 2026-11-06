const edit = {
	heading: 'Edit: {title}',
	type: 'Type',
	totalEpisodes: 'Total episodes',
	episodeDuration: 'Ep. duration (min)',
	posterUrl: 'Poster URL',
	posterHelp: 'Stored in the note. Leave blank to let WatchLog fetch one again.',
	trailerUrl: 'Trailer URL',
	trailerHelp: 'Override the auto-fetched trailer. Leave blank to use the fetched one.',
	seasons: 'Seasons',
	toSkip: '· {count} to skip',
	toWatch: '· {count} to watch',
	totalPreview: 'Total episodes: {total}',
	totalPreviewSkip: 'Total episodes: {total} · {skipped} to skip',
	formatHelp: 'Format: "Season Name: N" (e.g. "Season 1: 12")',
	skipHelp: 'Skip episodes: add "(1,3,5-10)" after count (e.g. "Season 1: 48 (33-37)")',
	totalNote: 'Note: when adding a new season, remember to update "Total Episodes" so progress calculates correctly.',
	saveChanges: 'Save changes',
	emptyName: 'Title name cannot be empty.',
	updated: '"{name}" updated.',
} as const;

export default edit;
