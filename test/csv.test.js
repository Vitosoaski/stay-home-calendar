import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.js';

test('separa campos simples', () => {
  assert.deepEqual(parseCsv('a,b,c'), [['a', 'b', 'c']]);
});

test('preserva vírgula dentro de aspas', () => {
  assert.deepEqual(parseCsv('a,"CIÊNCIA, TECNOLOGIA",c'),
    [['a', 'CIÊNCIA, TECNOLOGIA', 'c']]);
});

test('trata aspas duplicadas como uma aspa literal', () => {
  assert.deepEqual(parseCsv('a,"diz ""oi""",c'), [['a', 'diz "oi"', 'c']]);
});

test('preserva quebra de linha dentro de aspas', () => {
  assert.deepEqual(parseCsv('a,"linha1\nlinha2"'), [['a', 'linha1\nlinha2']]);
});

test('aceita CRLF e ignora a última linha vazia', () => {
  assert.deepEqual(parseCsv('a,b\r\nc,d\r\n'), [['a', 'b'], ['c', 'd']]);
});

test('preserva células vazias, inclusive no fim', () => {
  assert.deepEqual(parseCsv('a,,c,'), [['a', '', 'c', '']]);
});

test('preserva linha inteiramente vazia no meio', () => {
  assert.deepEqual(parseCsv('a\n\nb'), [['a'], [''], ['b']]);
});
