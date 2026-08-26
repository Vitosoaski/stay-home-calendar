import { createHash, randomBytes } from "node:crypto";
import { buildSchedule } from "./sheets.js";
import { getCache, setCache } from "./db.js";
import { csvUrl } from "../config.js";

const CACHE_KEY = "schedule";

export function createScheduleService({ db, config, fetchImpl = fetch }) {
	// Sorteado a cada processo: impede que um cliente com versão antiga confunda
	// um servidor reiniciado com "nada mudou".
	const bootId = randomBytes(4).toString("hex");

	let counter = 0;
	let schedule = null;
	let signature = null;
	let updatedAt = null;
	let stale = true;
	let error = null;
	let timer = null;
	let fetchCsv = fetchImpl;

	// Sobe já com o último horário bom, para o site não nascer vazio.
	const cached = getCache(db, CACHE_KEY);
	if (cached) {
		try {
			const parsed = JSON.parse(cached.value);
			schedule = parsed.schedule;
			updatedAt = cached.fetched_at;
			counter = 1;
		} catch {
			// Cache corrompido não vale nada; a primeira busca resolve.
		}
	}

	async function download(gid) {
		const response = await fetchCsv(csvUrl(config.sheetId, gid));
		if (!response.ok) {
			throw new Error(`planilha respondeu HTTP ${response.status}`);
		}
		const text = await response.text();
		// Planilha que deixou de ser pública devolve a página de login do Google.
		if (text.trimStart().startsWith("<")) {
			throw new Error("a resposta não parece CSV — a planilha ainda está pública?");
		}
		return text;
	}

	async function refresh() {
		try {
			const [plannerCsv, gradeCsv, subjectsCsv] = await Promise.all([
				download(config.gids.planner),
				download(config.gids.grade),
				download(config.gids.subjects),
			]);

			const next = createHash("sha256").update(plannerCsv).update(gradeCsv).update(subjectsCsv).digest("hex");

			stale = false;
			error = null;
			updatedAt = new Date().toISOString();

			if (next === signature) return { ok: true, changed: false };

			schedule = buildSchedule({
				plannerCsv,
				gradeCsv,
				subjectsCsv,
				phase: config.phase,
				holidayCode: config.holidayCode,
				periodMinutes: config.periodMinutes,
				frequencyLimit: config.frequencyLimit,
			});
			signature = next;
			counter++;
			setCache(db, CACHE_KEY, JSON.stringify({ schedule }));
			return { ok: true, changed: true };
		} catch (failure) {
			// Mantém o último horário bom no ar; só marca que está velho.
			stale = true;
			error = failure.message;
			return { ok: false, changed: false, error: failure.message };
		}
	}

	return {
		refresh,
		setFetch(impl) {
			fetchCsv = impl;
		},
		start() {
			refresh();
			timer = setInterval(refresh, config.refreshMs);
			timer.unref?.();
		},
		stop() {
			clearInterval(timer);
			timer = null;
		},
		bumpVersion() {
			counter++;
		},
		current() {
			return {
				schedule,
				version: `${bootId}:${counter}`,
				updatedAt,
				stale,
				error,
			};
		},
	};
}
