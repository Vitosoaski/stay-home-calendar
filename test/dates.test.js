import { test } from "node:test";
import assert from "node:assert/strict";
import { isoDate, addMinutes, mondayOf, weekDates, isTime, isDayMonth } from "../src/dates.js";

test("isoDate monta a data com zero à esquerda", () => {
	assert.equal(isoDate(3, 8, 2026), "2026-08-03");
	assert.equal(isoDate(19, 12, 2026), "2026-12-19");
});

test("addMinutes soma dentro da hora", () => {
	assert.equal(addMinutes("07:30", 50), "08:20");
});

test("addMinutes vira a hora", () => {
	assert.equal(addMinutes("09:10", 50), "10:00");
	assert.equal(addMinutes("16:20", 50), "17:10");
});

test("mondayOf devolve a segunda da semana", () => {
	assert.equal(mondayOf("2026-08-26"), "2026-08-24"); // quarta -> segunda
	assert.equal(mondayOf("2026-08-24"), "2026-08-24"); // segunda -> ela mesma
	assert.equal(mondayOf("2026-08-30"), "2026-08-24"); // domingo -> segunda anterior
});

test("weekDates devolve segunda a sábado", () => {
	assert.deepEqual(weekDates("2026-08-24"), [
		"2026-08-24",
		"2026-08-25",
		"2026-08-26",
		"2026-08-27",
		"2026-08-28",
		"2026-08-29",
	]);
});

test("isTime reconhece horário e recusa o resto", () => {
	assert.equal(isTime("07:30"), true);
	assert.equal(isTime("7:30"), true);
	assert.equal(isTime(" 13:30 "), true);
	assert.equal(isTime("Data/Hr"), false);
	assert.equal(isTime(""), false);
});

test("isDayMonth reconhece dd/MM e recusa data completa", () => {
	assert.equal(isDayMonth("03/08"), true);
	assert.equal(isDayMonth("3/8"), true);
	assert.equal(isDayMonth("01/01/2026"), false);
	assert.equal(isDayMonth("Data"), false);
});
