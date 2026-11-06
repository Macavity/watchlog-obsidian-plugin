import type enNotices from '../en/notices';
import type { DeepPartial } from '../index';

const notices = {
	manager: {
		editLost: 'Eine Änderung an "{id}" wurde nicht gespeichert: Die Notiz ist nicht mehr lesbar.',
		invalidYaml: '"{file}" konnte nicht aktualisiert werden: Die Eigenschaften sind kein gültiges YAML.',
		renameTargetExists: '"{target}" existiert bereits; die Notiz behält ihren alten Dateinamen.',
		apiKeyNeeded: 'API-Schlüssel nötig, um Episoden zu laden',
		episodesLoading: 'Episoden von "{title}" werden noch geladen.',
		sharedConfigUnreadable: 'Watchlog: Der Einstellungsblock in WatchLog.base ist nicht lesbar; Einstellungen wurden nicht gespeichert.',
	},
} satisfies DeepPartial<typeof enNotices>;

export default notices;
