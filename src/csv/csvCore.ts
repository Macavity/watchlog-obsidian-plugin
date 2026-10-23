// Shared CSV parsing/escaping/date helpers for watch and reading CSV modals

export function escapeCsvField(value: string | number | null | undefined): string {
	const s = String(value ?? '');
	if (s.includes(',') || s.includes('"') || s.includes('\n')) {
		return `"${s.replace(/"/g, '""')}"`;
	}
	return s;
}

interface CsvState {
	rows: string[][];
	row: string[];
	cur: string;
	inQuotes: boolean;
}

/** Consumes the character at `i`; returns the index of the last character consumed. */
function consumeChar(st: CsvState, t: string, i: number): number {
	const ch = t[i];
	if (st.inQuotes) {
		if (ch !== '"') st.cur += ch;
		else if (t[i + 1] === '"') { st.cur += '"'; return i + 1; }
		else st.inQuotes = false;
	} else if (ch === '"') {
		st.inQuotes = true;
	} else if (ch === ',') {
		st.row.push(st.cur); st.cur = '';
	} else if (ch === '\n') {
		st.row.push(st.cur); st.cur = '';
		st.rows.push(st.row); st.row = [];
	} else {
		st.cur += ch;
	}
	return i;
}

/** Full CSV parser: quoted fields with embedded newlines, escaped quotes, comma delimiter. */
export function parseCSV(text: string): string[][] {
	const st: CsvState = { rows: [], row: [], cur: '', inQuotes: false };
	// normalize CRLF to LF
	const t = text.replace(/\r\n?/g, '\n');
	for (let i = 0; i < t.length; i++) i = consumeChar(st, t, i);
	// final field/row
	if (st.cur.length > 0 || st.row.length > 0) {
		st.row.push(st.cur);
		st.rows.push(st.row);
	}
	const { rows } = st;
	// drop trailing fully-empty rows
	while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c === '')) rows.pop();
	return rows;
}

// Date parsing

const MONTH_NAMES: Record<string, number> = {
	jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
	jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function toIso(y: number, mm: number, dd: number): string {
	return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * Format matchers return the ISO date, null (matched but invalid: final),
 * or undefined (not applicable: try the next matcher).
 */
type DateMatcher = (s: string) => string | null | undefined;

// YYYY-MM-DD (already storage format)
const matchIso: DateMatcher = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

// D/M/YYYY, DD/MM/YYYY, M/D/YYYY, MM/DD/YYYY
const matchSlash: DateMatcher = (s) => {
	const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (!m) return undefined;
	const a = parseInt(m[1]!, 10), b = parseInt(m[2]!, 10), y = parseInt(m[3]!, 10);
	let dd: number, mm: number;
	if (a > 12)      { dd = a; mm = b; }  // Must be DD/MM
	else if (b > 12) { mm = a; dd = b; }  // Must be MM/DD
	else             { dd = a; mm = b; }  // Ambiguous → assume DD/MM
	if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
	return toIso(y, mm, dd);
};

// "27 Jun 2025"
const matchDayMonthName: DateMatcher = (s) => {
	const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
	if (!m) return undefined;
	const mm = MONTH_NAMES[m[2]!.toLowerCase().slice(0, 3)];
	return mm ? toIso(parseInt(m[3]!, 10), mm, parseInt(m[1]!, 10)) : undefined;
};

// "Jun 27, 2025" / "Jun 27 2025"
const matchMonthNameDay: DateMatcher = (s) => {
	const m = s.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/);
	if (!m) return undefined;
	const mm = MONTH_NAMES[m[1]!.toLowerCase().slice(0, 3)];
	return mm ? toIso(parseInt(m[3]!, 10), mm, parseInt(m[2]!, 10)) : undefined;
};

// DD.MM.YYYY or DD-MM-YYYY
const matchDotDash: DateMatcher = (s) => {
	const m = s.match(/^(\d{1,2})[.-](\d{1,2})[.-](\d{4})$/);
	if (!m) return undefined;
	const dd = parseInt(m[1]!, 10), mm = parseInt(m[2]!, 10), y = parseInt(m[3]!, 10);
	return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 ? toIso(y, mm, dd) : undefined;
};

// fallback: native Date.parse
const matchNative: DateMatcher = (s) => {
	const parsed = new Date(s);
	if (isNaN(parsed.getTime())) return undefined;
	return toIso(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
};

const DATE_MATCHERS: DateMatcher[] = [
	matchIso, matchSlash, matchDayMonthName, matchMonthNameDay, matchDotDash, matchNative,
];

/** Parses a date in any common format to YYYY-MM-DD, or null when unparseable. */
export function parseCsvDate(raw: string): string | null {
	const s = raw.trim();
	if (!s) return null;
	try {
		for (const match of DATE_MATCHERS) {
			const result = match(s);
			if (result !== undefined) return result;
		}
		return null;
	} catch {
		return null;
	}
}
