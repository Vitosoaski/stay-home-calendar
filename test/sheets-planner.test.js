import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePlanner } from "../src/sheets.js";

const csv = readFileSync(new URL("./fixtures/planner-hf4.csv", import.meta.url), "utf8");
const planner = parsePlanner(csv, { holidayCode: "Fer/Rec", periodMinutes: 50 });
const byDate = new Map(planner.days.map((d) => [d.date, d]));

test("cobre o semestre inteiro", () => {
	assert.equal(planner.days.length, 120); // 20 semanas x 6 dias
	assert.equal(planner.year, 2026);
	assert.equal(planner.days[0].date, "2026-08-03");
	assert.equal(planner.days.at(-1).date, "2026-12-19");
});

test("agrupa períodos consecutivos da mesma matéria numa aula só", () => {
	const blocks = byDate.get("2026-08-03").blocks;
	assert.equal(blocks.length, 2);
	assert.equal(blocks[0].subject, "ExtPes");
	assert.deepEqual(blocks[0].slots, ["07:30", "08:20", "09:10"]);
	assert.equal(blocks[0].start, "07:30");
	assert.equal(blocks[0].end, "10:00");
	assert.equal(blocks[1].subject, "DWeb-I");
	assert.deepEqual(blocks[1].slots, ["10:20", "11:10"]);
	assert.equal(blocks[1].end, "12:00");
});

test("não funde aulas através do intervalo", () => {
	for (const day of planner.days) {
		for (const block of day.blocks) {
			assert.ok(
				!block.slots.includes("09:10") || !block.slots.includes("10:20"),
				`${day.date}: aula atravessou o intervalo`,
			);
		}
	}
});

test("resolve o nome completo pela legenda", () => {
	assert.equal(byDate.get("2026-08-03").blocks[0].name, "EXTENSÃO E PESQUISA EM COMPUTAÇÃO");
});

test("marca feriado e não gera aulas nele", () => {
	const day = byDate.get("2026-09-07"); // Independência
	assert.equal(day.holiday, true);
	assert.deepEqual(day.blocks, []);
});

test("dia sem aula não é feriado, é só vazio", () => {
	const saturday = byDate.get("2026-08-08");
	assert.equal(saturday.weekday, 7);
	assert.equal(saturday.holiday, false);
	assert.deepEqual(saturday.blocks, []);
});

test("acompanha a mudança de horário no meio do semestre", () => {
	// terça era Física até outubro e virou BD2 em novembro
	const october = byDate.get("2026-10-27").blocks.map((b) => b.subject);
	const november = byDate.get("2026-11-03").blocks.map((b) => b.subject);
	assert.ok(october.includes("Fisica"));
	assert.ok(!november.includes("Fisica"));
	assert.ok(november.includes("BD2"));
});

test("o id do bloco identifica data e início", () => {
	assert.equal(byDate.get("2026-08-03").blocks[0].id, "2026-08-03|07:30");
});

test("conta os períodos de cada matéria no semestre", () => {
	// confere com a carga horária oficial: 72, 72, 36 batem exatamente
	assert.equal(planner.periodCounts.get("MetNum"), 72);
	assert.equal(planner.periodCounts.get("BD2"), 72);
	assert.equal(planner.periodCounts.get("CiTecSO"), 36);
	assert.ok(!planner.periodCounts.has("Fer/Rec"), "feriado não é matéria e não entra na contagem");
});
