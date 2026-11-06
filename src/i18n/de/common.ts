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
	testGreeting: 'Hallo {name}',
	testRows: { one: '{count} Zeile', other: '{count} Zeilen' },
} as const satisfies DeepPartial<typeof enCommon>;
