const controlKey = (control, occurrences) => {
  const formId = control.form?.id || control.closest?.('form')?.id;
  const base = formId && control.name
    ? `form:${formId}:${control.name}:${control.type || control.tagName}`
    : control.id ? `id:${control.id}` : null;
  if (!base) return null;
  const index = occurrences.get(base) || 0;
  occurrences.set(base, index + 1);
  return `${base}:${index}`;
};

const readValue = control => control.type === 'checkbox' || control.type === 'radio'
  ? control.checked
  : control.value;

const selection = control => typeof control.selectionStart === 'number'
  ? { selectionStart: control.selectionStart, selectionEnd: control.selectionEnd, selectionDirection: control.selectionDirection }
  : {};

function controlsWithKeys(controls) {
  const occurrences = new Map();
  return Array.from(controls, control => ({ control, key: controlKey(control, occurrences) }));
}

export function captureInputState(controls, activeElement) {
  const values = Object.create(null);
  let focusKey = null;
  for (const { control, key } of controlsWithKeys(controls)) {
    if (control.type === 'file' || control.type === 'button' || !key || !('value' in control)) continue;
    values[key] = { value: readValue(control), ...selection(control) };
    if (control === activeElement) focusKey = key;
  }
  return { values, focusKey };
}

export function restoreInputState(root, state) {
  const controls = controlsWithKeys(root.querySelectorAll('input,select,textarea'));
  let focused = null;
  for (const { control, key } of controls) {
    if (!key || control.type === 'file' || control.type === 'button') continue;
    const saved = state.values[key];
    if (!saved) continue;
    if (control.type === 'checkbox' || control.type === 'radio') control.checked = saved.value;
    else if (control.tagName !== 'SELECT' || Array.from(control.options || []).some(option => option.value === saved.value)) control.value = saved.value;
    if (saved.selectionStart !== undefined && typeof control.setSelectionRange === 'function') {
      try { control.setSelectionRange(saved.selectionStart, saved.selectionEnd, saved.selectionDirection); } catch {}
    }
    if (key === state.focusKey) focused = control;
  }
  focused?.focus({ preventScroll: true });
}

export function captureReplyDrafts(forms, activeElement) {
  const drafts = new Map();
  for (const form of forms) {
    const field = form.querySelector('[name="text"]');
    if (!field || !form.dataset.reply) continue;
    drafts.set(form.dataset.reply, {
      value: field.value,
      focused: field === activeElement,
      ...selection(field),
    });
  }
  return drafts;
}

export function restoreReplyDrafts(forms, drafts) {
  let focused = null;
  for (const form of forms) {
    const saved = drafts.get(form.dataset.reply);
    const field = form.querySelector('[name="text"]');
    if (!saved || !field) continue;
    field.value = saved.value;
    if (saved.selectionStart !== undefined && typeof field.setSelectionRange === 'function') {
      try { field.setSelectionRange(saved.selectionStart, saved.selectionEnd, saved.selectionDirection); } catch {}
    }
    if (saved.focused) focused = field;
  }
  focused?.focus({ preventScroll: true });
}
