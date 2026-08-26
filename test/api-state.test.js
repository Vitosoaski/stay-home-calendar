import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers.js";

const signup = async (app, name, pin = "1234") => app.post("/api/signup", { groupCode: "segredo", name, pin });

const blockOn = (state, date, subject) =>
	state.days.find((d) => d.date === date).blocks.find((b) => b.subject === subject);

test("o estado traz a semana pedida com seis dias", async () => {
	const app = await startTestServer();
	const res = await app.get("/api/state?week=2026-08-03");
	assert.equal(res.status, 200);
	assert.equal(res.body.days.length, 6);
	assert.deepEqual(
		res.body.days.map((d) => d.date),
		["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08"],
	);
	await app.close();
});

test("qualquer data da semana devolve a mesma semana", async () => {
	const app = await startTestServer();
	const wednesday = await app.get("/api/state?week=2026-08-05");
	assert.equal(wednesday.body.week.monday, "2026-08-03");
	await app.close();
});

test("o estado é público, mas a frequência é só de quem está logado", async () => {
	const app = await startTestServer();
	const anonymous = await app.get("/api/state?week=2026-08-03");
	assert.equal(anonymous.body.frequency, null);

	const ana = await signup(app, "Ana");
	const logged = await app.get("/api/state?week=2026-08-03", { cookie: ana.cookie });
	assert.ok(Array.isArray(logged.body.frequency));
	await app.close();
});

test("marcar falta aparece no bloco, com o motivo", async () => {
	const app = await startTestServer();
	const ana = await signup(app, "Ana");
	const state = await app.get("/api/state?week=2026-08-03");
	const block = blockOn(state.body, "2026-08-03", "ExtPes");

	const marked = await app.put(
		"/api/absences",
		{ blockId: block.id, value: true, reason: "consulta" },
		{ cookie: ana.cookie },
	);
	assert.equal(marked.status, 200);

	const after = await app.get("/api/state?week=2026-08-03");
	const updated = blockOn(after.body, "2026-08-03", "ExtPes");
	assert.equal(updated.absences.length, 1);
	assert.equal(updated.absences[0].reason, "consulta");
	await app.close();
});

test("desmarcar remove todos os períodos da aula", async () => {
	const app = await startTestServer();
	const ana = await signup(app, "Ana");
	const block = blockOn((await app.get("/api/state?week=2026-08-03")).body, "2026-08-03", "ExtPes");
	assert.equal(block.slots.length, 3, "esta aula tem três períodos");

	await app.put("/api/absences", { blockId: block.id, value: true }, { cookie: ana.cookie });
	await app.put("/api/absences", { blockId: block.id, value: false }, { cookie: ana.cookie });

	const after = await app.get("/api/state?week=2026-08-03");
	assert.deepEqual(blockOn(after.body, "2026-08-03", "ExtPes").absences, []);
	await app.close();
});

test("marcar exige estar logado", async () => {
	const app = await startTestServer();
	const block = blockOn((await app.get("/api/state?week=2026-08-03")).body, "2026-08-03", "ExtPes");
	assert.equal((await app.put("/api/absences", { blockId: block.id, value: true })).status, 401);
	await app.close();
});

test("não é possível marcar falta em nome de outra pessoa", async () => {
	const app = await startTestServer();
	const ana = await signup(app, "Ana");
	const joao = await signup(app, "João", "5678");
	const block = blockOn((await app.get("/api/state?week=2026-08-03")).body, "2026-08-03", "ExtPes");

	// Mesmo mandando o id do João explicitamente, a falta é da Ana.
	await app.put(
		"/api/absences",
		{ blockId: block.id, value: true, userId: joao.body.user.id, user_id: joao.body.user.id },
		{ cookie: ana.cookie },
	);

	const after = await app.get("/api/state?week=2026-08-03");
	const marks = blockOn(after.body, "2026-08-03", "ExtPes").absences;
	assert.equal(marks.length, 1);
	assert.equal(marks[0].userId, ana.body.user.id);
	await app.close();
});

test("bloco inexistente é recusado", async () => {
	const app = await startTestServer();
	const ana = await signup(app, "Ana");
	for (const blockId of ["2026-08-03|23:59", "2020-01-01|07:30", "lixo", ""]) {
		const res = await app.put("/api/absences", { blockId, value: true }, { cookie: ana.cookie });
		assert.equal(res.status, 400, `${blockId} deveria ser recusado`);
	}
	await app.close();
});

test("não dá para faltar em feriado, porque não há aula", async () => {
	const app = await startTestServer();
	const ana = await signup(app, "Ana");
	const holiday = (await app.get("/api/state?week=2026-09-07")).body.days.find((d) => d.date === "2026-09-07");
	assert.equal(holiday.holiday, true);
	assert.deepEqual(holiday.blocks, []);

	const res = await app.put("/api/absences", { blockId: "2026-09-07|07:30", value: true }, { cookie: ana.cookie });
	assert.equal(res.status, 400);
	await app.close();
});

test("motivo longo demais é recusado", async () => {
	const app = await startTestServer();
	const ana = await signup(app, "Ana");
	const block = blockOn((await app.get("/api/state?week=2026-08-03")).body, "2026-08-03", "ExtPes");
	const res = await app.put(
		"/api/absences",
		{ blockId: block.id, value: true, reason: "x".repeat(200) },
		{ cookie: ana.cookie },
	);
	assert.equal(res.status, 400);
	await app.close();
});

test("o motivo pode ser alterado depois de marcar", async () => {
	const app = await startTestServer();
	const ana = await signup(app, "Ana");
	const block = blockOn((await app.get("/api/state?week=2026-08-03")).body, "2026-08-03", "ExtPes");

	await app.put("/api/absences", { blockId: block.id, value: true }, { cookie: ana.cookie });
	await app.patch("/api/absences", { blockId: block.id, reason: "prova" }, { cookie: ana.cookie });

	const after = await app.get("/api/state?week=2026-08-03");
	assert.equal(blockOn(after.body, "2026-08-03", "ExtPes").absences[0].reason, "prova");
	await app.close();
});

test("a frequência conta os períodos e calcula quanto ainda dá para faltar", async () => {
	const app = await startTestServer();
	const ana = await signup(app, "Ana");
	const block = blockOn((await app.get("/api/state?week=2026-08-03")).body, "2026-08-03", "ExtPes");
	await app.put("/api/absences", { blockId: block.id, value: true }, { cookie: ana.cookie });

	const state = await app.get("/api/state?week=2026-08-03", { cookie: ana.cookie });
	const extPes = state.body.frequency.find((f) => f.subject === "ExtPes");
	assert.equal(extPes.missed, 3); // a aula tem três períodos
	assert.equal(extPes.limit, 18); // 25% de 72
	assert.equal(extPes.remaining, 15);
	await app.close();
});

test("a versão muda quando alguém marca falta", async () => {
	const app = await startTestServer();
	const ana = await signup(app, "Ana");
	const before = (await app.get("/api/state?week=2026-08-03")).body.version;

	const block = blockOn((await app.get("/api/state?week=2026-08-03")).body, "2026-08-03", "ExtPes");
	await app.put("/api/absences", { blockId: block.id, value: true }, { cookie: ana.cookie });

	assert.notEqual((await app.get("/api/state?week=2026-08-03")).body.version, before);
	await app.close();
});

test("versão igual devolve resposta curta", async () => {
	const app = await startTestServer();
	const first = await app.get("/api/state?week=2026-08-03");
	const again = await app.get(`/api/state?week=2026-08-03&v=${encodeURIComponent(first.body.version)}`);
	assert.equal(again.body.unchanged, true);
	assert.equal(again.body.days, undefined);
	await app.close();
});

test("o estado sempre traz o dia de hoje, mesmo olhando outra semana", async () => {
	const app = await startTestServer();
	const state = await app.get("/api/state?week=2026-08-03");
	assert.ok(state.body.today.date);
	assert.ok(Array.isArray(state.body.today.blocks));
	await app.close();
});

test("semana fora do semestre devolve dias vazios, não erro", async () => {
	const app = await startTestServer();
	const res = await app.get("/api/state?week=2030-01-07");
	assert.equal(res.status, 200);
	assert.equal(res.body.days.length, 6);
	assert.ok(res.body.days.every((d) => d.blocks.length === 0));
	await app.close();
});

test("os limites de navegação cobrem o semestre", async () => {
	const app = await startTestServer();
	const week = (await app.get("/api/state?week=2026-08-03")).body.week;
	assert.equal(week.first, "2026-08-03");
	assert.equal(week.last, "2026-12-14");
	await app.close();
});
