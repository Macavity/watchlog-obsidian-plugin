import type enSteam from '../en/steam';
import type { DeepPartial } from '../index';

const steam = {
	title: 'Steam-Bibliothek synchronisieren',
	fetching: 'Steam-Bibliothek wird geladen…',
	summary: '{owned} Spiele auf Steam · {matched} in deiner Bibliothek gefunden · {unmatched} noch nicht hinzugefügt',
	info: 'Spielzeit und Erfolge kommen von Steam und überschreiben die gespeicherten Werte. Status, Bewertung, Priorität und Notizen bleiben unverändert.',
	alsoAchievements: 'Auch Erfolge synchronisieren',
	requestNote: 'eine Anfrage pro Spiel, etwa {count} zusätzlich',
	sync: 'Synchronisieren',
	notInLibrary: 'Nicht in deiner Bibliothek',
	selected: '{count} ausgewählt',
	all: 'Alle',
	none: 'Keine',
	appFallback: 'App {id}',
	neverPlayed: 'nie gespielt',
	syncing: 'Synchronisiere…',
	starting: 'Starte…',
	finishing: 'Aktuelle Anfrage wird beendet…',
	step: '{text} ({step}/{total})',
	updating: '{title} wird aktualisiert',
	achievementsFor: 'Erfolge für {title}',
	importing: '{title} wird importiert',
	stopped: 'Synchronisierung gestoppt',
	complete: 'Synchronisierung abgeschlossen',
	result: {
		one: '{count} Spiel aktualisiert · {imported} importiert',
		other: '{count} Spiele aktualisiert · {imported} importiert',
	},
	notice: 'Steam-Sync: {updated} aktualisiert, {imported} importiert.',
	saved: 'Alles, was vor dem Stopp verarbeitet wurde, ist gespeichert.',
	done: 'Fertig',
	failure: {
		missing: 'Hinterlege zuerst Steam-API-Schlüssel und Steam-ID unter Einstellungen → API → Spiele.',
		badKey: 'Steam hat den API-Schlüssel abgelehnt. Prüfe ihn unter Einstellungen → API → Spiele.',
		private: 'Steam hat keine Bibliothek geliefert. Die Datenschutzeinstellung „Spieldetails“ deines Profils muss auf „Öffentlich“ stehen; sonst verbirgt Steam die Spiele, auch vor deinem eigenen API-Schlüssel.',
		empty: 'Steam meldet keine Spiele für dieses Konto. Prüfe, ob die Steam-ID stimmt.',
		unreachable: 'Steam nicht erreichbar. Prüfe deine Verbindung und versuche es erneut.',
	},
} satisfies DeepPartial<typeof enSteam>;

export default steam;
