// Parser de CSV conforme RFC 4180: aspas protegem vírgulas e quebras de linha,
// e uma aspa literal dentro de um campo entre aspas é escrita como "".
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') { quoted = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') { field += c; }
  }

  row.push(field);
  rows.push(row);

  // Uma última linha vazia é artefato do \n final, não um dado.
  if (rows.length && rows.at(-1).length === 1 && rows.at(-1)[0] === '') rows.pop();

  return rows;
}
