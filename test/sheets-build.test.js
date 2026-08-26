import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSchedule } from "../src/sheets.js";

const read = (name) => readFileSync(new URL(`./fixtures/${name}.csv`, import.meta.url), "utf8");

const schedule = buildSchedule({
	plannerCsv: read("planner-hf4"),
	gradeCsv: read("grade-4fase"),
	subjectsCsv: read("disciplinas"),
	phase: "4",
	holidayCode: "Fer/Rec",
	periodMinutes: 50,
	frequencyLimit: 0.25,
});

test("indexa os dias por data", () => {
	assert.equal(schedule.dates.length, 120);
	assert.equal(schedule.dates[0], "2026-08-03");
	assert.equal(schedule.days["2026-08-03"].weekday, 2);
});

test("acrescenta sala e professor às aulas", () => {
	const block = schedule.days["2026-08-03"].blocks[0];
	assert.equal(block.subject, "ExtPes");
	assert.equal(block.room, "D04");
	assert.equal(block.teacher, "Leila L Rossi");
});

test("não usa a sala da grade quando a matéria do dia é outra", () => {
	// em novembro a terça virou BD2, mas a grade ainda descreve Física naquele horário
	const block = schedule.days["2026-11-03"].blocks.find((b) => b.subject === "BD2" && b.start === "10:20");
	assert.ok(block, "BD2 deveria aparecer na terça de novembro");
	assert.equal(block.room, null);
	assert.equal(block.teacher, "Leila L Rossi"); // veio da aba mestra
});

test("calcula o limite de faltas de cada matéria", () => {
	assert.equal(schedule.subjects.Fisica.hours, 36);
	assert.equal(schedule.subjects.Fisica.limit, 9);
	assert.equal(schedule.subjects.MetNum.limit, 18);
});

test("inclui matéria que aparece no planejamento mas não na aba mestra", () => {
	// COORD é o Fórum COMPUTATALK: está na legenda e no calendário, não na tabela do SIGAA
	assert.ok(schedule.subjects.COORD, "COORD deveria existir");
	assert.equal(schedule.subjects.COORD.hours, 17); // cai para a contagem do planejamento
});

test("é serializável em JSON sem perder nada", () => {
	const round = JSON.parse(JSON.stringify(schedule));
	assert.deepEqual(round, schedule);
});
