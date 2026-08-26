import { el } from './api.js';

const DIAS = { 2: 'Segunda', 3: 'Terça', 4: 'Quarta', 5: 'Quinta', 6: 'Sexta', 7: 'Sábado' };

const formatDate = (iso) => {
  const [, month, day] = iso.split('-');
  return `${day}/${month}`;
};

export function avatar(user, { size = 22 } = {}) {
  const initials = user.name.trim().slice(0, 2).toUpperCase();
  const node = user.hasPhoto
    ? el('img', {
        class: 'avatar', src: `/api/photo/${user.id}?v=${user.photoVersion}`,
        alt: user.name, title: user.name, width: size, height: size
      })
    : el('span', { class: 'avatar iniciais', title: user.name }, initials);
  node.style.setProperty('--cor', user.color);
  node.style.width = node.style.height = `${size}px`;
  return node;
}

export function renderHeader(state, { me, onWeek, onLogout }) {
  const monday = state.week.monday;
  const atStart = monday <= state.week.first;
  const atEnd = monday >= state.week.last;

  return el('header', { class: 'topo' },
    el('div', { class: 'titulo' },
      el('strong', {}, 'Calendário de Faltas'),
      el('span', { class: 'periodo' },
        `${formatDate(state.days[0].date)} – ${formatDate(state.days.at(-1).date)}`)),

    el('nav', { class: 'navegacao' },
      el('button', { class: 'seta', disabled: atStart, 'aria-label': 'Semana anterior',
                     onclick: () => onWeek(-1) }, '‹'),
      el('button', { class: 'hoje', onclick: () => onWeek(0) }, 'Hoje'),
      el('button', { class: 'seta', disabled: atEnd, 'aria-label': 'Próxima semana',
                     onclick: () => onWeek(1) }, '›')),

    el('div', { class: 'perfil' },
      avatar(me, { size: 28 }),
      el('button', { class: 'link', onclick: onLogout }, 'Sair')),

    state.stale && el('p', { class: 'aviso' },
      state.updatedAt
        ? `Horário pode estar desatualizado — última sincronização ${timeAgo(state.updatedAt)}.`
        : 'Ainda não consegui ler a planilha.')
  );
}

function timeAgo(iso) {
  const minutes = Math.round((Date.now() - new Date(iso)) / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} dias`;
}

export function renderGrid(state, { me, users, onToggle, onReason }) {
  const byId = new Map(users.map((u) => [u.id, u]));
  const today = state.today.date;

  return el('section', { class: 'grade' },
    state.days.map((day) => el('div', {
      class: `coluna${day.date === today ? ' hoje' : ''}${day.holiday ? ' feriado' : ''}`
    },
      el('div', { class: 'cabecalho-dia' },
        el('span', { class: 'nome-dia' }, DIAS[day.weekday] ?? ''),
        el('span', { class: 'data-dia' }, formatDate(day.date))),

      day.holiday
        ? el('div', { class: 'vazio' }, 'Feriado')
        : day.blocks.length === 0
          ? el('div', { class: 'vazio' }, 'Sem aula')
          : day.blocks.map((block) => card(block, { me, byId, onToggle, onReason }))
    ))
  );
}

function card(block, { me, byId, onToggle, onReason }) {
  const marks = block.absences ?? [];
  const mine = marks.find((mark) => mark.userId === me.id);
  const heat = Math.min(marks.length, 4);

  return el('article', {
    class: `aula${mine ? ' marcada' : ''}`,
    dataset: { heat: String(heat) },
    tabindex: '0',
    role: 'button',
    'aria-pressed': mine ? 'true' : 'false',
    'aria-label': `${block.name}, ${block.start} às ${block.end}. ${
      mine ? 'Você marcou falta.' : 'Marcar falta.'}`,
    onclick: () => onToggle(block, !mine),
    onkeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onToggle(block, !mine);
      }
    }
  },
    el('div', { class: 'sigla' }, block.subject),
    el('div', { class: 'nome-materia' }, block.name),
    el('div', { class: 'horario' }, `${block.start} – ${block.end}`,
      block.room && el('span', { class: 'sala' }, block.room)),

    marks.length > 0 && el('div', { class: 'faltantes' },
      marks.map((mark) => {
        const user = byId.get(mark.userId);
        if (!user) return null;
        const face = avatar(user);
        if (mark.reason) face.title = `${user.name} — ${mark.reason}`;
        return face;
      })),

    mine && el('button', {
      class: 'motivo',
      onclick: (event) => { event.stopPropagation(); onReason(block, mine.reason ?? ''); }
    }, mine.reason ? `“${mine.reason}”` : '+ motivo')
  );
}
