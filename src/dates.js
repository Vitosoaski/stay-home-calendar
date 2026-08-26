const pad = (n) => String(n).padStart(2, "0");

export function isoDate(day, month, year) {
	return `${year}-${pad(month)}-${pad(day)}`;
}

export function addMinutes(hhmm, minutes) {
	const [h, m] = hhmm.split(":").map(Number);
	const total = h * 60 + m + minutes;
	return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

// Interpreta 'YYYY-MM-DD' como data neutra (UTC), sem deixar o fuso da máquina
// deslocar o dia.
function toUtc(iso) {
	const [y, m, d] = iso.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date) {
	return isoDate(date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCFullYear());
}

export function mondayOf(iso) {
	const date = toUtc(iso);
	const weekday = date.getUTCDay(); // 0 = domingo
	const back = weekday === 0 ? 6 : weekday - 1;
	date.setUTCDate(date.getUTCDate() - back);
	return fromUtc(date);
}

export function addDays(iso, days) {
	const date = toUtc(iso);
	date.setUTCDate(date.getUTCDate() + days);
	return fromUtc(date);
}

export function weekDates(mondayIso) {
	return Array.from({ length: 6 }, (_, i) => addDays(mondayIso, i));
}

export function todayIso(tz) {
	// en-CA formata como YYYY-MM-DD, que é exatamente o formato ISO que usamos.
	return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export function isTime(text) {
	return /^\d{1,2}:\d{2}$/.test(String(text).trim());
}

export function isDayMonth(text) {
	return /^\d{1,2}\/\d{1,2}$/.test(String(text).trim());
}
