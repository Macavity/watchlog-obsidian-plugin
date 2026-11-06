import type enApp from '../en/app';
import type { DeepPartial } from '../index';

const app = {
	ribbon: 'Watchlog',
	viewTitle: 'Watchlog',
	commands: {
		openPanel: 'Panel öffnen',
		addTitle: 'Titel hinzufügen',
		insertWidget: 'Widget einfügen',
		searchTitle: 'Titel suchen',
	},
	tabs: {
		dashboard: 'Dashboard',
		watchlist: 'Watchlist',
		reading: 'Lesen',
		games: 'Spiele',
		upcoming: 'Demnächst',
		customLists: 'Eigene Listen',
		drafts: 'Entwürfe',
		log: 'Verlauf',
	},
	statusBar: {
		label: 'Watchlog: Fällige Neuerscheinungen',
		due: { one: '{count} fällig', other: '{count} fällig' },
	},
	titleNotice: '"{title}" · {type} · {status}',
	widgetPlaceholder: 'Widget zum Einfügen auswählen...',
	widgets: {
		todoFull: 'Titel tracken (voll)',
		todoMini: 'Titel tracken (kompakt)',
		statWatched: 'Gesehene Zeit (mini)',
		statCompleted: 'Abgeschlossene Titel (mini)',
		statRemaining: 'Verbleibende Zeit (mini)',
		statTime: 'Gesehen + verbleibend (mini)',
		upcomingNext: 'Nächste Neuerscheinung (mini)',
		statTimeCompletedFull: 'Karte mit Zeit · Verbleibend · Abgeschlossen',
		nowNext: 'Karte mit Aktuell und Als Nächstes',
	},
	notices: {
		newerSchema: 'Watchlog: data.json stammt von einer neueren Plugin-Version. Geräteeinstellungen werden erst nach einem Update gespeichert.',
		baseFilterMissing: 'Watchlog: Der Ordnerfilter in WatchLog.base wurde nicht gefunden; die Base-Ansicht zeigt eventuell andere Notizen.',
		loadFailed: 'Watchlog konnte seine Notizen nicht laden. Details stehen in der Entwicklerkonsole.',
		legacyPluginEnabled: 'Das ursprüngliche WatchLog-Plugin ist noch aktiv. Deaktiviere es, sonst schreiben beide Plugins dieselben Notizen.',
		migrationFailed: 'Watchlog konnte seine Daten nicht in Notizen migrieren. Beim nächsten Start gibt es einen neuen Versuch; siehe Entwicklerkonsole.',
		migrated: 'Watchlog hat seine Daten in Notizen verschoben (Backup: {backup}).',
		migratedSkipped: {
			one: '{count} Eintrag wurde übersprungen, siehe Entwicklerkonsole.',
			other: '{count} Einträge wurden übersprungen, siehe Entwicklerkonsole.',
		},
		noTitles: 'Noch keine Titel in deiner Watchlog-Bibliothek.',
	},
} satisfies DeepPartial<typeof enApp>;

export default app;
