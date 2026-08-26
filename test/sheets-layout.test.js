import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv } from "../src/csv.js";
import { findPlannerLayout, parseYear } from "../src/sheets.js";

const rows = parseCsv(readFileSync(new URL("./fixtures/planner-hf4.csv", import.meta.url), "utf8"));

test("encontra os seis dias da semana", () => {
	const layout = findPlannerLayout(rows);
	assert.equal(layout.days.length, 6);
	assert.deepEqual(
		layout.days.map((d) => d.weekday),
		[2, 3, 4, 5, 6, 7],
	);
	assert.match(layout.days[0].label, /SEGUNDA/i);
	assert.match(layout.days[5].label, /SÁBADO/i);
});

test("encontra os horários de cada dia", () => {
	const layout = findPlannerLayout(rows);
	assert.deepEqual(
		layout.days[0].slots.map((s) => s.time),
		["07:30", "08:20", "09:10", "10:20", "11:10", "13:30", "14:20", "15:30", "16:20"],
	);
	// sábado tem menos períodos que os outros dias
	assert.equal(layout.days[5].slots.length, 5);
});

test("as colunas de cada dia são distintas e crescentes", () => {
	const layout = findPlannerLayout(rows);
	const dateCols = layout.days.map((d) => d.dateCol);
	assert.deepEqual(
		dateCols,
		[...dateCols].sort((a, b) => a - b),
	);
	assert.equal(new Set(dateCols).size, 6);
	for (const day of layout.days) {
		assert.ok(day.slots[0].col > day.dateCol, "os horários vêm depois da coluna de data");
	}
});

test("lê o ano do cabeçalho", () => {
	const layout = findPlannerLayout(rows);
	assert.equal(parseYear(rows, layout.headerRow), 2026);
});

test("recusa uma planilha sem a linha dos dias", () => {
	assert.throws(
		() =>
			findPlannerLayout([
				["a", "b"],
				["c", "d"],
			]),
		/dias da semana/,
	);
});
