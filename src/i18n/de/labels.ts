import type enLabels from '../en/labels';
import type { DeepPartial } from '../index';

export default {
	status: {
		Watching: 'Schaue',
		'Plan to watch': 'Geplant',
		Completed: 'Abgeschlossen',
		'To be released': 'Noch nicht erschienen',
		Dropped: 'Abgebrochen',
	},
	type: {
		Anime: 'Anime',
		Movie: 'Film',
		'TV Show': 'Serie',
		'Korean TV Show': 'Koreanische Serie',
		Animation: 'Animation',
	},
	readingStatus: {
		Reading: 'Lese',
		Completed: 'Abgeschlossen',
		'Plan to Read': 'Geplant',
		'To be released': 'Noch nicht erschienen',
		Dropped: 'Abgebrochen',
	},
} as const satisfies DeepPartial<typeof enLabels>;
