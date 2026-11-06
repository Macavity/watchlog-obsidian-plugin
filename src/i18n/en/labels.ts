// Keys are the stored values (never change them); values are the English display text.
const labels = {
	status: {
		Watching: 'Watching',
		'Plan to watch': 'Plan to watch',
		Completed: 'Completed',
		'To be released': 'To be released',
		Dropped: 'Dropped',
	},
	type: {
		Anime: 'Anime',
		Movie: 'Movie',
		'TV Show': 'TV Show',
		'Korean TV Show': 'Korean TV Show',
		Animation: 'Animation',
	},
	readingStatus: {
		Reading: 'Reading',
		Completed: 'Completed',
		'Plan to Read': 'Plan to Read',
		'To be released': 'To be released',
		Dropped: 'Dropped',
	},
} as const;

export default labels;
