import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGrade, parseSubjects } from '../src/sheets.js';

const read = (name) =>
  readFileSync(new URL(`./fixtures/${name}.csv`, import.meta.url), 'utf8');

test('grade dá sala e professor por dia e horário', () => {
  const grade = parseGrade(read('grade-4fase'));
  assert.deepEqual(grade.get('2|07:30'),
    { subject: 'ExtPes', room: 'D04', teacher: 'Leila L Rossi' });
  assert.deepEqual(grade.get('2|10:20'),
    { subject: 'DWeb-I', room: 'D04', teacher: 'Fabricio Bizotto' });
});

test('grade ignora horários sem disciplina', () => {
  const grade = parseGrade(read('grade-4fase'));
  assert.equal(grade.size, 25);   // 5 dias x 5 períodos de manhã
  for (const meta of grade.values()) assert.ok(meta.subject.length > 0);
});

test('grade lança erro quando o cabeçalho não existe', () => {
  assert.throws(() => parseGrade('a,b\nc,d'), /cabeçalho/);
});

test('disciplinas trazem carga horária oficial em períodos de 50 min', () => {
  const subjects = parseSubjects(read('disciplinas'), '4');
  assert.equal(subjects.size, 7);
  assert.deepEqual(subjects.get('Fisica'), {
    name: 'FÍSICA', sigaa: 'CCC0725', teacher: 'Cíntia F Silva', hours: 36
  });
  assert.equal(subjects.get('MetNum').hours, 72);
});

test('disciplinas filtram pela fase pedida', () => {
  const fourth = parseSubjects(read('disciplinas'), '4');
  const second = parseSubjects(read('disciplinas'), '2');
  assert.ok(fourth.has('BD2'));
  assert.ok(!second.has('BD2'));
  assert.ok(second.size > 0);
});
