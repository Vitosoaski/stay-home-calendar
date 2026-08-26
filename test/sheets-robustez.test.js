import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	weekdayFromLabel,
	padTime,
	findPlannerLayout,
	parsePlanner,
	parseGrade,
	parseSubjects,
} from "../src/sheets.js";
import { parseCsv } from "../src/csv.js";

const read = (name) => readFileSync(new URL(`./fixtures/${name}.csv`, import.meta.url), "utf8");

// Planejamento mínimo e sintético: três dias, dois períodos cada, virando o ano.
// Serve para exercitar caminhos que a fixture real não cobre.
const miniPlanner = (rows) =>
	[
		"2º Semestre de 2026,,,,",
		",,LEGENDA,BD2,BANCO DE DADOS II,Fer/Rec,FERIADO / RECESSO",
		",,SEGUNDA-FEIRA,,,,TERÇA-FEIRA,,,,QUARTA-FEIRA",
		",,,Data/Hr,07:30,08:20,,Data/Hr,07:30,08:20,,Data/Hr,07:30,08:20",
		",,,Data,Disciplinas,,,Data,Disciplinas,,,Data,Disciplinas",
		...rows,
	].join("\n");

const DEZEMBRO = ",,2,28/12,BD2,BD2,3,29/12,BD2,BD2,4,30/12,BD2,BD2";

// --- 1. dia da semana vem do rótulo, não da posição ---------------------------

test("o número do dia é derivado do rótulo", () => {
	assert.equal(weekdayFromLabel("SEGUNDA-FEIRA"), 2);
	assert.equal(weekdayFromLabel("terça-feira"), 3);
	assert.equal(weekdayFromLabel("SÁBADO"), 7);
	assert.equal(weekdayFromLabel("QUALQUER COISA"), null);
});

test("a fixture real numera os dias de 2 a 7 pelos rótulos", () => {
	const layout = findPlannerLayout(parseCsv(read("planner-hf4")));
	assert.deepEqual(
		layout.days.map((d) => d.weekday),
		[2, 3, 4, 5, 6, 7],
	);
});

test("rótulo trocado não renumera a semana: o marcador denuncia", () => {
	const trocado = read("planner-hf4").replace("QUARTA-FEIRA", "SÁBADO");
	assert.throws(() => parsePlanner(trocado), /marcador/);
});

// --- 2. coluna em branco não encurta o dia ------------------------------------

test("coluna em branco na linha de horários não trunca o dia", () => {
	const original = findPlannerLayout(parseCsv(read("planner-hf4")));
	const furado = read("planner-hf4").replace("Data/Hr,07:30,08:20,09:10", "Data/Hr,07:30,,08:20,09:10");
	const layout = findPlannerLayout(parseCsv(furado));
	assert.equal(layout.days[0].slots.length, original.days[0].slots.length);
	assert.equal(layout.days[0].slots.length, 9);
});

test("célula inesperada na linha de horários vira erro, não corte", () => {
	const sujo = read("planner-hf4").replace("Data/Hr,07:30,08:20,09:10", "Data/Hr,07:30,LIXO,09:10");
	assert.throws(() => findPlannerLayout(parseCsv(sujo)), /célula inesperada/);
});

// --- 3. início dos dados localizado, não deslocado por offset fixo ------------

test("a primeira semana entra mesmo sem a linha Data,Disciplinas", () => {
	const original = parsePlanner(read("planner-hf4"));
	const semRotulo = read("planner-hf4")
		.split("\n")
		.filter((line) => !/^,+,Data,Disciplinas,/.test(line))
		.join("\n");
	const enxuto = parsePlanner(semRotulo);
	assert.equal(original.days[0].date, "2026-08-03");
	assert.equal(enxuto.days[0].date, original.days[0].date);
	assert.equal(enxuto.days.length, original.days.length);
});

// --- 4. virada de ano só de dezembro para janeiro -----------------------------

test("dezembro para janeiro vira o ano", () => {
	const planner = parsePlanner(miniPlanner([DEZEMBRO, ",,2,04/01,BD2,BD2,3,05/01,BD2,BD2,4,06/01,BD2,BD2"]));
	const dates = planner.days.map((d) => d.date);
	assert.ok(dates.includes("2026-12-28"));
	assert.ok(dates.includes("2027-01-04"));
});

test("qualquer outro mês para trás é erro, não virada de ano", () => {
	assert.throws(
		() => parsePlanner(miniPlanner([DEZEMBRO, ",,2,04/05,BD2,BD2,3,05/05,BD2,BD2,4,06/05,BD2,BD2"])),
		/fora de ordem/,
	);
});

// --- 5. recesso de meio período não vira aula fantasma ------------------------

test("recesso de meio período some dos blocos e da contagem", () => {
	const planner = parsePlanner(miniPlanner([",,2,28/12,Fer/Rec,BD2,3,29/12,BD2,BD2,4,30/12,Fer/Rec,Fer/Rec"]));
	const meio = planner.days.find((d) => d.weekday === 2);
	const inteiro = planner.days.find((d) => d.weekday === 4);

	assert.equal(meio.holiday, true);
	assert.deepEqual(
		meio.blocks.map((b) => b.subject),
		["BD2"],
	);
	assert.equal(inteiro.holiday, true);
	assert.deepEqual(inteiro.blocks, []);
	assert.ok(!planner.periodCounts.has("Fer/Rec"));
});

// --- 6. cabeçalho com espaço extra continua sendo encontrado ------------------

test("'CH  50 MIN' com espaço duplo ainda é reconhecido", () => {
	const largo = read("disciplinas").replaceAll("CH 50 MIN", "CH  50 MIN");
	assert.equal(parseSubjects(largo, "4").get("MetNum").hours, 72);
});

test("tabela oficial sem nenhuma linha da fase vira erro", () => {
	assert.throws(() => parseSubjects(read("disciplinas"), "99"), /nenhuma disciplina/);
});

// --- 7. grade ancorada em cabeçalho, com horário normalizado ------------------

test("coluna extra na grade não zera as salas", () => {
	const deslocada = read("grade-4fase")
		.split("\n")
		.map((l) => `X,${l}`)
		.join("\n");
	const grade = parseGrade(deslocada);
	assert.equal(grade.get("2|07:30").room, "D04");
	assert.equal(grade.get("2|07:30").subject, "ExtPes");
});

test("horário sem zero à esquerda casa com a mesma chave", () => {
	assert.equal(padTime("7:30"), "07:30");
	const solto = read("grade-4fase").replace(",07:30,ExtPes,", ",7:30,ExtPes,");
	assert.equal(parseGrade(solto).get("2|07:30").room, "D04");
});

test("grade sem nenhuma aula vira erro, não mapa vazio", () => {
	const vazia = read("grade-4fase").split("\n").slice(0, 1).join("\n");
	assert.throws(() => parseGrade(vazia), /nenhuma aula/);
});
