import { test } from "node:test";
import assert from "node:assert/strict";
import {
	openDb,
	createUser,
	findUserByName,
	getUser,
	listUsers,
	updateUser,
	getPhoto,
	createSession,
	findSession,
	deleteSession,
	setAbsence,
	setReason,
	absencesBetween,
	absenceCounts,
	getCache,
	setCache,
} from "../src/db.js";

const fresh = () => openDb(":memory:");
const makeUser = (db, name) =>
	createUser(db, {
		name,
		color: "#abc",
		pinHash: "h",
		pinSalt: "s",
		photo: null,
		photoType: null,
	});

test("cria usuário e nunca devolve o hash do PIN", () => {
	const db = fresh();
	const user = makeUser(db, "João");
	assert.equal(user.name, "João");
	assert.equal(user.hasPhoto, false);
	assert.equal(user.pinHash, undefined);
	assert.equal(user.pin_hash, undefined);
	assert.deepEqual(getUser(db, user.id), user);
});

test("nome é único ignorando caixa e acento não conta como igual", () => {
	const db = fresh();
	makeUser(db, "João");
	assert.throws(() => makeUser(db, "joão"), /já existe/i);
	assert.doesNotThrow(() => makeUser(db, "Joao"));
});

test("busca por nome ignora caixa e traz o hash para conferência", () => {
	const db = fresh();
	makeUser(db, "João");
	const row = findUserByName(db, "JOÃO");
	assert.equal(row.pin_hash, "h");
	assert.equal(findUserByName(db, "ninguém"), undefined);
});

test("guardar foto incrementa a versão, para invalidar cache do navegador", () => {
	const db = fresh();
	const user = makeUser(db, "Ana");
	assert.equal(user.photoVersion, 0);
	const bytes = new Uint8Array([1, 2, 3]);
	const updated = updateUser(db, user.id, { photo: bytes, photoType: "image/webp" });
	assert.equal(updated.hasPhoto, true);
	assert.equal(updated.photoVersion, 1);
	assert.deepEqual(getPhoto(db, user.id).photo, bytes);
});

test("marcar falta grava um período por vez e é idempotente", () => {
	const db = fresh();
	const user = makeUser(db, "Ana");
	const args = { userId: user.id, date: "2026-08-03", slots: ["07:30", "08:20"], subject: "MAT" };

	assert.equal(setAbsence(db, { ...args, value: true }).changed, true);
	assert.equal(setAbsence(db, { ...args, value: true }).changed, false);
	assert.equal(absencesBetween(db, "2026-08-01", "2026-08-31").length, 2);

	assert.equal(setAbsence(db, { ...args, value: false }).changed, true);
	assert.equal(absencesBetween(db, "2026-08-01", "2026-08-31").length, 0);
});

test("faltas de um usuário não tocam nas de outro", () => {
	const db = fresh();
	const ana = makeUser(db, "Ana");
	const joao = makeUser(db, "João");
	const args = { date: "2026-08-03", slots: ["07:30"], subject: "MAT", value: true };

	setAbsence(db, { ...args, userId: ana.id });
	setAbsence(db, { ...args, userId: joao.id });
	setAbsence(db, { ...args, userId: ana.id, value: false });

	const rows = absencesBetween(db, "2026-08-03", "2026-08-03");
	assert.equal(rows.length, 1);
	assert.equal(rows[0].user_id, joao.id);
});

test("o intervalo de busca é inclusivo nas duas pontas", () => {
	const db = fresh();
	const user = makeUser(db, "Ana");
	for (const date of ["2026-08-02", "2026-08-03", "2026-08-08", "2026-08-09"]) {
		setAbsence(db, { userId: user.id, date, slots: ["07:30"], subject: "MAT", value: true });
	}
	const rows = absencesBetween(db, "2026-08-03", "2026-08-08");
	assert.deepEqual(
		rows.map((r) => r.date),
		["2026-08-03", "2026-08-08"],
	);
});

test("motivo é gravado na marcação e pode ser alterado depois", () => {
	const db = fresh();
	const user = makeUser(db, "Ana");
	const slots = ["07:30", "08:20"];
	setAbsence(db, { userId: user.id, date: "2026-08-03", slots, subject: "MAT", value: true, reason: "consulta" });

	let rows = absencesBetween(db, "2026-08-03", "2026-08-03");
	assert.deepEqual(
		rows.map((r) => r.reason),
		["consulta", "consulta"],
	);

	setReason(db, { userId: user.id, date: "2026-08-03", slots, reason: "prova" });
	rows = absencesBetween(db, "2026-08-03", "2026-08-03");
	assert.deepEqual(
		rows.map((r) => r.reason),
		["prova", "prova"],
	);
});

test("conta faltas por matéria", () => {
	const db = fresh();
	const user = makeUser(db, "Ana");
	setAbsence(db, { userId: user.id, date: "2026-08-03", slots: ["07:30", "08:20"], subject: "MAT", value: true });
	setAbsence(db, { userId: user.id, date: "2026-08-10", slots: ["07:30"], subject: "MAT", value: true });
	setAbsence(db, { userId: user.id, date: "2026-08-04", slots: ["07:30"], subject: "FIS", value: true });

	const counts = Object.fromEntries(absenceCounts(db, user.id).map((r) => [r.subject, r.count]));
	assert.deepEqual(counts, { MAT: 3, FIS: 1 });
});

test("apagar usuário leva junto faltas e sessões", () => {
	const db = fresh();
	const user = makeUser(db, "Ana");
	setAbsence(db, { userId: user.id, date: "2026-08-03", slots: ["07:30"], subject: "MAT", value: true });
	createSession(db, "token-hash", user.id);

	db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
	assert.equal(absencesBetween(db, "2026-08-03", "2026-08-03").length, 0);
	assert.equal(findSession(db, "token-hash"), undefined);
});

test("sessão é encontrada pelo hash e some ao ser apagada", () => {
	const db = fresh();
	const user = makeUser(db, "Ana");
	createSession(db, "abc", user.id);
	assert.equal(findSession(db, "abc").user_id, user.id);
	deleteSession(db, "abc");
	assert.equal(findSession(db, "abc"), undefined);
});

test("cache guarda e sobrescreve pelo mesmo nome", () => {
	const db = fresh();
	assert.equal(getCache(db, "schedule"), undefined);
	setCache(db, "schedule", '{"a":1}');
	setCache(db, "schedule", '{"a":2}');
	assert.equal(getCache(db, "schedule").value, '{"a":2}');
	assert.ok(getCache(db, "schedule").fetched_at);
});

test("listUsers vem em ordem de nome", () => {
	const db = fresh();
	makeUser(db, "Zeca");
	makeUser(db, "Ana");
	makeUser(db, "joão");
	assert.deepEqual(
		listUsers(db).map((u) => u.name),
		["Ana", "joão", "Zeca"],
	);
});
