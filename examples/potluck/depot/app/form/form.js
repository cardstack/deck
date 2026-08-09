import { field as handleField } from 'fields/handle';
import { field as dueDate } from 'fields/due-date';
import { field as meetingSlot } from 'fields/meeting-slot';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from 'prosemirror-schema-basic';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';

const form = document.getElementById('form');
const status = document.getElementById('status');
const previewCard = document.getElementById('preview-card');
const previewTitle = document.getElementById('preview-title');
const dateHint = document.getElementById('date-hint');
const slotHint = document.getElementById('slot-hint');
const scrubbing = /\/_history\//.test(location.pathname);

const view = new EditorView(document.getElementById('editor'), {
  state: EditorState.create({
    schema,
    doc: schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('Contains peanuts · keep warm')]),
    ]),
    plugins: [history(), keymap({
      'Mod-z': undo, 'Shift-Mod-z': redo,
      'Mod-b': toggleMark(schema.marks.strong),
      'Mod-i': toggleMark(schema.marks.em),
    }), keymap(baseKeymap)],
  }),
  editable: () => !scrubbing,
});

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function showError(name, message) {
  const err = document.getElementById('err-' + name);
  const input = form.elements[name];
  if (!err) return;
  err.hidden = !message; err.textContent = message || '';
  input?.classList.toggle('invalid', Boolean(message));
}
function slotValue() {
  if (!form.due.value || !form.start.value) return null;
  return { start: form.due.value + 'T' + form.start.value + ':00', zone: form.zone.value, minutes: Number(form.minutes.value) };
}
function refreshHints() {
  if (form.due.value && dueDate.schema.safeParse({ due: form.due.value }).success) {
    const value = { due: form.due.value };
    dateHint.textContent = dueDate.format(value);
    dateHint.className = 'hint ' + dueDate.tone(value);
  }
  const slot = slotValue();
  if (slot && meetingSlot.schema.safeParse(slot).success) slotHint.textContent = meetingSlot.format(slot);
}
form.due.addEventListener('change', refreshHints);
for (const name of ['start', 'minutes', 'zone']) form.elements[name].addEventListener('change', refreshHints);

function collect() {
  const data = Object.fromEntries(new FormData(form));
  let ok = true;
  const handle = handleField.schema.safeParse(handleField.mint({ prefix: data.prefix || '' }));
  if (!data.prefix?.trim()) { showError('prefix', 'Handles start with a letter — try “mai”.'); ok = false; }
  else if (!handle.success) { showError('prefix', 'Use lowercase letters, numbers, or hyphens (2–12 chars).'); ok = false; }
  else showError('prefix');
  if (!data.due) { showError('due', 'Which Thursday is this for?'); ok = false; }
  else if (!dueDate.schema.safeParse({ due: data.due }).success) { showError('due', 'That date isn’t valid.'); ok = false; }
  else showError('due');
  const slot = slotValue();
  const slotOk = slot && meetingSlot.schema.safeParse(slot).success;
  document.getElementById('err-slot').hidden = Boolean(slotOk);
  if (!slotOk) { document.getElementById('err-slot').textContent = 'Set a start time and duration (15–180 minutes).'; ok = false; }
  if (!data.dish?.trim()) { showError('dish', 'Name the dish so nobody doubles up.'); ok = false; }
  else showError('dish');
  if (!ok) return null;
  return {
    handle: handleField.mint({ prefix: data.prefix }),
    due: { due: data.due },
    slot,
    dish: data.dish.trim(),
    notes: view.state.doc.textContent.trim(),
  };
}

function renderPreview(payload, confirmed) {
  previewTitle.textContent = confirmed ? 'On the board' : 'Preview';
  previewCard.classList.remove('empty');
  previewCard.classList.toggle('ok', confirmed);
  previewCard.innerHTML =
    '<h3>' + esc(payload.dish) + '</h3>' +
    '<p>' + esc(handleField.format(payload.handle)) + '</p>' +
    '<p>' + esc(dueDate.format(payload.due)) + '</p>' +
    '<p>' + esc(meetingSlot.format(payload.slot)) + '</p>' +
    (payload.notes ? '<p>' + esc(payload.notes) + '</p>' : '<p>No notes</p>') +
    '<span class="tag">' + (confirmed ? 'confirmed' : 'draft card') + '</span>';
}

document.querySelector('[data-role="preview"]').addEventListener('click', () => {
  status.hidden = true;
  document.body.classList.remove('done');
  const payload = collect();
  if (payload) renderPreview(payload, false);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const payload = collect();
  if (!payload) return;
  renderPreview(payload, true);
  document.body.classList.add('done');
  status.hidden = false;
  status.textContent = 'You’re confirmed — ' + handleField.format(payload.handle) + ' is on the kitchen board.';
});
