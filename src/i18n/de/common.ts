import type enCommon from '../en/common';
import type { DeepPartial } from '../index';

export default {
	cancel: 'Abbrechen',
	save: 'Speichern',
	delete: 'Löschen',
	close: 'Schließen',
	add: 'Hinzufügen',
	remove: 'Entfernen',
	edit: 'Bearbeiten',
	search: 'Suchen',
	loading: 'Lädt…',
	none: 'Keine',
} as const satisfies DeepPartial<typeof enCommon>;
