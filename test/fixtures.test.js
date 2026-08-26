import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const files = ['planner-hf4', 'grade-4fase', 'disciplinas'];

test('as fixtures existem e são CSV, não HTML de login', () => {
  for (const name of files) {
    const text = readFileSync(new URL(`./fixtures/${name}.csv`, import.meta.url), 'utf8');
    assert.ok(text.length > 500, `${name} está pequeno demais: ${text.length} bytes`);
    assert.ok(!text.trimStart().startsWith('<'),
      `${name} veio como HTML — a planilha pode ter deixado de ser pública`);
    assert.ok(text.includes(','), `${name} não parece CSV`);
  }
});
