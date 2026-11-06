import type enSettings from '../en/settings';
import type { DeepPartial } from '../index';

const settings = {
	nav: {
		general: 'Allgemein',
		api: 'API',
		customize: 'Anpassen',
		watchlist: 'Watchlist',
		drafts: 'Entwürfe',
		customLists: 'Eigene Listen',
		reading: 'Lesen',
		widgets: 'Widgets',
		quickInfo: 'Kurzinfo',
	},
	group: {
		main: 'Haupteinstellungen',
	},
	about: 'Über {label}',
	progress: {
		done: 'Fertig',
		cancelled: 'Abgebrochen',
	},
	chip: {
		types: { one: '{count} Typ', other: '{count} Typen' },
		statuses: { one: '{count} Status', other: '{count} Status' },
		genres: { one: '{count} Genre', other: '{count} Genres' },
		platforms: { one: '{count} Plattform', other: '{count} Plattformen' },
		priorities: { one: '{count} Priorität', other: '{count} Prioritäten' },
		tiers: { one: '{count} Stufe', other: '{count} Stufen' },
		books: { one: '{count} Buch', other: '{count} Bücher' },
		manga: { one: '{count} Manga', other: '{count} Manga' },
	},
	cardSize: {
		smallest: 'Am kleinsten',
		smaller: 'Kleiner',
		small: 'Klein',
		default: 'Standard',
		large: 'Groß',
		larger: 'Größer',
		largest: 'Am größten',
	},
	cards: {
		valuePx: '{label} · {px} px',
		styleMixed: 'Gemischt',
		textUnder: 'Text darunter',
		textInside: 'Text innen',
		hintUnder: 'Name und Details unter dem Poster',
		hintInside: 'Über dem Poster eingeblendet',
		under: 'Darunter',
		inside: 'Innen',
		applyAll: '{name}: auf jeden Tab anwenden',
		tabStyle: '{tab}: {style}',
		text: {
			label: 'Kartentext',
			help: 'Wo die Poster-Karten eines Tabs Name, Typ und Jahr zeigen: in einem Block unter dem Poster (klassischer Stil von Lesen und Demnächst) oder unten über dem Poster (klassischer Watchlist-Stil). Status-Badges bleiben in beiden Fällen auf dem Poster. Die zwei großen Vorschauen setzen einen Stil für alle Tabs auf einmal; die Zeilen darunter stellen jeden Tab einzeln ein.',
		},
		size: {
			label: 'Kartengröße',
			help: 'Minimale Posterbreite für jedes Raster und Regal (die Karten dehnen sich etwas, um jede Zeile zu füllen). Desktop und Smartphones/Tablets sind unabhängig, beide werden wie jede andere Einstellung synchronisiert.',
		},
		desktop: 'Desktop',
		mobile: 'Mobil',
	},
	general: {
		coffee: 'Spendier mir einen Kaffee',
		main: {
			sub: 'Globales Erscheinungsbild, Datumsformate und Wartung',
		},
		dashboardStyle: {
			name: 'Dashboard-Kartenstil',
			desc: 'Ringdiagramme oder rechteckige Statistikkarten im Dashboard.',
			circles: 'Kreise',
			rectangles: 'Rechtecke',
		},
		dateFormat: {
			name: 'Datumsformat',
			desc: 'Wie Datumsangaben im ganzen Plugin angezeigt und eingegeben werden: Listen, Karten, Dialoge, Verlauf und Kalenderauswahl. Deine gespeicherten Daten bleiben unberührt: Daten werden immer im selben internen Format gespeichert, ein Wechsel ist daher jederzeit gefahrlos.',
			european: 'Europäisch: {date}',
			american: 'Amerikanisch: {date}',
			iso: 'ISO: {date}',
		},
		halfStar: {
			name: 'Halbe Sterne',
			desc: 'Halbe Sterne (0,5) beim Bewerten von Watchlist-Titeln und Leseeinträgen erlauben. Bestehende Bewertungen bleiben unverändert.',
		},
		finishDate: {
			name: 'Abschlussdatum automatisch setzen',
			desc: 'Das heutige Datum als Abschlussdatum eintragen, wenn ein Titel oder Leseeintrag abgeschlossen wird.',
		},
		replaceImages: {
			name: 'Alle Bilder durch API-Bilder ersetzen',
			desc: 'Ersetzt das Bild jedes Eintrags durch das der API, auch von Hand eingetragene Bilder. Einträge ohne ID und fehlgeschlagene Abrufe behalten ihr Bild.',
			button: 'Bilder ersetzen',
			confirm: 'Das ersetzt die Bilder von {titles} Titeln, {reading} Leseeinträgen und {games} Spielen durch die Bilder der API, auch von Hand eingetragene. Einträge ohne API-ID oder Treffer behalten ihr Bild. Das löst viele API-Anfragen aus und kann dauern. Fortfahren?',
			start: 'Rufe {count} Bilder erneut ab…',
			done: 'Bilder neu abgerufen: {updated} aktualisiert, {unchanged} unverändert oder fehlgeschlagen.',
		},
		rewrite: {
			name: 'Alle Notiz-Eigenschaften neu schreiben',
			desc: 'Schreibt die YAML-Eigenschaften jeder vorhandenen Watchlist- und Lese-Notiz neu und übernimmt neuere Felder in ältere Notizen. Der Inhalt (## Notes / ## Quotes) bleibt erhalten. Notizen ohne Datei werden übersprungen; lege sie mit „Regenerate“ an.',
			button: 'Eigenschaften neu schreiben',
			confirm: 'Das schreibt die YAML-Eigenschaften aller vorhandenen Notizen für {titles} Titel und {reading} Leseeinträge neu. Der Inhalt bleibt erhalten; Notizen ohne Datei werden übersprungen. Fortfahren?',
			none: 'Keine Notizen zum Neuschreiben.',
			progress: 'Schreibe Eigenschaften neu… {done} / {total}',
			result: { one: '{state}: {count} Notiz neu geschrieben.', other: '{state}: {count} Notizen neu geschrieben.' },
			resultSkipped: { one: '{state}: {count} Notiz neu geschrieben, {skipped} übersprungen (keine Datei).', other: '{state}: {count} Notizen neu geschrieben, {skipped} übersprungen (keine Datei).' },
		},
		studios: {
			name: 'Studios für alle Titel abrufen',
			desc: 'Füllt Studio oder Sender für jeden Watchlist-Titel, der noch keins hat. Filme und Serien nutzen den eingestellten Filmdienst, Anime die eingestellte Anime-Quelle. Titel mit Eintrag werden übersprungen, ein erneuter Lauf ist also günstig.',
			button: 'Studios abrufen',
			allHave: 'Jeder Titel hat bereits ein Studio.',
			confirm: { one: 'Das löst etwa eine API-Anfrage für den {count} Titel ohne Studio aus. Du kannst jederzeit abbrechen. Fortfahren?', other: 'Das löst etwa eine API-Anfrage für jeden der {count} Titel ohne Studio aus. Du kannst jederzeit abbrechen. Fortfahren?' },
			progress: 'Rufe Studios ab… {done} / {total}',
			result: { one: '{state}: {count} Titel ergänzt.', other: '{state}: {count} Titel ergänzt.' },
			resultMissed: { one: '{state}: {count} Titel ergänzt, {missed} ohne verfügbares Studio.', other: '{state}: {count} Titel ergänzt, {missed} ohne verfügbares Studio.' },
		},
		hints: {
			name: 'Hinweisbanner anzeigen',
			desc: 'Informative Hinweisbanner in den Tabs Demnächst, Eigene Listen und Entwürfe anzeigen.',
		},
		statusBar: {
			name: 'Demnächst-Zähler in der Statusleiste anzeigen',
			desc: 'Zeigt einen „N fällig“-Zähler in der Statusleiste, wenn Einträge aus Demnächst fällig sind. Ein Klick öffnet den Tab Demnächst. (Nur Desktop.)',
		},
	},
	tags: {
		type: 'Typ',
		status: 'Status',
		priority: 'Priorität',
		genre: 'Genre',
		platform: 'Plattform',
		namePlaceholder: 'Name',
		add: '+ hinzufügen',
		exists: '„{name}“ existiert bereits.',
		removed: '„{name}“ entfernt.',
		rename: '{name} umbenennen',
		infoStatusLocked: 'Statusnamen sind gesperrt. Nur die Farbe kann geändert werden.',
		infoTypes: 'Eingebaute Typen sind gesperrt. Eigene Typen können hinzugefügt und entfernt werden.',
		infoGenres: 'Genres können umbenannt, umgefärbt, hinzugefügt und entfernt werden. Beim Umbenennen werden alle Spiele mit diesem Genre aktualisiert.',
		infoPlatforms: 'Plattformen können umbenannt, umgefärbt, hinzugefügt und entfernt werden. Beim Umbenennen werden alle Spiele mit dieser Plattform aktualisiert; beim Entfernen wird sie bei ihnen gelöscht.',
	},
	customize: {
		theme: {
			title: 'Farbschema',
			sub: 'Vordefinierte Palette für jeden Tab',
			default: 'Standard',
		},
		cards: {
			title: 'Karten',
			sub: 'Größe und Textlayout der Poster-Karten in jedem Tab',
		},
		watchlist: {
			sub: 'Typ-, Status- und Staffelfarben für Titel',
		},
		reading: {
			sub: 'Badge- und Statusfarben für Bücher und Manga',
		},
		games: {
			sub: 'Status-, Genre- und Plattformfarben für den Tab Spiele',
			note: 'Spielnotizen übernehmen ein umbenanntes Genre oder eine umbenannte Plattform beim nächsten Speichern des Spiels.',
		},
		shared: {
			title: 'Gemeinsam',
			sub: 'Priorität und Sternebewertungen, von allen drei Bibliotheken genutzt',
		},
		readingType: {
			manga: 'Manga',
			book: 'Buch',
			help: 'Die Badge-Farbe für Buch oder Manga überall dort, wo der Typ angezeigt wird.',
		},
		rating: {
			label: 'Bewertungssystem',
			help: 'Farbe und Text jeder Sternebewertung in Watchlist, Lesen und Spiele. Ein ganzer Stern teilt sich eine Stufe mit dem halben Schritt darunter; z. B. gehören 2,5★ und 3★ beide zu „Good“.',
			labelAria: 'Beschriftung für {tier}-Sterne-Bewertung',
		},
		season: {
			label: 'Staffelfarben',
			help: 'Die Farben wechseln der Reihe nach durch die Staffeln (Staffel 1 = Farbe 1 usw.).',
			name: 'Staffel {number}',
			add: '+ Farbe hinzufügen',
		},
	},
	watchlist: {
		main: {
			sub: 'Episodennummerierung, Standardwerte beim Hinzufügen und Badge-Stil',
		},
		numbering: {
			name: 'Episodennummerierung',
			desc: 'Absolut: Episoden werden über alle Staffeln von 1 bis n durchnummeriert. Pro Staffel: Jede Staffel beginnt wieder bei 1 (nur Anzeige, die Daten bleiben unverändert).',
			absolute: 'Absolut',
			perSeason: 'Pro Staffel',
		},
		defaultType: {
			name: 'Standardtyp für neue Titel',
			desc: 'Typ, der beim Hinzufügen eines Titels vorausgewählt ist. „Zuletzt verwendeter Typ“ folgt dem, was du zuletzt hinzugefügt hast.',
			last: '* Zuletzt verwendeter Typ',
		},
		topCredits: {
			name: 'Anzahl Top-Regisseure / -Schauspieler',
			desc: 'Wie viele Einträge das Dashboard in den Listen der Top-Regisseure und Top-Schauspieler zeigt.',
		},
		autoComplete: {
			name: 'Bei letzter Episode automatisch abschließen',
			desc: 'Setzt den Status auf „Abgeschlossen“, sobald alle Episoden gesehen sind.',
		},
		coloredBadges: {
			name: 'Farbige Typ-Badges',
			desc: 'Typ- und Status-Badges in ihren eingestellten Farben anzeigen. Zum Ausschalten: schlichter Textstil.',
		},
		openAfterAdd: {
			name: 'Watchlist nach dem Hinzufügen öffnen',
			desc: 'Springt zum Watchlist-Tab und öffnet den neuen Titel, wenn er über die Befehlspalette hinzugefügt wurde.',
		},
	},
	reading: {
		main: {
			sub: 'Standardwerte beim Hinzufügen von Büchern und Manga',
		},
		defaultStatus: {
			name: 'Standardstatus für neue Einträge',
			desc: 'Status, der im Dialog „Buch hinzufügen“ / „Manga hinzufügen“ vorausgewählt ist.',
		},
		subTab: {
			name: 'Standard-Unter-Tab',
			desc: 'Welcher Unter-Tab standardmäßig öffnet, wenn du zum Tab Lesen wechselst.',
			books: 'Bücher',
			manga: 'Manga',
		},
	},
	steam: {
		missing: 'Schlüssel oder Steam-ID fehlt',
		badKey: 'Fehlgeschlagen; prüfe deinen API-Schlüssel',
		private: 'Profil ist privat; stelle „Spieldetails“ auf „Öffentlich“',
		empty: 'Keine Spiele auf diesem Konto',
		unreachable: 'Steam nicht erreichbar',
	},
} satisfies DeepPartial<typeof enSettings>;

export default settings;
