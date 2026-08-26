import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/csv.js';
import { findPlannerLayout, parseLegend } from '../src/sheets.js';

const rows = parseCsv(readFileSync(
  new URL('./fixtures/planner-hf4.csv', import.meta.url), 'utf8'));
const { headerRow } = findPlannerLayout(rows);

test('mapeia sigla para nome completo', () => {
  const legend = parseLegend(rows, headerRow);
  assert.equal(legend.get('BD2'), 'BANCO DE DADOS II');
  assert.equal(legend.get('SO'), 'SISTEMAS OPERACIONAIS');
  assert.equal(legend.get('DWeb-I'), 'DESENVOLVIMENTO WEB I');
});

test('lê nome que contém vírgula', () => {
  const legend = parseLegend(rows, headerRow);
  assert.equal(legend.get('CiTecSO'), 'CIÊNCIA, TECNOLOGIA E SOCIEDADE');
});

test('lê par cuja sigla e nome têm o mesmo tamanho', () => {
  // 'Fisica' e 'FÍSICA' têm 6 caracteres — um filtro por comprimento perderia este
  const legend = parseLegend(rows, headerRow);
  assert.equal(legend.get('Fisica'), 'FÍSICA');
});

test('inclui o marcador de feriado', () => {
  const legend = parseLegend(rows, headerRow);
  assert.equal(legend.get('Fer/Rec'), 'FERIADO / RECESSO');
});

test('ignora o título do curso, que fica à esquerda da legenda', () => {
  const legend = parseLegend(rows, headerRow);
  for (const name of legend.values()) {
    assert.ok(!name.includes('Campus Videira'),
      'o título do curso não é uma disciplina');
  }
});

test('devolve mapa vazio quando não há legenda', () => {
  assert.equal(parseLegend([['a'], ['b']], 2).size, 0);
});
