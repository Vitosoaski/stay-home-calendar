import { el } from './api.js';
import { avatar } from './grid.js';

const DIA_CURTO = { 2: 'seg', 3: 'ter', 4: 'qua', 5: 'qui', 6: 'sex', 7: 'sáb' };

export function renderPanels(state, { users }) {
  const byId = new Map(users.map((user) => [user.id, user]));
  return el('aside', { class: 'paineis' },
    todayPanel(state, byId),
    rankingPanel(state, byId),
    frequencyPanel(state)
  );
}

function panel(title, body, empty) {
  return el('section', { class: 'painel' },
    el('h2', {}, title),
    body.length ? body : el('p', { class: 'vazio-painel' }, empty));
}

function faces(marks, byId) {
  return el('span', { class: 'faces' },
    marks.map((mark) => {
      const user = byId.get(mark.userId);
      return user ? avatar(user, { size: 20 }) : null;
    }));
}

function todayPanel(state, byId) {
  const rows = state.today.blocks
    .filter((block) => (block.absences ?? []).length > 0)
    .map((block) => el('div', { class: 'linha' },
      el('span', { class: 'sigla-pequena' }, block.subject),
      el('span', { class: 'hora-pequena' }, block.start),
      faces(block.absences, byId)));

  return panel('Hoje', rows, state.today.blocks.length
    ? 'Ninguém marcou falta hoje.'
    : 'Hoje não tem aula.');
}

function rankingPanel(state, byId) {
  const rows = state.days
    .flatMap((day) => day.blocks.map((block) => ({ day, block })))
    .filter(({ block }) => (block.absences ?? []).length > 0)
    .sort((a, b) => b.block.absences.length - a.block.absences.length)
    .slice(0, 5)
    .map(({ day, block }) => el('div', { class: 'linha' },
      el('span', { class: 'sigla-pequena' }, block.subject),
      el('span', { class: 'hora-pequena' },
        `${DIA_CURTO[day.weekday] ?? ''} ${block.start}`),
      faces(block.absences, byId)));

  return panel('Mais gente faltando', rows, 'Semana cheia — ninguém marcou nada.');
}

function frequencyPanel(state) {
  if (!state.frequency) return el('section', { class: 'painel' });

  const rows = state.frequency
    .filter((item) => item.limit > 0)
    .map((item) => {
      const used = Math.min(item.missed / item.limit, 1);
      const level = item.remaining <= 0 ? 'estourado'
        : item.remaining <= 2 ? 'atencao' : 'ok';

      return el('div', { class: `frequencia ${level}` },
        el('div', { class: 'linha' },
          el('span', { class: 'sigla-pequena', title: item.name }, item.subject),
          el('span', { class: 'restante' }, item.remaining > 0
            ? `pode faltar mais ${item.remaining}`
            : 'limite estourado')),
        el('div', { class: 'barra' },
          el('div', { class: 'preenchido', style: { width: `${Math.round(used * 100)}%` } })),
        el('span', { class: 'detalhe' }, `${item.missed} de ${item.hours} períodos`));
    });

  return panel('Minha frequência', rows, 'Nenhuma falta marcada ainda.');
}
