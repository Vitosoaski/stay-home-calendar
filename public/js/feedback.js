import { el } from './api.js';

let toastTimer = null;

export function toast(message, { action } = {}) {
  document.querySelector('.aviso-flutuante')?.remove();
  clearTimeout(toastTimer);

  const node = el('div', { class: 'aviso-flutuante', role: 'status' },
    el('span', {}, message),
    action && el('button', {
      class: 'link',
      onclick: () => { node.remove(); action.onClick(); }
    }, action.label)
  );

  document.body.append(node);
  toastTimer = setTimeout(() => node.remove(), 5000);
}

// Diálogo nativo: acessível, fecha com Esc e escurece o fundo sem nenhum CSS
// de overlay da nossa parte.
export function askReason({ title, current = '' }) {
  return new Promise((resolve) => {
    const input = el('input', {
      type: 'text', maxlength: '120', value: current,
      placeholder: 'consulta, prova de outra matéria...'
    });

    const dialog = el('dialog', { class: 'dialogo' },
      el('form', {
        method: 'dialog',
        onsubmit: (event) => { event.preventDefault(); dialog.close(input.value.trim()); }
      },
        el('h2', {}, title),
        el('label', {}, 'Motivo (opcional)', input),
        el('menu', {},
          el('button', { type: 'button', class: 'link', onclick: () => dialog.close(' ') },
            'Cancelar'),
          el('button', { type: 'submit', class: 'primario' }, 'Salvar'))
      )
    );

    dialog.addEventListener('close', () => {
      const value = dialog.returnValue;
      dialog.remove();
      resolve(value === ' ' ? null : value);
    });

    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  });
}
