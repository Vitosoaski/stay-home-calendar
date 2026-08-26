import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openDb, getCache } from "../src/db.js";
import { createScheduleService } from "../src/schedule.js";

const read = (name) => readFileSync(new URL(`./fixtures/${name}.csv`, import.meta.url), "utf8");

const config = {
	sheetId: "x",
	gids: { planner: "1", grade: "2", subjects: "3" },
	phase: "4",
	holidayCode: "Fer/Rec",
	periodMinutes: 50,
	frequencyLimit: 0.25,
	refreshMs: 1000,
};

// Devolve o CSV certo conforme o gid pedido na URL.
function fakeFetch({ planner = read("planner-hf4"), fail = false } = {}) {
	let calls = 0;
	const impl = async (url) => {
		calls++;
		if (fail) throw new Error("rede fora do ar");
		const body = url.includes("gid=1")
			? planner
			: url.includes("gid=2")
				? read("grade-4fase")
				: read("disciplinas");
		return { ok: true, status: 200, text: async () => body };
	};
	impl.calls = () => calls;
	return impl;
}

test("a primeira busca monta o horário e marca versão", async () => {
	const db = openDb(":memory:");
	const service = createScheduleService({ db, config, fetchImpl: fakeFetch() });

	const result = await service.refresh();
	assert.equal(result.ok, true);
	assert.equal(result.changed, true);

	const state = service.current();
	assert.equal(state.stale, false);
	assert.equal(state.schedule.dates.length, 120);
	assert.match(state.version, /^[a-z0-9]+:1$/);
});

test("CSV igual não muda a versão", async () => {
	const db = openDb(":memory:");
	const service = createScheduleService({ db, config, fetchImpl: fakeFetch() });

	await service.refresh();
	const before = service.current().version;
	const second = await service.refresh();

	assert.equal(second.changed, false);
	assert.equal(service.current().version, before);
});

test("CSV diferente sobe a versão", async () => {
	const db = openDb(":memory:");
	const original = read("planner-hf4");
	let planner = original;
	const service = createScheduleService({
		db,
		config,
		fetchImpl: async (url) => ({
			ok: true,
			status: 200,
			text: async () =>
				url.includes("gid=1") ? planner : url.includes("gid=2") ? read("grade-4fase") : read("disciplinas"),
		}),
	});

	await service.refresh();
	const before = service.current().version;
	planner = original.replace("ExtPes", "OUTRA");
	await service.refresh();

	assert.notEqual(service.current().version, before);
});

test("guarda o último horário bom no banco", async () => {
	const db = openDb(":memory:");
	await createScheduleService({ db, config, fetchImpl: fakeFetch() }).refresh();
	const cached = JSON.parse(getCache(db, "schedule").value);
	assert.equal(cached.schedule.dates.length, 120);
});

test("sobe do cache do banco sem precisar da rede", () => {
	const db = openDb(":memory:");
	const first = createScheduleService({ db, config, fetchImpl: fakeFetch() });
	return first.refresh().then(() => {
		const restarted = createScheduleService({ db, config, fetchImpl: fakeFetch({ fail: true }) });
		const state = restarted.current();
		assert.equal(state.schedule.dates.length, 120);
		assert.equal(state.stale, true, "ainda não sincronizou nesta execução");
	});
});

test("falha de rede preserva o horário anterior e registra o erro", async () => {
	const db = openDb(":memory:");
	const service = createScheduleService({ db, config, fetchImpl: fakeFetch() });
	await service.refresh();
	const good = service.current().schedule;

	service.setFetch(fakeFetch({ fail: true }));
	const result = await service.refresh();

	assert.equal(result.ok, false);
	assert.match(result.error, /rede fora do ar/);
	assert.deepEqual(service.current().schedule, good, "o horário bom continua no ar");
	assert.equal(service.current().stale, true);
});

test("resposta em HTML é tratada como falha, não como dado", async () => {
	const db = openDb(":memory:");
	const service = createScheduleService({
		db,
		config,
		fetchImpl: async () => ({ ok: true, status: 200, text: async () => "<!DOCTYPE html><html>login</html>" }),
	});
	const result = await service.refresh();
	assert.equal(result.ok, false);
	assert.match(result.error, /não parece CSV|pública/i);
});

test("HTTP 404 é falha", async () => {
	const db = openDb(":memory:");
	const service = createScheduleService({
		db,
		config,
		fetchImpl: async () => ({ ok: false, status: 404, text: async () => "" }),
	});
	assert.equal((await service.refresh()).ok, false);
});
