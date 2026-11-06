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
	api: {
		requestFailed: 'Anfrage fehlgeschlagen; prüfe deine Verbindung.',
		unknownService: 'Die API',
		providerMessage: '{service}: {text}',
		tmdbTokenRequired: 'TMDB-Token erforderlich; trage unter Einstellungen → API einen ein.',
		keyRequired: '{service}-API-Schlüssel erforderlich; trage unter Einstellungen → API einen ein.',
		auth: {
			tmdb: 'TMDB hat diese Zugangsdaten abgelehnt. Unter Einstellungen → API wird der API Read Access Token (v4) benötigt, eine lange Zeichenfolge, die mit "eyJ" beginnt, nicht der 32-stellige v3-API-Schlüssel.',
			omdb: 'OMDb hat den Schlüssel abgelehnt. Ist er neu, klicke den Aktivierungslink aus der E-Mail von OMDb; Schlüssel funktionieren erst nach der Aktivierung.',
			googleBooks: 'Google hat diesen Schlüssel abgelehnt; prüfe, ob er vollständig kopiert wurde.',
			rawg: 'RAWG hat den Schlüssel abgelehnt; er ist ungültig oder wurde wegen Überschreitung des Monatskontingents gesperrt.',
			twitch: 'Twitch hat Client-ID oder Secret abgelehnt; prüfe beide unter Einstellungen → API → Spiele.',
			igdb: 'IGDB hat die Anfrage abgelehnt; die Zugangsdaten funktionieren, die Abfrage nicht.',
			other: '{service} hat deine Zugangsdaten abgelehnt.',
		},
		notEnabled: 'Die Books API ist für diesen Schlüssel nicht aktiviert. Aktiviere "Books API" in deinem Google-Cloud-Projekt und versuche es erneut.',
		rateLimited: {
			omdb: 'Tageslimit von OMDb erreicht (1.000 pro Tag im kostenlosen Tarif). Es wird um Mitternacht UTC zurückgesetzt.',
			jikan: 'Die MyAnimeList-API drosselt Anfragen; warte ein paar Sekunden und suche erneut.',
			anilist: 'AniList drosselt Anfragen; warte einen Moment und suche erneut.',
			googleBooks: 'Google-Books-Kontingent für diesen Schlüssel überschritten; es wird täglich zurückgesetzt.',
			other: '{service} drosselt Anfragen; warte einen Moment und versuche es erneut.',
		},
		serverKeyless: '{service} ist vorübergehend nicht verfügbar (HTTP {status}). Versuche es gleich erneut.',
		server: '{service} ist vorübergehend nicht verfügbar (HTTP {status}). Es liegt nicht an deinem Schlüssel; versuche es gleich erneut.',
		notFound: '{service} hat zu dieser Anfrage nichts gefunden.',
		parse: '{service} hat eine nicht lesbare Antwort geliefert.',
		network: '{service} ist nicht erreichbar; prüfe deine Verbindung.',
		failed: 'Anfrage an {service} fehlgeschlagen (HTTP {status}).',
		short: {
			failed: 'Fehlgeschlagen',
			noKey: 'Kein Schlüssel',
			auth: 'Zugang abgelehnt',
			notEnabled: 'API nicht aktiviert',
			rateLimited: 'Gedrosselt',
			server: 'Dienst nicht verfügbar',
			notFound: 'Nicht gefunden',
			parse: 'Antwort nicht lesbar',
			network: 'Nicht erreichbar',
			http: 'Fehlgeschlagen (HTTP {status})',
		},
	},
} satisfies DeepPartial<typeof enNotices>;

export default notices;
