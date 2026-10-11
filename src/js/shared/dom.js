let nextId = 0;

export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      if (value !== undefined && value !== null) node.setAttribute(name, String(value));
    }
  }
  for (const child of children) {
    if (child) node.append(child);
  }
  return node;
}

export function field(labelText, control, options = {}) {
  const id = options.id || 'field-' + (++nextId);
  control.id = id;
  const label = el('label', { className: 'field-label', text: labelText, attrs: { for: id } });
  const wrapper = el('div', { className: options.className || 'field' }, [label, control]);
  if (options.hint) wrapper.append(el('small', { className: 'field-hint', text: options.hint }));
  return wrapper;
}

export function textInput(options = {}) {
  const input = el('input', { attrs: { type: options.type || 'text' } });
  if (options.name) input.name = options.name;
  if (options.value !== undefined) input.value = options.value;
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.autocomplete) input.autocomplete = options.autocomplete;
  if (options.required) input.required = true;
  if (options.minLength) input.minLength = options.minLength;
  if (options.maxLength) input.maxLength = options.maxLength;
  if (options.list) input.setAttribute('list', options.list);
  if (options.inputMode) input.inputMode = options.inputMode;
  return input;
}

export function statusMessage(message, kind = 'error') {
  if (!message) return null;
  return el('p', {
    className: 'status-message status-' + kind,
    text: message,
    attrs: { role: kind === 'error' ? 'alert' : 'status' }
  });
}

export function makeButton(label, options = {}) {
  const button = el('button', {
    className: options.className || 'button button-primary',
    text: label,
    attrs: { type: options.type || 'button' }
  });
  if (options.disabled) button.disabled = true;
  return button;
}

export function pageCard(title, description) {
  const card = el('section', { className: 'card' });
  const header = el('div', { className: 'card-header' }, [
    el('p', { className: 'eyebrow', text: 'WORKPATH' }),
    el('h1', { text: title })
  ]);
  if (description) header.append(el('p', { className: 'card-description', text: description }));
  card.append(header);
  return card;
}
