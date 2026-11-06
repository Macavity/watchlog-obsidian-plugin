import type enEdit from '../en/edit';
import type { DeepPartial } from '../index';

const edit = {
	heading: 'Bearbeiten: {title}',
	type: 'Typ',
	totalEpisodes: 'Folgen gesamt',
	episodeDuration: 'Folgendauer (Min.)',
	posterUrl: 'Poster-URL',
	posterHelp: 'In der Notiz gespeichert. Leer lassen, damit WatchLog erneut eines abruft.',
	trailerUrl: 'Trailer-URL',
	trailerHelp: 'Überschreibt den automatisch abgerufenen Trailer. Leer lassen, um den abgerufenen zu nutzen.',
	seasons: 'Staffeln',
	toSkip: '· {count} zu überspringen',
	toWatch: '· {count} zu schauen',
	totalPreview: 'Folgen gesamt: {total}',
	totalPreviewSkip: 'Folgen gesamt: {total} · {skipped} zu überspringen',
	formatHelp: 'Format: "Staffelname: N" (z. B. "Season 1: 12")',
	skipHelp: 'Folgen überspringen: "(1,3,5-10)" hinter die Anzahl setzen (z. B. "Season 1: 48 (33-37)")',
	totalNote: 'Hinweis: Wenn du eine Staffel hinzufügst, aktualisiere "Folgen gesamt", damit der Fortschritt stimmt.',
	saveChanges: 'Änderungen speichern',
	emptyName: 'Der Titelname darf nicht leer sein.',
	updated: '"{name}" aktualisiert.',
} satisfies DeepPartial<typeof enEdit>;

export default edit;
