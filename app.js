/* =============================================================================
   Studyframe — app.js
   Notes, timetable, tasks, files and certificates. Everything stays in this
   browser: state in localStorage, uploaded files in IndexedDB. No build step,
   no server, no dependencies. Works from file:// and from GitHub Pages.

   Sections
     1  helpers            6  view: timetable      11 file store
     2  state + migration  7  view: tasks          12 reminders
     3  markup safety      8  view: files          13 sheets + search
     4  view: home         9  view: certificates   14 actions + events
     5  view: notes       10  view: settings       15 boot
   ============================================================================= */

/* =============================================================================
   1 — helpers
   ============================================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ENT[c]);

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const icon = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

/* dates -------------------------------------------------------------------- */
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7));
const todayISO = () => iso(new Date());
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const isoWeek = d => {                                        // ISO-8601 week number
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7));
  const jan4 = new Date(x.getFullYear(), 0, 4);
  return 1 + Math.round(((x - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
};
const wdOf = d => (d.getDay() + 6) % 7;                       // 0 = Monday
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const toMin = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const fromMin = m => `${pad(Math.floor(clamp(m, 0, 1439) / 60))}:${pad(Math.round(clamp(m, 0, 1439)) % 60)}`;
const at = (dateStr, time) => {
  const d = parseISO(dateStr);
  const [h, m] = String(time || '00:00').split(':').map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
};
const fmtDate = (d, o) => d.toLocaleDateString(undefined, o);

function urgency(dateStr) {
  const n = daysBetween(todayISO(), dateStr);
  if (n < 0) return 'late';
  if (n === 0) return 'today';
  if (n <= 3) return 'soon';
  return 'later';
}
function whenLabel(t) {
  const n = daysBetween(todayISO(), t.date);
  const time = t.time ? ` · ${t.time}` : '';
  if (n < 0) return `${Math.abs(n)}d late${time}`;
  if (n === 0) return `Today${time}`;
  if (n === 1) return `Tomorrow${time}`;
  if (n <= 6) return `${DAY[wdOf(parseISO(t.date))]}${time}`;
  return `${fmtDate(parseISO(t.date), { month: 'short', day: 'numeric' })}${time}`;
}
/** "in 2h 14m" · "in 9m" · "now" · "18m ago" */
function relTime(ms) {
  const diff = ms - Date.now();
  const a = Math.abs(diff), mins = Math.round(a / 60000);
  if (a < 45000) return 'now';
  const body = mins < 60 ? `${mins}m`
    : mins < 1440 ? `${Math.floor(mins / 60)}h ${mins % 60}m`
      : `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
  return diff > 0 ? `in ${body}` : `${body} ago`;
}
function shortRel(ms) {
  const diff = ms - Date.now();
  const mins = Math.round(Math.abs(diff) / 60000);
  if (Math.abs(diff) < 45000) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h${pad(mins % 60)}`;
  return `${Math.floor(mins / 1440)}d`;
}

/* priority ----------------------------------------------------------------- */
const PRIO = [
  { v: 0, key: 'low', label: 'Low', css: 'var(--p0)' },
  { v: 1, key: 'normal', label: 'Normal', css: 'var(--p1)' },
  { v: 2, key: 'high', label: 'High', css: 'var(--p2)' },
  { v: 3, key: 'critical', label: 'Critical', css: 'var(--p3)' },
];
const prio = v => PRIO[clamp(Number(v ?? 1), 0, 3)];
/** How loudly a task is shouting: priority first, lateness second. */
function heat(t) {
  const n = daysBetween(todayISO(), t.date);
  const time = n === 0 && t.time ? toMin(t.time) / 1440 : 0;
  const near = n < 0 ? 100 + Math.min(30, -n) : n === 0 ? 90 - time * 10 : Math.max(0, 70 - n * 6);
  return prio(t.priority).v * 40 + near;
}

/* =============================================================================
   2 — file blobs (IndexedDB) + state
   ============================================================================= */
const dbp = new Promise((res, rej) => {
  try {
    const r = indexedDB.open('studyframe', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  } catch (e) { rej(e); }
});
const blobs = {
  async run(mode, fn) {
    const db = await dbp;
    return new Promise((res, rej) => {
      const tx = db.transaction('files', mode);
      const req = fn(tx.objectStore('files'));
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  },
  put: (id, blob) => blobs.run('readwrite', s => s.put(blob, id)),
  get: id => blobs.run('readonly', s => s.get(id)),
  del: id => blobs.run('readwrite', s => s.delete(id)),
};

const KEY = 'studyframe.v3';
const OLD_KEYS = ['studyframe.v2', 'studyframe.v1'];

function seed() {
  const a = uid(), b = uid(), c = uid();
  const t = new Date();
  return {
    v: 3,
    view: 'home', railOpen: false,
    activeSubject: a, noteId: null, fileId: null, folderId: null,
    ttMode: 'week', ttDate: todayISO(), ttDensity: 'fit',
    taskView: 'board', taskShowDone: false, fileView: 'grid',
    settings: { name: 'there', lead: 15, sound: true, allDay: '09:00', dayStart: 8, dayEnd: 21 },
    subjects: [
      { id: a, name: 'Cognitive Psychology', code: 'PSY 210', hue: 232 },
      { id: b, name: 'Linear Algebra', code: 'MATH 152', hue: 168 },
      { id: c, name: 'Media Law', code: 'LAW 118', hue: 38 },
    ],
    notes: [{
      id: uid(), subjectId: a, title: 'Week 3 — Working memory',
      html: '<p>This page behaves like a notebook. Select any text and use the bar above to set it in <strong>bold</strong>, <em>italic</em>, <u>underline</u> or <mark>highlight</mark>.</p><p></p><h2>What the toolbar gives you</h2><ul><li>Headings, bullet and numbered lists</li><li>Quotes, inline code and links</li><li>Undo, redo, and a button that strips formatting back to plain text</li></ul><p></p><blockquote>Attach a lecture PDF at the foot of the page and it opens from here.</blockquote>',
      files: [], updated: Date.now(), created: Date.now(),
    }],
    classes: [
      { id: uid(), subjectId: a, title: 'Lecture', weekday: 0, start: '09:00', end: '10:30', room: 'B-204', remind: null },
      { id: uid(), subjectId: b, title: 'Tutorial', weekday: 1, start: '13:00', end: '14:00', room: 'M-11', remind: null },
      { id: uid(), subjectId: a, title: 'Lab', weekday: 2, start: '11:00', end: '13:00', room: 'Psy Lab 2', remind: 30 },
      { id: uid(), subjectId: c, title: 'Seminar', weekday: 4, start: '10:00', end: '12:00', room: 'L-301', remind: null },
    ],
    events: [
      { id: uid(), subjectId: b, title: 'Study group', date: iso(addDays(t, 1)), start: '16:00', end: '18:00', room: 'Library 3F', remind: 30 },
    ],
    tasks: [
      { id: uid(), subjectId: a, title: 'Read Baddeley ch. 4', date: todayISO(), time: '', done: false, order: 0, remind: null, priority: 2, steps: [], created: Date.now() },
      { id: uid(), subjectId: b, title: 'Problem set 3', date: iso(addDays(t, 2)), time: '23:59', done: false, order: 1, remind: null, priority: 3, steps: [{ id: uid(), text: 'Questions 1–4', done: true }, { id: uid(), text: 'Questions 5–8', done: false }], created: Date.now() },
      { id: uid(), subjectId: c, title: 'Case brief draft', date: iso(addDays(t, 6)), time: '17:00', done: false, order: 2, remind: null, priority: 1, steps: [], created: Date.now() },
    ],
    folders: [
      { id: uid(), name: 'Lecture slides', created: Date.now() },
      { id: uid(), name: 'Readings', created: Date.now() },
    ],
    files: [],
    certs: [],
    fired: {},
  };
}

/** Bring anything older up to the v3 shape without losing a keystroke. */
function upgrade(s) {
  const d = seed();
  s.v = 3;
  s.settings = Object.assign({}, d.settings, s.settings || {});
  ['subjects', 'notes', 'classes', 'events', 'tasks', 'folders', 'files', 'certs'].forEach(k => {
    if (!Array.isArray(s[k])) s[k] = [];
  });
  if (!s.subjects.length) s.subjects = d.subjects;
  s.fired = s.fired || {};
  s.ttMode = ['week', 'day', 'agenda'].includes(s.ttMode) ? s.ttMode : 'week';
  s.ttDensity = s.ttDensity === 'roomy' ? 'roomy' : 'fit';
  s.taskView = s.taskView === 'list' ? 'list' : 'board';
  s.fileView = s.fileView === 'list' ? 'list' : 'grid';
  s.ttDate = /^\d{4}-\d{2}-\d{2}$/.test(s.ttDate || '') ? s.ttDate : todayISO();
  if (s.view === 'deadlines') s.view = 'tasks';
  if (s.view === 'reminders') s.view = 'settings';
  if (s.view === 'vault') s.view = 'files';

  s.subjects.forEach(x => { if (typeof x.hue !== 'number') x.hue = 232; });
  s.notes.forEach(n => {
    n.files = Array.isArray(n.files) ? n.files : [];
    if (n.html === undefined) n.html = mdToHTML(n.body || '');      // v1/v2 stored Markdown
    delete n.body;
    n.created = n.created || n.updated || Date.now();
  });
  s.tasks.forEach((t, i) => {
    if (typeof t.priority !== 'number') t.priority = 1;
    if (!Array.isArray(t.steps)) t.steps = [];
    if (t.remind === undefined) t.remind = null;
    if (typeof t.order !== 'number') t.order = i;
    t.created = t.created || Date.now();
  });
  s.classes.forEach(c => { if (c.remind === undefined) c.remind = null; });
  s.events.forEach(e => { if (e.remind === undefined) e.remind = null; });
  s.files.forEach(f => { if (f.folderId === undefined) f.folderId = null; });
  if (!s.subjects.some(x => x.id === s.activeSubject)) s.activeSubject = s.subjects[0].id;
  return s;
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return upgrade(JSON.parse(raw));
    for (const k of OLD_KEYS) {
      const old = localStorage.getItem(k);
      if (old) return upgrade(JSON.parse(old));
    }
  } catch (err) {
    console.warn('Saved data could not be read; starting fresh.', err);
  }
  return seed();
}

let S = loadState();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('Storage is full. Export a backup, then delete a few files.'); }
}

// Write the seeded (or migrated) state straight away, so a first visit that
// gets closed without touching anything still comes back to the same workspace.
try { if (!localStorage.getItem(KEY)) save(); } catch (e) { /* private mode */ }
const persist = debounce(() => {
  save();
  const el = $('#saved');
  if (!el) return;
  el.textContent = 'Saved';
  setTimeout(() => { if (el.textContent === 'Saved') el.textContent = ''; }, 1500);
}, 400);

/** Mutate → autosave → re-render. {quiet:true} skips the re-render (typing). */
function commit(fn, opts = {}) {
  fn(S);
  const el = $('#saved');
  if (el) el.textContent = 'Saving';
  persist();
  if (!opts.quiet) render();
}

/* lookups ------------------------------------------------------------------ */
const subj = id => S.subjects.find(s => s.id === id);
const activeSubj = () => subj(S.activeSubject) || S.subjects[0];
const hue = id => { const s = subj(id); return s ? `hsl(${s.hue} 62% 66%)` : 'var(--rule2)'; };
const code = id => subj(id)?.code || '';
const openTasks = () => S.tasks.filter(t => !t.done);
const folderName = id => S.folders.find(f => f.id === id)?.name || 'Unfiled';
const noteText = n => String(n.html || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 2600);
}

/* =============================================================================
   3 — markup safety
   Notes are rich text. Everything written into a note is sanitised on the way
   out of the editor and on the way in from a restored backup, so a tampered
   backup file can never plant a script in the page.
   ============================================================================= */
const OK_TAGS = new Set(['P', 'BR', 'DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL',
  'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'MARK', 'A', 'HR', 'SUB', 'SUP']);

function cleanHTML(html) {
  const host = document.createElement('div');
  host.innerHTML = String(html || '');
  const walk = node => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === 3) return;                          // text is always fine
      if (child.nodeType !== 1) return child.remove();
      const tag = child.tagName;
      if (!OK_TAGS.has(tag)) {                                   // unwrap, keep the words
        const frag = document.createDocumentFragment();
        [...child.childNodes].forEach(c => frag.appendChild(c));
        child.replaceWith(frag);
        walk(node);
        return;
      }
      [...child.attributes].forEach(a => {
        const n = a.name.toLowerCase();
        const keep = (tag === 'A' && n === 'href' && /^(https?:|mailto:|#|\/)/i.test(a.value.trim()));
        if (!keep) child.removeAttribute(a.name);
      });
      if (tag === 'A') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer'); }
      walk(child);
    });
  };
  walk(host);
  return host.innerHTML;
}

/** Markdown from older versions of Studyframe → the rich-text shape. */
function mdToHTML(src) {
  const inline = s => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const out = []; let list = null, fence = false;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (const raw of String(src || '').split('\n')) {
    if (/^```/.test(raw)) { closeList(); out.push(fence ? '</pre>' : '<pre>'); fence = !fence; continue; }
    if (fence) { out.push(esc(raw)); continue; }
    const h = raw.match(/^(#{1,3})\s+(.*)/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    const ul = raw.match(/^\s*[-*]\s+(.*)/), ol = raw.match(/^\s*\d+\.\s+(.*)/);
    if (ul || ol) {
      const want = ul ? 'ul' : 'ol';
      if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`); continue;
    }
    const q = raw.match(/^>\s?(.*)/);
    if (q) { closeList(); out.push(`<blockquote>${inline(q[1])}</blockquote>`); continue; }
    if (!raw.trim()) { closeList(); continue; }          /* blank lines just separate blocks */
    closeList(); out.push(`<p>${inline(raw)}</p>`);
  }
  closeList();
  if (fence) out.push('</pre>');
  return out.join('');
}

/* =============================================================================
   Occurrences — one source of truth for "what happens when"
   ============================================================================= */
function occurrences(from = new Date(), hours = 30) {
  const out = [];
  const end = new Date(from.getTime() + hours * 3600e3);
  const days = Math.ceil(hours / 24) + 1;

  for (let i = 0; i < days; i++) {
    const d = addDays(from, i), key = iso(d), wd = wdOf(d);

    S.classes.filter(c => c.weekday === wd).forEach(c => out.push({
      id: c.id, kind: 'class', title: c.title, subjectId: c.subjectId,
      when: at(key, c.start), room: c.room, remind: c.remind, date: key, start: c.start, end: c.end,
    }));
    S.events.filter(e => e.date === key).forEach(e => out.push({
      id: e.id, kind: 'event', title: e.title, subjectId: e.subjectId,
      when: at(key, e.start), room: e.room, remind: e.remind, date: key, start: e.start, end: e.end,
    }));
    S.tasks.filter(t => !t.done && t.date === key).forEach(t => out.push({
      id: t.id, kind: 'task', title: t.title, subjectId: t.subjectId, priority: t.priority,
      when: at(key, t.time || S.settings.allDay), room: '', remind: t.remind, date: key, start: t.time || S.settings.allDay,
    }));
  }
  return out.filter(o => o.when >= from && o.when <= end).sort((a, b) => a.when - b.when);
}
const leadFor = o => (o.remind === null || o.remind === undefined ? S.settings.lead : o.remind);

/** Everything on one day, in order. */
function dayBlocks(key) {
  const wd = wdOf(parseISO(key));
  return [
    ...S.classes.filter(c => c.weekday === wd).map(c => ({ ...c, kind: 'class' })),
    ...S.events.filter(e => e.date === key).map(e => ({ ...e, kind: 'event' })),
  ].sort((a, b) => toMin(a.start) - toMin(b.start));
}

/* =============================================================================
   4 — view: home
   The hero is the day drawn as one strip of tape, with a marker that moves.
   ============================================================================= */
let TAPE = { lo: 480, hi: 1260 };

function viewHome() {
  const now = new Date();
  const h = now.getHours();
  const greet = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const name = S.settings.name && S.settings.name !== 'there' ? S.settings.name : '';
  const words = `${greet}${name ? ', ' + name : ''}`.split(' ');
  const hero = words.map((w, i) =>
    `<span class="w"><span style="animation-delay:${(0.05 * i + 0.04).toFixed(2)}s">${esc(w)}${i < words.length - 1 ? '&nbsp;' : ''}</span></span>`).join('');

  const today = todayISO();
  const blocks = dayBlocks(today);
  const due = openTasks().filter(t => t.date <= today);
  const next = occurrences(now, 36)[0];
  const focus = openTasks().sort((a, b) => heat(b) - heat(a)).slice(0, 4);

  const bits = [];
  if (blocks.length) bits.push(`<b>${blocks.length}</b> ${blocks.length > 1 ? 'things' : 'thing'} on the timetable`);
  if (due.length) bits.push(`<b>${due.length}</b> ${due.length > 1 ? 'tasks' : 'task'} due`);
  const line = bits.length ? `${bits.join(' and ')} today.` : 'Nothing scheduled today. A good day to get ahead.';

  return `<div class="wrap">
  <div class="home-top">
    <div>
      <div class="hero-mark">
        <span class="num">/ ${pad(isoWeek(now))}</span>
        <span class="mk-rule" aria-hidden="true"></span>
        <span class="mk-day">${esc(fmtDate(now, { weekday: 'long', day: 'numeric', month: 'long' }))}</span>
      </div>
      <h1 class="greet">${hero}</h1>
      <p class="home-line">${line}</p>
      <div class="home-cta">
        <button class="btn btn-accent" data-act="new-note">${icon('pencil')}Start a note</button>
        <button class="btn" data-act="new-entry" data-date="${today}">${icon('cal')}Add to timetable</button>
        <button class="btn" data-act="view" data-view="tasks">${icon('task')}Tasks</button>
      </div>
    </div>
    ${dialHTML(next)}
  </div>

  ${tapeHTML(today, blocks)}

  <div class="home-grid">
    <section class="panel">
      <div class="panel-h">${icon('cal')}<h3>Today</h3>
        <button class="more" data-act="goto-day" data-date="${today}">Timetable ${icon('right')}</button></div>
      ${blocks.length ? `<div class="line-list">${blocks.map(b => `
        <button class="line" data-act="edit-entry" data-id="${b.id}" data-kind="${b.kind}" style="--subject:${hue(b.subjectId)}">
          <span class="bar"></span>
          <span class="t">${esc(b.start)}</span>
          <span class="nm">${esc(b.title)}</span>
          <span class="rt">${esc(b.room || code(b.subjectId))}</span>
        </button>`).join('')}</div>`
      : '<p class="empty">Nothing on today. Add a class or a one-off.</p>'}
    </section>

    <section class="panel">
      <div class="panel-h">${icon('flag')}<h3>What to do next</h3>
        <button class="more" data-act="view" data-view="tasks">All tasks ${icon('right')}</button></div>
      ${focus.length ? `<div class="line-list">${focus.map(t => `
        <button class="line" data-act="view" data-view="tasks" style="--subject:${prio(t.priority).css}">
          <span class="bar"></span>
          <span class="nm">${esc(t.title)}</span>
          <span class="rt u-${urgency(t.date)}">${esc(whenLabel(t))}</span>
        </button>`).join('')}</div>`
      : '<p class="empty">Nothing outstanding. Enjoy it.</p>'}
    </section>

    <section class="panel">
      <div class="panel-h">${icon('notes')}<h3>Recent notes</h3>
        <button class="more" data-act="view" data-view="notes">Open notes ${icon('right')}</button></div>
      ${S.notes.length ? `<div class="line-list">${[...S.notes].sort((a, b) => b.updated - a.updated).slice(0, 4).map(n => `
        <button class="line" data-act="open-note" data-id="${n.id}" style="--subject:${hue(n.subjectId)}">
          <span class="bar"></span>
          <span class="nm">${esc(n.title || 'Untitled')}</span>
          <span class="rt">${esc(code(n.subjectId))}</span>
        </button>`).join('')}</div>`
      : '<p class="empty">No notes yet. Start one.</p>'}
    </section>
  </div>

  <div class="stats">
    <button class="stat" data-act="view" data-view="notes"><b class="num">${S.notes.length}</b><span>notes</span></button>
    <button class="stat ${due.length ? 'alert' : ''}" data-act="view" data-view="tasks"><b class="num">${due.length}</b><span>due today</span></button>
    <button class="stat" data-act="view" data-view="tasks"><b class="num">${openTasks().length}</b><span>open tasks</span></button>
    <button class="stat" data-act="view" data-view="timetable"><b class="num">${S.classes.length}</b><span>weekly classes</span></button>
    <button class="stat" data-act="view" data-view="files"><b class="num">${S.files.length}</b><span>files</span></button>
    <button class="stat" data-act="view" data-view="certificates"><b class="num">${S.certs.length}</b><span>certificates</span></button>
  </div>
  </div>`;
}

function dialHTML(next) {
  if (!next) {
    return `<aside class="dial free">
      <div><p class="dial-k">Clear</p>
      <p class="dial-t">Nothing booked in the next 36 hours</p>
      <p class="dial-m">${icon('clock')}Add something to the timetable and it shows up here.</p></div>
    </aside>`;
  }
  const kind = next.kind === 'task' ? 'Due next' : 'Up next';
  const C = 207.3;
  return `<aside class="dial">
    <div class="dial-ring" data-ring="${next.when.getTime()}">
      <svg viewBox="0 0 76 76"><circle class="bg" cx="38" cy="38" r="33"></circle>
        <circle class="fg" cx="38" cy="38" r="33" stroke-dasharray="${C}" stroke-dashoffset="${C}"></circle></svg>
      <span class="mid"><b data-cd-short="${next.when.getTime()}">${esc(shortRel(next.when.getTime()))}</b><span>${next.when.getTime() > Date.now() ? 'to go' : 'ago'}</span></span>
    </div>
    <div>
      <p class="dial-k">${kind}</p>
      <p class="dial-t">${esc(next.title)}</p>
      <p class="dial-m">${icon('clock')}${esc(next.start)}${next.room ? ' · ' + esc(next.room) : ''}${next.subjectId ? ' · ' + esc(code(next.subjectId)) : ''}</p>
    </div>
  </aside>`;
}

function tapeHTML(key, blocks) {
  let lo = S.settings.dayStart * 60, hi = S.settings.dayEnd * 60;
  if (blocks.length) {
    lo = Math.min(lo, Math.floor((toMin(blocks[0].start) - 30) / 60) * 60);
    hi = Math.max(hi, Math.ceil((Math.max(...blocks.map(b => toMin(b.end))) + 30) / 60) * 60);
  }
  lo = clamp(lo, 0, 1200); hi = clamp(hi, lo + 240, 1440);
  TAPE = { lo, hi };
  const span = hi - lo;
  const hours = Math.round(span / 60);
  const pos = m => ((clamp(m, lo, hi) - lo) / span) * 100;
  const nowM = new Date().getHours() * 60 + new Date().getMinutes();
  const marks = [];
  for (let m = lo; m <= hi; m += Math.ceil(hours / 7) * 60) marks.push(`<span>${pad(m / 60)}:00</span>`);

  return `<section class="tape-card">
    <div class="tape-head">${icon('layers')}<h3>Your day</h3>
      <span class="now-t" id="tapeClock">${pad(new Date().getHours())}:${pad(new Date().getMinutes())}</span></div>
    <div class="tape" style="--step:${(100 / hours).toFixed(4)}%">
      ${blocks.length ? blocks.map(b => {
        const l = pos(toMin(b.start)), w = Math.max(3.2, pos(toMin(b.end)) - l);
        return `<button class="tape-seg ${w < 9 ? 'tiny' : ''}" style="left:${l}%;width:${w}%;--subject:${hue(b.subjectId)}"
          data-act="edit-entry" data-id="${b.id}" data-kind="${b.kind}" title="${esc(b.title)} · ${esc(b.start)}–${esc(b.end)}">
          <b>${esc(b.title)}</b><span>${esc(b.start)}–${esc(b.end)}</span></button>`;
      }).join('') : '<span class="tape-empty">No classes today</span>'}
      ${nowM >= lo && nowM <= hi ? `<span class="tape-now" id="tapeNow" style="left:${pos(nowM)}%"></span>` : ''}
    </div>
    <div class="tape-scale">${marks.join('')}</div>
  </section>`;
}

/* =============================================================================
   5 — view: notes (the paper surface)
   ============================================================================= */
function viewNotes() {
  const s = activeSubj();
  const notes = S.notes.filter(n => n.subjectId === s.id).sort((a, b) => b.updated - a.updated);
  if (!notes.some(n => n.id === S.noteId)) S.noteId = notes[0]?.id || null;
  const note = S.notes.find(n => n.id === S.noteId);

  const rail = `<div class="note-rail">
    <button class="btn btn-accent" data-act="new-note" style="justify-content:center">${icon('plus')}New note</button>
    ${notes.length ? `<div class="note-list">${notes.map(n => `
      <button class="note-tab" data-act="open-note" data-id="${n.id}" aria-current="${n.id === S.noteId}">
        <b>${esc(n.title || 'Untitled')}</b>
        <span class="nm">${esc(fmtDate(new Date(n.updated), { day: '2-digit', month: 'short' }))}${n.files.length ? ` · ${n.files.length} file${n.files.length > 1 ? 's' : ''}` : ''}</span>
      </button>`).join('')}</div>`
    : `<p class="empty"><b>No notes in ${esc(s.code)}</b>Every note is filed under the subject in the top bar.</p>`}
  </div>`;

  if (!note) return `<div class="wrap"><div class="notes-layout">${rail}<div class="desk"><p class="empty"><b>Nothing open</b>Make a note and this page turns into paper.</p></div></div></div>`;

  const clean = cleanHTML(note.html);
  const attached = note.files.map(id => S.files.find(f => f.id === id)).filter(Boolean);

  return `<div class="wrap"><div class="notes-layout">
    ${rail}
    <div class="desk">
      <article class="sheet">
        <div class="sheet-bar" id="toolbar">
          ${tool('undo', 'undo', 'Undo')}${tool('redo', 'redo', 'Redo')}
          <span class="tool-sep"></span>
          ${tool('bold', 'bold', 'Bold')}${tool('italic', 'italic', 'Italic')}${tool('underline', 'underline', 'Underline')}${tool('strikeThrough', 'strike', 'Strikethrough')}
          <span class="tool-sep"></span>
          ${tool('h1', 'h1', 'Heading')}${tool('h2', 'h2', 'Subheading')}${tool('h3', 'h3', 'Small heading')}
          <span class="tool-sep"></span>
          ${tool('insertUnorderedList', 'ul', 'Bulleted list')}${tool('insertOrderedList', 'ol', 'Numbered list')}${tool('blockquote', 'quote', 'Quote')}
          <span class="tool-sep"></span>
          ${tool('mark', 'mark', 'Highlight')}${tool('code', 'code', 'Code')}${tool('link', 'link', 'Add a link')}${tool('removeFormat', 'eraser', 'Clear formatting')}
          <span class="grow"></span>
          <span class="wc" id="wordCount"></span>
          ${tool('print', 'doc', 'Print this note')}
          ${tool('delete-note', 'trash', 'Delete this note')}
        </div>

        <input class="sheet-title" id="noteTitle" data-act="note-title" value="${esc(note.title)}" placeholder="Untitled" aria-label="Note title" autocomplete="off">
        <p class="sheet-meta">
          <span>${esc(s.code)} · ${esc(s.name)}</span>
          <span>Saved ${esc(new Date(note.updated).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span>
        </p>

        <div class="page">
          <div class="paper-body" id="paperBody" contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true"
               aria-label="Note" data-ph="Start writing.">${clean}</div>
        </div>

        <div class="sheet-foot">
          ${attached.map(f => `<span class="clip">${icon('doc')}<span class="n">${esc(f.name)}</span>
            <button data-act="open-file" data-id="${f.id}" aria-label="Open ${esc(f.name)}">${icon('ext')}</button>
            <button data-act="unattach" data-id="${f.id}" aria-label="Remove ${esc(f.name)}">${icon('close')}</button></span>`).join('')}
          ${S.files.length ? `<span class="attach-pick"><label class="vh" for="attachSel">Attach a file</label>
            <select id="attachSel" data-act="attach"><option value="">Attach a file…</option>
            ${S.files.filter(f => !note.files.includes(f.id)).map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></span>`
          : `<button class="clip" data-act="view" data-view="files">${icon('up-tray')}<span class="n">Upload a file first</span></button>`}
        </div>
      </article>
    </div>
  </div></div>`;
}

const tool = (cmd, ic, label) =>
  `<button class="tool" data-tool="${cmd}" title="${esc(label)}" aria-label="${esc(label)}">${icon(ic)}</button>`;

/* ---------- rich-text editing ---------- */
let savedRange = null;

function saveRange() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount && $('#paperBody')?.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
}
function restoreRange() {
  const body = $('#paperBody');
  if (!body) return false;
  body.focus();
  if (!savedRange) return false;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(savedRange);
  return true;
}
function exec(cmd, val = null) {
  try { document.execCommand(cmd, false, val); } catch (e) { /* older engine */ }
}

/** Wrap or unwrap the selection in a simple inline tag (mark, code). */
function toggleInline(tag) {
  const body = $('#paperBody');
  if (!body) return;
  restoreRange();
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);

  let node = sel.anchorNode;
  while (node && node !== body) {
    if (node.nodeType === 1 && node.tagName.toLowerCase() === tag) {      // already inside → unwrap
      const parent = node.parentNode;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
      parent.normalize();
      afterEdit();
      return;
    }
    node = node.parentNode;
  }
  if (range.collapsed) return;
  const frag = range.cloneContents();
  const host = document.createElement('div');
  host.appendChild(frag);
  exec('insertHTML', `<${tag}>${host.innerHTML}</${tag}>`);
  afterEdit();
}

function runTool(cmd) {
  const body = $('#paperBody');
  if (!body) return;

  if (cmd === 'delete-note') return actions['del-note'](null, { dataset: { id: S.noteId } });
  if (cmd === 'print') return window.print();

  restoreRange();
  switch (cmd) {
    case 'h1': case 'h2': case 'h3': {
      const cur = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
      exec('formatBlock', cur === cmd ? '<p>' : `<${cmd}>`);
      break;
    }
    case 'blockquote': {
      const cur = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
      exec('formatBlock', cur === 'blockquote' ? '<p>' : '<blockquote>');
      break;
    }
    case 'mark': return toggleInline('mark');
    case 'code': return toggleInline('code');
    case 'link': return linkSheet();
    case 'removeFormat': {
      exec('removeFormat');
      exec('formatBlock', '<p>');
      break;
    }
    default: exec(cmd);
  }
  afterEdit();
}

function afterEdit() {
  const body = $('#paperBody');
  if (!body) return;
  saveRange();
  saveNoteBody();
  syncTools();
}

const saveNoteBody = debounce(() => {
  const body = $('#paperBody');
  if (!body) return;
  commit(s => {
    const n = s.notes.find(x => x.id === s.noteId);
    if (!n) return;
    n.html = body.innerHTML;
    n.updated = Date.now();
  }, { quiet: true });
  updateWordCount();
}, 220);

function updateWordCount() {
  const body = $('#paperBody'), out = $('#wordCount');
  if (!body || !out) return;
  const words = (body.textContent.trim().match(/\S+/g) || []).length;
  out.textContent = `${words} word${words === 1 ? '' : 's'}`;
  body.dataset.empty = String(!body.textContent.trim() && !body.querySelector('img,hr'));
}

function syncTools() {
  const bar = $('#toolbar');
  if (!bar) return;
  const st = c => { try { return document.queryCommandState(c); } catch (e) { return false; } };
  const block = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
  const inside = tag => {
    let n = window.getSelection()?.anchorNode;
    const body = $('#paperBody');
    while (n && n !== body) { if (n.nodeType === 1 && n.tagName.toLowerCase() === tag) return true; n = n.parentNode; }
    return false;
  };
  const map = {
    bold: st('bold'), italic: st('italic'), underline: st('underline'), strikeThrough: st('strikeThrough'),
    insertUnorderedList: st('insertUnorderedList'), insertOrderedList: st('insertOrderedList'),
    h1: block === 'h1', h2: block === 'h2', h3: block === 'h3', blockquote: block === 'blockquote',
    mark: inside('mark'), code: inside('code'),
  };
  $$('.tool', bar).forEach(b => {
    const k = b.dataset.tool;
    if (k in map) b.setAttribute('aria-pressed', String(!!map[k]));
  });
}

function wireEditor() {
  const body = $('#paperBody');
  if (!body) return;
  try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* fine */ }
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* fine */ }
  updateWordCount();

  body.addEventListener('input', () => { saveNoteBody(); saveRange(); updateWordCount(); });
  body.addEventListener('keyup', () => { saveRange(); syncTools(); });
  body.addEventListener('mouseup', () => { saveRange(); syncTools(); });
  body.addEventListener('blur', () => {
    commit(s => {
      const n = s.notes.find(x => x.id === s.noteId);
      if (n) { n.html = cleanHTML(body.innerHTML); n.updated = Date.now(); }
    }, { quiet: true });
  });
  body.addEventListener('paste', e => {
    e.preventDefault();
    const dt = e.clipboardData;
    const html = dt.getData('text/html');
    if (html) exec('insertHTML', cleanHTML(html));
    else exec('insertText', dt.getData('text/plain'));
    afterEdit();
  });
  body.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); runTool('bold'); }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); runTool('italic'); }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'u') { e.preventDefault(); runTool('underline'); }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'h') { e.preventDefault(); runTool('mark'); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); saveRange(); linkSheet(); }
    if (e.key === 'Tab') { e.preventDefault(); exec(e.shiftKey ? 'outdent' : 'indent'); afterEdit(); }
  });

  const bar = $('#toolbar');
  bar.addEventListener('mousedown', e => { if (e.target.closest('.tool')) e.preventDefault(); });
  bar.addEventListener('click', e => {
    const b = e.target.closest('.tool');
    if (b) runTool(b.dataset.tool);
  });
}

/* =============================================================================
   6 — view: timetable (absorbs reminders)
   Fit mode hugs the hours you actually use, so a week fits on one screen.
   ============================================================================= */
let TT = { lo: 480, hi: 1260, hours: 13 };

function ttWindow(keys) {
  let lo = S.settings.dayStart * 60, hi = S.settings.dayEnd * 60;
  const all = keys.flatMap(k => dayBlocks(k));
  if (S.ttDensity === 'fit' && all.length) {
    lo = Math.floor((Math.min(...all.map(b => toMin(b.start))) - 30) / 60) * 60;
    hi = Math.ceil((Math.max(...all.map(b => toMin(b.end))) + 30) / 60) * 60;
  }
  lo = clamp(lo, 0, 1140);
  hi = clamp(hi, lo + 300, 1440);
  return { lo, hi, hours: Math.max(1, Math.round((hi - lo) / 60)) };
}

function ttBar(label, mode) {
  const step = mode === 'week' ? 7 : 1;
  return `<div class="tt-bar">
    <div class="tt-nav">
      <button data-act="shift" data-n="${-step}" aria-label="Previous">${icon('left')}</button>
      <button class="mid" data-act="today">${esc(label)}</button>
      <button data-act="shift" data-n="${step}" aria-label="Next">${icon('right')}</button>
    </div>
    <div class="seg">
      <button data-act="mode" data-mode="week" aria-pressed="${mode === 'week'}">Week</button>
      <button data-act="mode" data-mode="day" aria-pressed="${mode === 'day'}">Day</button>
      <button data-act="mode" data-mode="agenda" aria-pressed="${mode === 'agenda'}">Agenda</button>
    </div>
    <span class="spacer"></span>
    ${mode === 'week' && !MOBILE ? `<div class="seg">
      <button data-act="density" data-d="fit" aria-pressed="${S.ttDensity === 'fit'}" title="Fit the whole week on screen">Compact</button>
      <button data-act="density" data-d="roomy" aria-pressed="${S.ttDensity === 'roomy'}" title="Full day, taller rows">Roomy</button>
    </div>` : ''}
    <button class="btn btn-accent" data-act="new-entry" data-date="${esc(S.ttDate)}">${icon('plus')}Add entry</button>
  </div>`;
}

function viewTimetable() {
  const cur = parseISO(S.ttDate);
  if (S.ttMode === 'agenda') return timetableAgenda();
  if (S.ttMode === 'day') return timetableDay(cur);
  return MOBILE ? timetableWeekMobile(cur) : timetableWeek(cur);
}

function timetableWeek(cur) {
  const mon = mondayOf(cur);
  const keys = [...Array(7)].map((_, i) => iso(addDays(mon, i)));
  const W = ttWindow(keys); TT = W;
  const span = W.hi - W.lo;
  const pct = m => ((clamp(m, W.lo, W.hi) - W.lo) / span) * 100;

  const gutter = [];
  for (let m = W.lo; m <= W.hi; m += 60) gutter.push(`<span style="top:${pct(m)}%">${pad(m / 60)}:00</span>`);

  const heads = [], cols = [];
  keys.forEach((key, i) => {
    const d = parseISO(key), isToday = key === todayISO();
    const tasks = S.tasks.filter(t => t.date === key && !t.done);
    heads.push(`<div class="tt-dayhead ${isToday ? 'is-today' : ''}">
      <span class="dw">${DAY[i]}</span><span class="dn">${d.getDate()}</span>
      <span class="pips">${tasks.slice(0, 4).map(t => `<i style="--pcol:${prio(t.priority).css}"></i>`).join('')}</span>
    </div>`);

    const blocks = dayBlocks(key).map(b => blockHTML(b, pct)).join('');
    const chips = tasks.filter(t => t.time).map(t => {
      const m = toMin(t.time);
      if (m < W.lo || m > W.hi) return '';
      return `<button class="tt-task" style="top:calc(${pct(m)}% - 8px);--pcol:${prio(t.priority).css}"
        data-act="edit-task" data-id="${t.id}" title="${esc(t.title)} · due ${esc(t.time)}">${icon('flag')}<b>${esc(t.title)}</b></button>`;
    }).join('');

    cols.push(`<div class="tt-col ${isToday ? 'is-today' : ''} ${i > 4 ? 'is-weekend' : ''}" data-act="new-entry" data-date="${key}" data-wd="${i}">
      ${blocks}${chips}
      ${isToday ? nowLineHTML(pct) : ''}
    </div>`);
  });

  return `<div class="wrap">
    ${ttBar(`Week of ${fmtDate(mon, { day: 'numeric', month: 'long' })}`, 'week')}
    <div class="tt" id="ttGrid" style="--hourpx:${S.ttDensity === 'fit' ? 48 : 62}px">
      <div class="tt-days"><div></div>${heads.join('')}</div>
      <div class="tt-body" id="ttBody" style="height:${W.hours * (S.ttDensity === 'fit' ? 48 : 62)}px">
        <div class="tt-gutter">${gutter.join('')}</div>
        ${cols.join('')}
      </div>
    </div>
    <p class="tt-legend">
      <span><i style="background:color-mix(in srgb,var(--iris) 24%,#0E131B);border-left:3px solid var(--iris)"></i>Repeats weekly</span>
      <span><i style="background:#0E131B;border:1px dashed var(--rule2);border-left:3px solid var(--rule2)"></i>One-off, this date only</span>
      <span>${icon('bell')} has a reminder</span>
      <span>Click an empty slot to add something there.</span>
    </p>
  </div>`;
}

function blockHTML(b, pct) {
  const top = pct(toMin(b.start));
  const h = Math.max(1.6, pct(toMin(b.end)) - top);
  const bell = (b.remind !== null && b.remind !== undefined && b.remind >= 0) ? icon('bell', 'ic bell') : '';
  return `<button class="tt-block ${b.kind === 'event' ? 'is-event' : ''}" style="top:${top}%;height:${h}%;--subject:${hue(b.subjectId)}"
    data-act="edit-entry" data-id="${b.id}" data-kind="${b.kind}" title="${esc(b.title)} · ${esc(b.start)}–${esc(b.end)}${b.room ? ' · ' + esc(b.room) : ''}">
    ${bell}<span class="bn">${esc(b.title)}</span><span class="bt">${esc(b.start)}–${esc(b.end)}</span>
    ${b.room || b.subjectId ? `<span class="br">${esc([code(b.subjectId), b.room].filter(Boolean).join(' · '))}</span>` : ''}
  </button>`;
}

function nowLineHTML(pct) {
  const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
  if (m < TT.lo || m > TT.hi) return '';
  return `<div class="tt-now" id="ttNow" style="top:${pct(m)}%"></div>`;
}

/** Sizes the grid to the space left on screen, then labels blocks by height. */
function fitTimetable() {
  const grid = $('#ttGrid'), body = $('#ttBody');
  if (!grid || !body) return;
  let px = 62;
  if (S.ttDensity === 'fit') {
    const head = $('.tt-days')?.offsetHeight || 46;
    const top = grid.getBoundingClientRect().top;
    const avail = window.innerHeight - top - head - 78;
    px = clamp(avail / TT.hours, 34, 128);
  }
  grid.style.setProperty('--hourpx', `${px}px`);
  body.style.height = `${px * TT.hours}px`;
  $$('.tt-block', body).forEach(b => {
    b.classList.remove('sm', 'md');
    const h = b.offsetHeight;
    if (h < 34) b.classList.add('sm');
    else if (h < 58) b.classList.add('md');
  });
}

function timetableWeekMobile(cur) {
  const mon = mondayOf(cur);
  const keys = [...Array(7)].map((_, i) => iso(addDays(mon, i)));
  return `<div class="wrap">
    ${ttBar(fmtDate(mon, { day: 'numeric', month: 'short' }), 'week')}
    ${keys.map((key, i) => {
      const blocks = dayBlocks(key);
      const tasks = S.tasks.filter(t => t.date === key && !t.done);
      const isToday = key === todayISO();
      if (!blocks.length && !tasks.length) return '';
      return `<section class="panel" style="margin-bottom:12px">
        <div class="panel-h">${icon('cal')}<h3>${DAY_FULL[i]} ${parseISO(key).getDate()}${isToday ? ' · today' : ''}</h3>
          <button class="more" data-act="goto-day" data-date="${key}">Open ${icon('right')}</button></div>
        <div class="slot-list">
          ${blocks.map(b => slotHTML(b)).join('')}
          ${tasks.map(t => `<button class="slot" style="--subject:${prio(t.priority).css}" data-act="edit-task" data-id="${t.id}">
            <span class="when">${esc(t.time || 'due')}</span>
            <span class="bd"><b>${esc(t.title)}</b><span>${esc(prio(t.priority).label)} priority · ${esc(code(t.subjectId))}</span></span>
          </button>`).join('')}
        </div>
      </section>`;
    }).join('') || '<p class="empty"><b>An empty week</b>Add a class or a one-off and it appears here.</p>'}
  </div>`;
}

const slotHTML = b => `<button class="slot" style="--subject:${hue(b.subjectId)}" data-act="edit-entry" data-id="${b.id}" data-kind="${b.kind}">
  <span class="when">${esc(b.start)}–${esc(b.end)}</span>
  <span class="bd"><b>${esc(b.title)}</b><span>${esc([code(b.subjectId), b.room, b.kind === 'class' ? 'weekly' : 'one-off'].filter(Boolean).join(' · '))}</span></span>
  ${b.remind >= 0 && b.remind !== null ? `<span class="rt">${icon('bell')}</span>` : ''}
</button>`;

function timetableDay(d) {
  const key = iso(d);
  const blocks = dayBlocks(key);
  const tasks = S.tasks.filter(t => t.date === key).sort((a, b) => Number(a.done) - Number(b.done) || heat(b) - heat(a));
  const mon = mondayOf(d);

  return `<div class="wrap">
    ${ttBar(fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' }), 'day')}
    <div class="daystrip">${[...Array(7)].map((_, i) => {
      const k = iso(addDays(mon, i)), dd = parseISO(k);
      const n = S.tasks.filter(t => t.date === k && !t.done);
      return `<button class="dchip ${k === todayISO() ? 'today' : ''}" aria-current="${k === key}" data-act="goto-day" data-date="${k}">
        <span class="dw">${DAY[i]}</span><span class="dn">${dd.getDate()}</span>
        <span class="pips">${n.slice(0, 3).map(t => `<i style="--pcol:${prio(t.priority).css}"></i>`).join('')}</span></button>`;
    }).join('')}</div>

    <div class="day-grid">
      <section class="panel">
        <div class="panel-h">${icon('cal')}<h3>Schedule</h3><span class="spacer"></span>
          <button class="btn btn-sm" data-act="new-entry" data-date="${key}">${icon('plus')}Add</button></div>
        ${blocks.length ? `<div class="slot-list">${blocks.map(b => slotHTML(b)).join('')}</div>`
        : '<p class="empty"><b>Nothing booked</b>Add a class, a shift, anything with a time.</p>'}
      </section>

      <section class="panel">
        <div class="panel-h">${icon('task')}<h3>Due this day</h3></div>
        ${tasks.length ? `<div class="lane-list">${tasks.map(t => taskCard(t, { compact: true })).join('')}</div>`
        : '<p class="empty">Nothing due.</p>'}
        <form class="step-add" data-form="add-task" data-date="${key}" style="margin-top:12px">
          <input type="text" name="title" placeholder="Add a task for this day…" required autocomplete="off">
          <button class="btn btn-sm">${icon('plus')}</button>
        </form>
      </section>
    </div>
  </div>`;
}

function timetableAgenda() {
  const up = occurrences(new Date(), 72);
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  const groups = {};
  up.forEach(o => { (groups[o.date] = groups[o.date] || []).push(o); });

  return `<div class="wrap">
    ${ttBar('Next three days', 'agenda')}
    <div class="day-grid">
      <section class="panel">
        <div class="panel-h">${icon('clock')}<h3>What is coming</h3><span class="spacer"></span>
          <span class="hint">${up.length} item${up.length === 1 ? '' : 's'}</span></div>
        ${up.length ? Object.entries(groups).map(([date, items]) => `
          <p class="agenda-day">${esc(fmtDate(parseISO(date), { weekday: 'long', day: 'numeric', month: 'short' }))}</p>
          <div class="slot-list">${items.map(o => `
            <div class="agenda-item">
              <span class="cd" data-cd="${o.when.getTime()}">${esc(relTime(o.when.getTime()))}</span>
              <span class="bd"><b>${esc(o.title)}</b>
                <span>${esc(o.start)}${o.room ? ' · ' + esc(o.room) : ''} · ${o.kind === 'task' ? 'task due' : o.kind === 'class' ? 'class' : 'one-off'}</span></span>
              <select data-act="set-remind" data-id="${o.id}" data-kind="${o.kind}" aria-label="Reminder for ${esc(o.title)}">
                ${remindOptions(o.remind)}
              </select>
            </div>`).join('')}</div>`).join('')
        : '<p class="empty"><b>Clear for three days</b>Nothing scheduled and nothing due.</p>'}
      </section>

      <section class="panel">
        <div class="panel-h">${icon('bell')}<h3>Alerts</h3></div>
        <div class="set-row">
          <div class="bd"><b>Default warning</b><span>Used when an entry has no setting of its own</span></div>
          <select data-act="set-lead">${[-1, 0, 5, 10, 15, 30, 60, 120].map(v =>
            `<option value="${v}" ${S.settings.lead === v ? 'selected' : ''}>${v < 0 ? 'Off' : v === 0 ? 'On the dot' : `${v} min before`}</option>`).join('')}</select>
        </div>
        <div class="set-row">
          <div class="bd"><b>Sound</b><span>A short chime with each alert</span></div>
          <label class="switch"><input type="checkbox" data-act="toggle-sound" ${S.settings.sound ? 'checked' : ''}><span class="tr"></span></label>
        </div>
        <div class="set-row">
          <div class="bd"><b>Desktop notifications</b><span>${perm === 'granted' ? 'On for this site' : perm === 'denied' ? 'Blocked — turn them back on in your browser site settings' : 'Off'}</span></div>
          ${perm === 'granted'
            ? `<button class="btn btn-sm" data-act="test-notify">Send a test</button>`
            : perm === 'denied' ? '' : `<button class="btn btn-sm" data-act="ask-notify">Turn on</button>`}
        </div>
        <p class="hint" style="margin-top:12px">Alerts fire while this page is open in a tab. Pin the tab and it will ping you.</p>
      </section>
    </div>
  </div>`;
}

/* =============================================================================
   7 — view: tasks (was Deadlines — now ordered by priority)
   ============================================================================= */
const EXPANDED = new Set();

function taskScopeList() {
  const all = S.taskScope === 'subject' ? S.tasks.filter(t => t.subjectId === S.activeSubject) : S.tasks;
  return all;
}

function viewTasks() {
  const all = taskScopeList();
  const open = all.filter(t => !t.done);
  const done = all.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const top = [...open].sort((a, b) => heat(b) - heat(a))[0];
  const late = open.filter(t => urgency(t.date) === 'late').length;

  return `<div class="wrap">
    <div class="sec-h">
      <h2>Tasks</h2>
      <p>${open.length} open${late ? ` · ${late} overdue` : ''}</p>
      <span class="spacer"></span>
    </div>

    ${top ? focusHTML(top) : `<div class="focus" style="--pcol:var(--mint)">
      <span class="focus-k">All clear</span>
      <div><h3>Nothing on your plate</h3><p class="m">Add a task below and the most pressing one is pinned here.</p></div>
    </div>`}

    <div class="task-bar">
      <div class="seg">
        <button data-act="task-view" data-v="board" aria-pressed="${S.taskView === 'board'}">By priority</button>
        <button data-act="task-view" data-v="list" aria-pressed="${S.taskView === 'list'}">By date</button>
      </div>
      <button class="chip" data-act="task-scope" aria-pressed="${S.taskScope === 'subject'}">${icon('layers')}${S.taskScope === 'subject' ? esc(activeSubj().code) + ' only' : 'All subjects'}</button>
      <button class="chip" data-act="show-done" aria-pressed="${!!S.taskShowDone}">${icon('check')}Finished${done.length ? ` (${done.length})` : ''}</button>
      <span class="spacer"></span>
      ${done.length && S.taskShowDone ? `<button class="btn btn-sm btn-danger" data-act="clear-done">${icon('trash')}Clear finished</button>` : ''}
    </div>

    ${S.taskView === 'board' ? boardHTML(open) : listHTML(open)}

    ${S.taskShowDone && done.length ? `<section class="panel" style="margin-top:16px">
      <div class="panel-h">${icon('check')}<h3>Finished</h3></div>
      <div class="lane-list">${done.slice(0, 20).map(t => taskCard(t, { compact: true })).join('')}</div>
    </section>` : ''}

    <div class="sec-h" style="margin:22px 0 12px"><h2 style="font-size:16px">Add a task</h2></div>
    <form class="add-task" data-form="add-task">
      <input type="text" name="title" placeholder="Assignment, quiz, reading, submission…" required autocomplete="off">
      <div class="row2" style="display:flex;gap:8px">
        <input type="date" name="date" value="${todayISO()}" required aria-label="Due date">
        <input type="time" name="time" aria-label="Due time">
      </div>
      <div class="pgroup" role="group" aria-label="Priority">
        ${PRIO.map(p => `<button type="button" data-act="pick-prio" data-v="${p.v}" aria-pressed="${(S.newPrio ?? 1) === p.v}"
          title="${p.label}" aria-label="${p.label} priority" style="--pcol:${p.css}"><i></i></button>`).join('')}
      </div>
      <input type="hidden" name="priority" value="${S.newPrio ?? 1}">
      <button class="btn btn-accent">${icon('plus')}Add</button>
    </form>
    <p class="hint" style="margin-top:9px">Filed under ${esc(activeSubj().name)}. Change the subject in the top bar to file it elsewhere.</p>
  </div>`;
}

function focusHTML(t) {
  const p = prio(t.priority);
  const steps = t.steps.length ? ` · ${t.steps.filter(s => s.done).length}/${t.steps.length} steps` : '';
  return `<div class="focus" style="--pcol:${p.css}">
    <button class="big-check" data-act="toggle" data-id="${t.id}" aria-label="Mark ${esc(t.title)} done">${icon('check')}</button>
    <div>
      <span class="focus-k">Start here · ${esc(p.label)}</span>
      <h3>${esc(t.title)}</h3>
      <p class="m"><span class="u-${urgency(t.date)}">${esc(whenLabel(t))}</span><span>${esc(code(t.subjectId))}${steps}</span></p>
    </div>
    <button class="btn go" data-act="edit-task" data-id="${t.id}">${icon('pencil')}Open</button>
  </div>`;
}

function boardHTML(open) {
  return `<div class="board">${[...PRIO].reverse().map(p => {
    const list = open.filter(t => prio(t.priority).v === p.v).sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
    return `<section class="lane" data-lane="${p.v}" style="--pcol:${p.css}">
      <div class="lane-h"><span class="dot"></span><h3>${p.label}</h3><span class="n">${list.length}</span></div>
      <div class="lane-list">${list.map(t => taskCard(t)).join('') || `<p class="hint" style="padding:8px 4px">Drag a task here.</p>`}</div>
    </section>`;
  }).join('')}</div>`;
}

function listHTML(open) {
  const groups = [
    ['Overdue', t => urgency(t.date) === 'late'],
    ['Today', t => urgency(t.date) === 'today'],
    ['Next three days', t => urgency(t.date) === 'soon'],
    ['Later', t => urgency(t.date) === 'later'],
  ];
  const sorted = [...open].sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99') || heat(b) - heat(a));
  const out = groups.map(([label, test]) => {
    const list = sorted.filter(test);
    if (!list.length) return '';
    return `<section class="lane" style="--pcol:${label === 'Overdue' ? 'var(--p3)' : label === 'Today' ? 'var(--p2)' : 'var(--p1)'}">
      <div class="lane-h"><span class="dot"></span><h3>${label}</h3><span class="n">${list.length}</span></div>
      <div class="lane-list">${list.map(t => taskCard(t)).join('')}</div>
    </section>`;
  }).join('');
  return `<div class="board">${out || '<p class="empty"><b>Nothing open</b>Add a task below.</p>'}</div>`;
}

function taskCard(t, { compact = false } = {}) {
  const p = prio(t.priority);
  const s = subj(t.subjectId);
  const doneSteps = t.steps.filter(x => x.done).length;
  const expanded = EXPANDED.has(t.id);
  const showSteps = t.steps.length || expanded;

  return `<article class="task ${t.done ? 'done' : ''}" data-id="${t.id}" draggable="${!compact}" style="--pcol:${p.css}">
    <button class="task-check" data-act="toggle" data-id="${t.id}" aria-pressed="${t.done}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}">${icon('check')}</button>
    <div class="task-bd">
      <input class="task-title" data-act="rename" data-id="${t.id}" value="${esc(t.title)}" aria-label="Task name">
      <div class="task-meta">
        <span class="due u-${urgency(t.date)}">${esc(whenLabel(t))}</span>
        ${s ? `<span class="code" style="color:${hue(s.id)}">${esc(s.code)}</span>` : ''}
        ${t.steps.length ? `<span>${doneSteps}/${t.steps.length} done</span>` : ''}
        ${t.remind !== null && t.remind >= 0 ? `<span>${icon('bell')}</span>` : ''}
      </div>
      ${t.steps.length ? `<div class="prog"><i style="width:${Math.round(doneSteps / t.steps.length * 100)}%"></i></div>` : ''}
      ${showSteps ? `<div class="steps">
        ${t.steps.map(st => `<button class="step ${st.done ? 'on' : ''}" data-act="toggle-step" data-id="${t.id}" data-sid="${st.id}">
          <span class="bx">${icon('check')}</span><span>${esc(st.text)}</span>
          <span class="rm" data-act="del-step" data-id="${t.id}" data-sid="${st.id}" role="button" aria-label="Remove step">${icon('close')}</span>
        </button>`).join('')}
        <form class="step-add" data-form="add-step" data-id="${t.id}">
          <input type="text" name="text" placeholder="Add a step…" required autocomplete="off">
          <button class="btn btn-sm">${icon('plus')}</button>
        </form>
      </div>` : ''}
    </div>
    <div class="task-actions">
      <button class="icon-btn" data-act="bump-prio" data-id="${t.id}" aria-label="Change priority" title="Priority: ${p.label}">${icon('flag')}</button>
      <button class="icon-btn" data-act="toggle-steps" data-id="${t.id}" aria-label="Checklist" title="Checklist">${icon('list')}</button>
      <button class="icon-btn" data-act="edit-task" data-id="${t.id}" aria-label="Edit task" title="Edit">${icon('pencil')}</button>
      <button class="icon-btn danger" data-act="del-task" data-id="${t.id}" aria-label="Delete task" title="Delete">${icon('trash')}</button>
    </div>
  </article>`;
}

/* =============================================================================
   8 — view: files
   ============================================================================= */
const EXT = n => (String(n).split('.').pop() || 'file').toUpperCase().slice(0, 4);
const PREVIEWABLE = t => String(t).startsWith('image/') || t === 'application/pdf' || String(t).startsWith('text/');
const size = b => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

function ftype(f) {
  const t = String(f.type || ''), e = EXT(f.name);
  if (t.startsWith('image/')) return { ic: 'img', c: '#58D6C0' };
  if (t === 'application/pdf' || e === 'PDF') return { ic: 'doc', c: '#FF6B6B' };
  if (['PPT', 'PPTX', 'KEY', 'ODP'].includes(e)) return { ic: 'layers', c: '#F6A524' };
  if (['XLS', 'XLSX', 'CSV', 'TSV'].includes(e)) return { ic: 'grid', c: '#58D6C0' };
  if (['DOC', 'DOCX', 'ODT', 'RTF'].includes(e)) return { ic: 'doc', c: '#7C8CF8' };
  if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ'].includes(e)) return { ic: 'layers', c: '#98A4BC' };
  if (t.startsWith('audio/') || t.startsWith('video/')) return { ic: 'layers', c: '#C08CF8' };
  if (t.startsWith('text/')) return { ic: 'doc', c: '#98A4BC' };
  return { ic: 'doc', c: '#98A4BC' };
}

function viewFiles() {
  const sel = S.folderId;
  const files = S.files
    .filter(f => sel === null || (sel === '__unfiled' ? !f.folderId : f.folderId === sel))
    .sort((a, b) => b.added - a.added);
  const unfiled = S.files.filter(f => !f.folderId).length;
  const target = sel && sel !== '__unfiled' ? folderName(sel) : 'Unfiled';
  const used = S.files.reduce((n, f) => n + (f.size || 0), 0);

  return `<div class="wrap">
    <div class="sec-h">
      <h2>Files</h2>
      <p>${S.files.length} stored · ${size(used)}</p>
      <span class="spacer"></span>
      <div class="seg">
        <button data-act="file-view" data-v="grid" aria-pressed="${S.fileView === 'grid'}" aria-label="Grid">${icon('grid')}</button>
        <button data-act="file-view" data-v="list" aria-pressed="${S.fileView === 'list'}" aria-label="List">${icon('list')}</button>
      </div>
    </div>

    <div class="folder-rail">
      <button class="folder" data-act="open-folder" data-id="" aria-current="${sel === null}">All files <span class="c">${S.files.length}</span></button>
      ${S.folders.map(f => `<button class="folder" data-act="open-folder" data-id="${f.id}" aria-current="${sel === f.id}">
        ${esc(f.name)} <span class="c">${S.files.filter(x => x.folderId === f.id).length}</span></button>`).join('')}
      ${unfiled ? `<button class="folder" data-act="open-folder" data-id="__unfiled" aria-current="${sel === '__unfiled'}">Unfiled <span class="c">${unfiled}</span></button>` : ''}
      <button class="folder" data-act="new-folder">${icon('plus')}New folder</button>
      ${sel && sel !== '__unfiled' ? `
        <button class="icon-btn" data-act="rename-folder" data-id="${sel}" aria-label="Rename folder">${icon('pencil')}</button>
        <button class="icon-btn danger" data-act="del-folder" data-id="${sel}" aria-label="Delete folder">${icon('trash')}</button>` : ''}
    </div>

    <div class="drop" id="drop">
      <span class="di">${icon('up-tray')}</span>
      <b>Drop lecture files here</b>
      <p class="hint">They land in <b>${esc(target)}</b>. PDFs, images and text open in the page; anything else is stored and downloads.</p>
      <label class="btn">${icon('files')}Choose files<input type="file" id="picker" multiple hidden></label>
    </div>

    ${files.length
      ? (S.fileView === 'grid'
        ? `<div class="file-grid">${files.map(fileCard).join('')}</div>`
        : `<div class="file-list">${files.map(fileRow).join('')}</div>`)
      : `<p class="empty"><b>Nothing in ${esc(sel === null ? 'your files' : target)}</b>Drop a PDF or a slide deck above and it is yours offline.</p>`}
  </div>`;
}

function fileCard(f) {
  const t = ftype(f);
  const isImg = String(f.type).startsWith('image/');
  return `<article class="file-card">
    <button class="thumb" style="--fc:${t.c}" data-act="open-file" data-id="${f.id}" ${isImg ? `data-thumb="${f.id}"` : ''} aria-label="Open ${esc(f.name)}">
      ${icon(t.ic)}<span class="ext">${esc(EXT(f.name))}</span>
    </button>
    <div class="file-bd"><b title="${esc(f.name)}">${esc(f.name)}</b><span>${size(f.size)} · ${esc(fmtDate(new Date(f.added), { day: '2-digit', month: 'short' }))}</span></div>
    <div class="file-acts">
      <button class="icon-btn" data-act="open-file" data-id="${f.id}" aria-label="Open">${icon('eye')}</button>
      <button class="icon-btn" data-act="dl-file" data-id="${f.id}" aria-label="Download">${icon('down-tray')}</button>
      <button class="icon-btn" data-act="rename-file" data-id="${f.id}" aria-label="Rename">${icon('pencil')}</button>
      <span class="spacer"></span>
      <button class="icon-btn danger" data-act="del-file" data-id="${f.id}" aria-label="Delete">${icon('trash')}</button>
    </div>
  </article>`;
}

function fileRow(f) {
  const t = ftype(f);
  return `<div class="file-row">
    <button class="sq" style="--fc:${t.c}" data-act="open-file" data-id="${f.id}" aria-label="Open ${esc(f.name)}" ${String(f.type).startsWith('image/') ? `data-thumb="${f.id}"` : ''}>${icon(t.ic)}</button>
    <div style="min-width:0"><b>${esc(f.name)}</b><span class="meta">${size(f.size)} · ${esc(folderName(f.folderId))}</span></div>
    <label class="vh" for="mv-${f.id}">Folder for ${esc(f.name)}</label>
    <select id="mv-${f.id}" data-act="move-file" data-id="${f.id}" style="width:auto;min-width:130px">
      <option value="" ${!f.folderId ? 'selected' : ''}>Unfiled</option>
      ${S.folders.map(x => `<option value="${x.id}" ${f.folderId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
    </select>
    <span style="display:flex;gap:1px">
      <button class="icon-btn" data-act="dl-file" data-id="${f.id}" aria-label="Download">${icon('down-tray')}</button>
      <button class="icon-btn danger" data-act="del-file" data-id="${f.id}" aria-label="Delete">${icon('trash')}</button>
    </span>
  </div>`;
}

/* =============================================================================
   9 — view: certificates
   ============================================================================= */
function certStatus(c) {
  if (!c.expires) return { label: c.issued ? `Issued ${fmtDate(parseISO(c.issued), { month: 'short', year: 'numeric' })}` : 'No expiry', col: 'var(--ink2)', pct: 1 };
  const left = daysBetween(todayISO(), c.expires);
  const total = c.issued ? Math.max(1, daysBetween(c.issued, c.expires)) : 365;
  const pct = clamp(left / total, 0, 1);
  if (left < 0) return { label: `Expired ${Math.abs(left)}d ago`, col: 'var(--rose)', pct: 0 };
  if (left <= 60) return { label: `Renew in ${left}d`, col: 'var(--amber)', pct };
  return { label: `Valid ${left}d`, col: 'var(--mint)', pct };
}

function viewCertificates() {
  const certs = [...S.certs].sort((a, b) => (b.issued || '').localeCompare(a.issued || '') || b.added - a.added);
  const soon = certs.filter(c => c.expires && daysBetween(todayISO(), c.expires) <= 60);
  const C = 2 * Math.PI * 6;

  return `<div class="wrap">
    <div class="sec-h">
      <h2>Certificates</h2>
      <p>${certs.length} held${soon.length ? ` · ${soon.length} needing attention` : ''}</p>
      <span class="spacer"></span>
      <button class="btn btn-accent" data-act="new-cert">${icon('plus')}Add a certificate</button>
    </div>

    ${soon.length ? `<div class="focus" style="--pcol:var(--amber);margin-bottom:18px">
      <span class="big-check" style="pointer-events:none">${icon('warn')}</span>
      <div><span class="focus-k">Expiring</span>
        <h3>${esc(soon[0].title)}</h3>
        <p class="m">${esc(certStatus(soon[0]).label)}${soon.length > 1 ? ` · and ${soon.length - 1} other${soon.length > 2 ? 's' : ''}` : ''}</p></div>
      <button class="btn go" data-act="edit-cert" data-id="${soon[0].id}">${icon('pencil')}Update</button>
    </div>` : ''}

    ${certs.length ? `<div class="cert-grid">${certs.map(c => {
      const st = certStatus(c);
      const file = c.fileId ? S.files.find(f => f.id === c.fileId) : null;
      const isImg = file && String(file.type).startsWith('image/');
      return `<article class="cert" style="--sc:${st.col}">
        <div class="cert-top">
          <div class="cert-thumb" ${isImg ? `data-thumb="${file.id}"` : ''}>
            ${file ? `<span class="ph">${esc(EXT(file.name))}</span>` : icon('cert')}
          </div>
          <div class="cert-bd">
            <h3>${esc(c.title)}</h3>
            ${c.issuer ? `<span class="iss">${esc(c.issuer)}</span>` : ''}
            <span class="cert-st">
              <svg class="arc" viewBox="0 0 16 16"><circle class="bg" cx="8" cy="8" r="6"></circle>
                <circle class="fg" cx="8" cy="8" r="6" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - st.pct)).toFixed(1)}"></circle></svg>
              ${esc(st.label)}</span>
          </div>
        </div>
        ${c.credId ? `<p class="cert-id">ID ${esc(c.credId)}</p>` : ''}
        ${c.note ? `<p class="cert-note">${esc(c.note)}</p>` : ''}
        <div class="cert-acts">
          ${file ? `<button class="btn btn-sm" data-act="open-file" data-id="${file.id}">${icon('eye')}View</button>` : ''}
          ${c.url ? `<a class="btn btn-sm" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${icon('ext')}Verify</a>` : ''}
          <span class="spacer"></span>
          <button class="icon-btn" data-act="edit-cert" data-id="${c.id}" aria-label="Edit">${icon('pencil')}</button>
          <button class="icon-btn danger" data-act="del-cert" data-id="${c.id}" aria-label="Delete">${icon('trash')}</button>
        </div>
      </article>`;
    }).join('')}</div>`
    : `<p class="empty"><b>No certificates yet</b>Add the name, who issued it, the dates, and a scan or PDF of the thing itself.</p>`}
  </div>`;
}

/* =============================================================================
   10 — view: settings
   ============================================================================= */
function viewSettings() {
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  const used = S.files.reduce((n, f) => n + (f.size || 0), 0);

  return `<div class="wrap">
    <div class="sec-h"><h2>Settings</h2><p>Everything here is stored in this browser only</p></div>

    <div class="set-grid">
      <section class="panel">
        <div class="panel-h">${icon('home')}<h3>You</h3></div>
        <div class="set-row">
          <div class="bd"><b>Name on the home screen</b><span>Used for the greeting</span></div>
          <button class="btn btn-sm" data-act="edit-name">${esc(S.settings.name || 'Set a name')}</button>
        </div>
        <div class="set-row">
          <div class="bd"><b>Day starts at</b><span>Earliest hour the timetable draws</span></div>
          <select data-act="set-daystart">${[...Array(13)].map((_, h) => `<option value="${h}" ${S.settings.dayStart === h ? 'selected' : ''}>${pad(h)}:00</option>`).join('')}</select>
        </div>
        <div class="set-row">
          <div class="bd"><b>Day ends at</b><span>Latest hour the timetable draws</span></div>
          <select data-act="set-dayend">${[...Array(11)].map((_, i) => `<option value="${i + 14}" ${S.settings.dayEnd === i + 14 ? 'selected' : ''}>${pad(i + 14)}:00</option>`).join('')}</select>
        </div>
        <div class="set-row">
          <div class="bd"><b>Tasks with no time</b><span>When to treat an all-day task as due</span></div>
          <input type="time" data-act="set-allday" value="${esc(S.settings.allDay)}">
        </div>
      </section>

      <section class="panel">
        <div class="panel-h">${icon('bell')}<h3>Alerts</h3></div>
        <div class="set-row">
          <div class="bd"><b>Default warning</b><span>Overridden per entry on the Agenda tab</span></div>
          <select data-act="set-lead">${[-1, 0, 5, 10, 15, 30, 60, 120].map(v =>
            `<option value="${v}" ${S.settings.lead === v ? 'selected' : ''}>${v < 0 ? 'Off' : v === 0 ? 'On the dot' : `${v} min before`}</option>`).join('')}</select>
        </div>
        <div class="set-row">
          <div class="bd"><b>Sound</b><span>A short chime with each alert</span></div>
          <label class="switch"><input type="checkbox" data-act="toggle-sound" ${S.settings.sound ? 'checked' : ''}><span class="tr"></span></label>
        </div>
        <div class="set-row">
          <div class="bd"><b>Desktop notifications</b><span>${perm === 'granted' ? 'On' : perm === 'denied' ? 'Blocked in browser settings' : 'Off'}</span></div>
          ${perm === 'granted' ? `<button class="btn btn-sm" data-act="test-notify">Test</button>`
            : perm === 'denied' ? '' : `<button class="btn btn-sm" data-act="ask-notify">Turn on</button>`}
        </div>
        <p class="hint" style="margin-top:10px">Alerts only fire while this page is open in a tab.</p>
      </section>

      <section class="panel">
        <div class="panel-h">${icon('layers')}<h3>Subjects</h3><span class="spacer"></span>
          <button class="btn btn-sm" data-act="new-subject">${icon('plus')}Add</button></div>
        <div class="line-list">
          ${S.subjects.map(s => `<div class="line" style="--subject:${hue(s.id)}">
            <span class="bar"></span>
            <span class="nm"><b>${esc(s.code)}</b> · ${esc(s.name)}</span>
            <span style="display:flex;gap:1px">
              <button class="icon-btn" data-act="recolour" data-id="${s.id}" aria-label="Change colour" title="Change colour">${icon('mark')}</button>
              <button class="icon-btn" data-act="edit-subject" data-id="${s.id}" aria-label="Rename">${icon('pencil')}</button>
              ${S.subjects.length > 1 ? `<button class="icon-btn danger" data-act="del-subject" data-id="${s.id}" aria-label="Delete">${icon('trash')}</button>` : ''}
            </span>
          </div>`).join('')}
        </div>
      </section>

      <section class="panel">
        <div class="panel-h">${icon('down-tray')}<h3>Your copy of everything</h3></div>
        <p class="hint" style="margin-bottom:14px">Notes, timetable, tasks and certificates live in localStorage; uploaded files live in IndexedDB. Both are tied to this browser on this device. Export before clearing browser data or changing machines — the backup holds everything except the uploaded files themselves.</p>
        <div class="row">
          <button class="btn" data-act="export">${icon('down-tray')}Export a backup</button>
          <label class="btn">${icon('up-tray')}Restore a backup<input type="file" id="importer" accept="application/json" hidden></label>
        </div>
        <hr class="hr">
        <div class="set-row">
          <div class="bd"><b>Stored files</b><span>${S.files.length} file${S.files.length === 1 ? '' : 's'} · ${size(used)}</span></div>
          <button class="btn btn-sm" data-act="view" data-view="files">Manage</button>
        </div>
        <div class="set-row">
          <div class="bd"><b>Erase everything</b><span>Notes, timetable, tasks, files. No undo.</span></div>
          <button class="btn btn-sm btn-danger" data-act="wipe">${icon('trash')}Erase</button>
        </div>
      </section>
    </div>

    <p class="hint" style="margin-top:22px;text-align:center">Studyframe · keyboard: ⌘K search · N new note · 1–6 jump between sections</p>
  </div>`;
}

/* =============================================================================
   Chrome + render
   ============================================================================= */
const NAV = [
  { v: 'home', ic: 'home', label: 'Home' },
  { v: 'notes', ic: 'notes', label: 'Notes' },
  { v: 'timetable', ic: 'cal', label: 'Timetable' },
  { v: 'tasks', ic: 'task', label: 'Tasks' },
  { v: 'files', ic: 'files', label: 'Files' },
  { v: 'certificates', ic: 'cert', label: 'Certificates' },
];
const TABS = ['home', 'notes', 'timetable', 'tasks'];
const VIEWS = { home: viewHome, notes: viewNotes, timetable: viewTimetable, tasks: viewTasks, files: viewFiles, certificates: viewCertificates, settings: viewSettings };
const TITLES = { home: 'Home', notes: 'Notes', timetable: 'Timetable', tasks: 'Tasks', files: 'Files', certificates: 'Certificates', settings: 'Settings' };
const PRIMARY = {
  home: ['new-note', 'New note'], notes: ['new-note', 'New note'], timetable: ['new-entry', 'Add entry'],
  tasks: ['new-task', 'New task'], files: ['upload', 'Upload'], certificates: ['new-cert', 'Add certificate'],
  settings: ['export', 'Back up'],
};

const mq = window.matchMedia('(max-width: 760px)');
let MOBILE = mq.matches;

function renderChrome() {
  const late = openTasks().filter(t => urgency(t.date) === 'late').length;
  const dueToday = openTasks().filter(t => t.date <= todayISO()).length;

  $('#app').classList.toggle('rail-open', S.railOpen);
  $('.rail-expand')?.setAttribute('aria-expanded', String(S.railOpen));
  document.body.dataset.view = S.view;

  $('#railList').innerHTML = NAV.map(n => `<li><button class="rail-btn" data-act="view" data-view="${n.v}"
    aria-current="${n.v === S.view ? 'page' : 'false'}" title="${n.label}">
    ${icon(n.ic)}<span class="lbl">${n.label}</span>
    ${n.v === 'tasks' && dueToday ? `<span class="badge">${dueToday}</span>` : ''}</button></li>`).join('');

  $('#tabbar').innerHTML = TABS.map(v => {
    const n = NAV.find(x => x.v === v);
    return `<button class="tab" data-act="view" data-view="${v}" aria-current="${v === S.view ? 'page' : 'false'}">
      ${icon(n.ic)}<span>${n.label}</span>${v === 'tasks' && late ? '<span class="dot"></span>' : ''}</button>`;
  }).join('') + `<button class="tab" data-act="more" aria-current="${['files', 'certificates', 'settings'].includes(S.view) ? 'page' : 'false'}">
      ${icon('more')}<span>More</span></button>`;

  $('#crumb').innerHTML = TITLES[S.view] || 'Studyframe';

  const sel = $('#subjectSel');
  sel.innerHTML = S.subjects.map(s =>
    `<option value="${s.id}" ${s.id === S.activeSubject ? 'selected' : ''}>${esc(s.code)} — ${esc(s.name)}</option>`
  ).join('') + '<option value="__new">+ New subject…</option>';
  $('#subjectDot').style.background = hue(S.activeSubject);
  $('#subjectDot').style.boxShadow = `0 0 0 3px color-mix(in srgb, ${hue(S.activeSubject)} 22%, transparent)`;

  const [, label] = PRIMARY[S.view] || PRIMARY.home;
  $('#primaryLabel').textContent = label;
}

let lastView = null;
function render() {
  MOBILE = mq.matches;
  renderChrome();
  const main = $('#main');
  const changed = S.view !== lastView;
  lastView = S.view;
  main.classList.remove('enter');
  main.innerHTML = (VIEWS[S.view] || viewHome)();
  if (changed) main.scrollTop = 0;
  void main.offsetWidth;
  main.classList.add('enter');

  if (S.view === 'notes') wireEditor();
  if (S.view === 'files') { wireFiles(); wireThumbs(); }
  if (S.view === 'certificates') wireThumbs();
  if (S.view === 'settings') wireImporter();
  if (S.view === 'timetable') requestAnimationFrame(fitTimetable);
  uiTick();
}

/* =============================================================================
   11 — file store: upload, thumbnails, preview, download
   ============================================================================= */
async function addFiles(list) {
  const folderId = S.folderId && S.folderId !== '__unfiled' ? S.folderId : null;
  let added = 0;
  for (const f of list) {
    if (f.size > 120 * 1048576) { toast(`${f.name} is over 120 MB — too big for browser storage.`); continue; }
    const id = uid();
    try {
      await blobs.put(id, f);
      S.files.push({ id, folderId, subjectId: S.activeSubject, name: f.name, type: f.type || '', size: f.size, added: Date.now() });
      added++;
    } catch (err) { toast(`Could not store ${f.name}.`); }
  }
  if (added) {
    commit(() => {});
    toast(`${added} file${added > 1 ? 's' : ''} stored in ${folderId ? folderName(folderId) : 'Unfiled'}`);
  }
}

function wireFiles() {
  const drop = $('#drop'), picker = $('#picker');
  if (!drop || !picker) return;
  picker.onchange = () => { if (picker.files.length) addFiles([...picker.files]); };
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'dragend'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('over');
    if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]);
  });
}

let thumbURLs = [];
async function wireThumbs() {
  thumbURLs.forEach(u => URL.revokeObjectURL(u));
  thumbURLs = [];
  for (const el of $$('[data-thumb]')) {
    try {
      const blob = await blobs.get(el.dataset.thumb);
      if (!blob) continue;
      const u = URL.createObjectURL(blob);
      thumbURLs.push(u);
      const img = new Image();
      img.src = u; img.alt = '';
      img.onload = () => { el.innerHTML = ''; el.appendChild(img); };
    } catch (e) { /* leave the placeholder */ }
  }
}

let lbURL = null, lbFile = null;
async function openLightbox(id) {
  const f = S.files.find(x => x.id === id);
  if (!f) return;
  const box = $('#lightbox'), body = $('#lbBody');
  lbFile = f;
  $('#lbName').textContent = f.name;
  body.innerHTML = '<p class="hint">Opening…</p>';
  box.hidden = false;

  let blob;
  try { blob = await blobs.get(id); } catch (e) { /* handled below */ }
  if (!blob) { body.innerHTML = '<p class="empty"><b>The stored copy is missing</b>Upload this file again.</p>'; return; }
  if (lbURL) URL.revokeObjectURL(lbURL);
  lbURL = URL.createObjectURL(blob);

  if (String(f.type).startsWith('image/')) body.innerHTML = `<img src="${lbURL}" alt="${esc(f.name)}">`;
  else if (f.type === 'application/pdf') body.innerHTML = `<iframe src="${lbURL}" title="${esc(f.name)}"></iframe>`;
  else if (String(f.type).startsWith('text/')) body.innerHTML = `<pre>${esc((await blob.text()).slice(0, 200000))}</pre>`;
  else body.innerHTML = `<p class="empty"><b>${esc(EXT(f.name))} files do not open in a browser</b>Download it and open it in its own app.</p>`;
}
function closeLightbox() {
  $('#lightbox').hidden = true;
  $('#lbBody').innerHTML = '';
  if (lbURL) { URL.revokeObjectURL(lbURL); lbURL = null; }
  lbFile = null;
}
async function download(id) {
  const f = S.files.find(x => x.id === id);
  if (!f) return;
  let blob;
  try { blob = await blobs.get(id); } catch (e) { /* handled below */ }
  if (!blob) return toast('The stored copy is missing.');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = f.name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* =============================================================================
   12 — reminders
   ============================================================================= */
let audioCtx = null;
function beep() {
  if (!S.settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    [784, 1046.5].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const s = t0 + i * 0.16;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.13, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.32);
      o.connect(g).connect(audioCtx.destination);
      o.start(s); o.stop(s + 0.36);
    });
  } catch (e) { /* audio is optional */ }
}

function showReminderCard(o, lead) {
  const stack = $('#remStack');
  const el = document.createElement('div');
  el.className = 'rem-card';
  const kind = o.kind === 'task' ? 'Task due' : o.kind === 'class' ? 'Class' : 'Scheduled';
  el.innerHTML = `<span class="life"></span>
    <button class="x" aria-label="Dismiss">${icon('close')}</button>
    <div class="k">${kind} ${lead > 0 ? `in ${lead} min` : 'now'}</div>
    <div class="t">${esc(o.title)}</div>
    <div class="m">${esc(o.start)}${o.room ? ' · ' + esc(o.room) : ''}${o.subjectId ? ' · ' + esc(code(o.subjectId)) : ''}</div>`;
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 320); };
  el.querySelector('.x').addEventListener('click', kill);
  stack.appendChild(el);
  setTimeout(kill, 45000);
  while (stack.children.length > 3) stack.firstElementChild.remove();
}

function fireReminder(o, lead) {
  showReminderCard(o, lead);
  beep();
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification(o.title, {
        body: `${lead > 0 ? `Starts in ${lead} minutes` : 'Starting now'} · ${o.start}${o.room ? ' · ' + o.room : ''}`,
        tag: `sf-${o.id}-${o.when.getTime()}`,
      });
      n.onclick = () => { window.focus(); n.close(); };
    }
  } catch (e) { /* notifications are optional */ }
}

function remindTick() {
  const now = new Date();
  let dirty = false;
  for (const o of occurrences(now, 26)) {
    const lead = leadFor(o);
    if (lead < 0) continue;
    const fireAt = o.when.getTime() - lead * 60000;
    const k = `${o.id}|${o.when.getTime()}|${lead}`;
    if (now.getTime() >= fireAt && now.getTime() <= o.when.getTime() + 60000 && !S.fired[k]) {
      S.fired[k] = Date.now();
      dirty = true;
      fireReminder(o, Math.max(0, Math.round((o.when.getTime() - now.getTime()) / 60000)));
    }
  }
  const cutoff = Date.now() - 3 * 86400000;
  for (const k in S.fired) if (S.fired[k] < cutoff) { delete S.fired[k]; dirty = true; }
  if (dirty) save();
}

/** Clock, countdowns and moving markers — no re-render, so typing is safe. */
function uiTick() {
  const now = new Date();
  const clock = $('#clock');
  if (clock) clock.textContent = `${DAY[wdOf(now)]} ${pad(now.getDate())} ${fmtDate(now, { month: 'short' })}  ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const tc = $('#tapeClock');
  if (tc) tc.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  $$('[data-cd]').forEach(el => { el.textContent = relTime(Number(el.dataset.cd)); });
  $$('[data-cd-short]').forEach(el => { el.textContent = shortRel(Number(el.dataset.cdShort)); });

  const ring = $('[data-ring]');
  if (ring) {
    const remain = Number(ring.dataset.ring) - Date.now();
    const p = clamp(1 - remain / (120 * 60000), 0, 1);
    const C = 207.3;
    const fg = ring.querySelector('.fg');
    if (fg) fg.style.strokeDashoffset = (C * (1 - p)).toFixed(1);
  }

  const m = now.getHours() * 60 + now.getMinutes();
  const tn = $('#tapeNow');
  if (tn) {
    if (m >= TAPE.lo && m <= TAPE.hi) { tn.style.left = `${((m - TAPE.lo) / (TAPE.hi - TAPE.lo)) * 100}%`; tn.style.display = ''; }
    else tn.style.display = 'none';
  }
  const tl = $('#ttNow');
  if (tl) {
    if (m >= TT.lo && m <= TT.hi) { tl.style.top = `${((m - TT.lo) / (TT.hi - TT.lo)) * 100}%`; tl.style.display = ''; }
    else tl.style.display = 'none';
  }
}

/* =============================================================================
   13 — sheets, search, backup
   ============================================================================= */
function openSheet(html, onMount) {
  const m = $('#sheet');
  $('#sheetBox').innerHTML = html;
  m.hidden = false;
  if (onMount) onMount($('#sheetBox'));
  setTimeout(() => $('#sheetBox input:not([type=hidden]), #sheetBox select, #sheetBox textarea')?.focus(), 40);
}
function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheetBox').innerHTML = '';
}

const subjectOptions = sel => S.subjects.map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.code)} — ${esc(s.name)}</option>`).join('');
function remindOptions(v) {
  const opts = [['', 'Default'], ['-1', 'No reminder'], ['0', 'On the dot'], ['5', '5 min before'], ['10', '10 min before'], ['15', '15 min before'], ['30', '30 min before'], ['60', '1 hour before'], ['120', '2 hours before']];
  const cur = v === null || v === undefined ? '' : String(v);
  return opts.map(([val, lbl]) => `<option value="${val}" ${val === cur ? 'selected' : ''}>${lbl}</option>`).join('');
}

function entrySheet(e) {
  const isNew = !e.id, kind = e.kind || 'class';
  return `<h3>${isNew ? 'Add to the timetable' : 'Edit this entry'}</h3>
  <form data-form="save-entry" data-id="${e.id || ''}">
    <div class="field" style="margin-bottom:12px"><span>What is it</span>
      <input type="text" name="title" value="${esc(e.title || '')}" placeholder="Lecture, tutorial, shift, gym…" required autocomplete="off"></div>
    <div class="grid2" style="margin-bottom:12px">
      <div class="field"><span>Repeats</span>
        <select name="kind" id="kindSel">
          <option value="class" ${kind === 'class' ? 'selected' : ''}>Every week on this day</option>
          <option value="event" ${kind === 'event' ? 'selected' : ''}>Once, on one date</option>
        </select></div>
      <div class="field"><span>Subject</span><select name="subjectId">${subjectOptions(e.subjectId || S.activeSubject)}</select></div>
    </div>
    <div class="grid2" style="margin-bottom:12px">
      <div class="field" id="wdField"><span>Day</span>
        <select name="weekday">${DAY_FULL.map((d, i) => `<option value="${i}" ${Number(e.weekday) === i ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
      <div class="field" id="dateField"><span>Date</span><input type="date" name="date" value="${esc(e.date || todayISO())}"></div>
    </div>
    <div class="grid2" style="margin-bottom:12px">
      <div class="field"><span>Starts</span><input type="time" name="start" value="${esc(e.start || '09:00')}" required></div>
      <div class="field"><span>Ends</span><input type="time" name="end" value="${esc(e.end || '10:00')}" required></div>
    </div>
    <div class="grid2">
      <div class="field"><span>Where</span><input type="text" name="room" value="${esc(e.room || '')}" placeholder="Room, building, link" autocomplete="off"></div>
      <div class="field"><span>Remind me</span><select name="remind">${remindOptions(e.remind)}</select></div>
    </div>
    <div class="form-actions">
      ${isNew ? '' : `<button type="button" class="btn btn-danger" data-act="del-entry" data-id="${e.id}" data-kind="${kind}">${icon('trash')}Delete</button>`}
      <span class="spacer"></span>
      <button type="button" class="btn" data-act="close-sheet">Cancel</button>
      <button type="submit" class="btn btn-accent">${isNew ? 'Add it' : 'Save changes'}</button>
    </div>
  </form>`;
}
function mountEntrySheet(box) {
  const sel = box.querySelector('#kindSel');
  const sync = () => {
    box.querySelector('#wdField').style.display = sel.value === 'class' ? '' : 'none';
    box.querySelector('#dateField').style.display = sel.value === 'event' ? '' : 'none';
  };
  sel.addEventListener('change', sync);
  sync();
}

function taskSheet(t) {
  const isNew = !t.id;
  return `<h3>${isNew ? 'New task' : 'Edit task'}</h3>
  <form data-form="save-task" data-id="${t.id || ''}">
    <div class="field" style="margin-bottom:12px"><span>What needs doing</span>
      <input type="text" name="title" value="${esc(t.title || '')}" placeholder="Assignment, reading, submission…" required autocomplete="off"></div>
    <div class="field" style="margin-bottom:12px"><span>Priority</span>
      <div class="pgroup" role="group" style="width:max-content">
        ${PRIO.map(p => `<button type="button" data-act="sheet-prio" data-v="${p.v}" aria-pressed="${prio(t.priority).v === p.v}"
          title="${p.label}" aria-label="${p.label}" style="--pcol:${p.css}"><i></i></button>`).join('')}
      </div>
      <input type="hidden" name="priority" value="${prio(t.priority).v}">
      <span class="hint" id="prioLabel">${esc(prio(t.priority).label)}</span>
    </div>
    <div class="grid2" style="margin-bottom:12px">
      <div class="field"><span>Due date</span><input type="date" name="date" value="${esc(t.date || todayISO())}" required></div>
      <div class="field"><span>Due time</span><input type="time" name="time" value="${esc(t.time || '')}"></div>
    </div>
    <div class="grid2">
      <div class="field"><span>Subject</span><select name="subjectId">${subjectOptions(t.subjectId || S.activeSubject)}</select></div>
      <div class="field"><span>Remind me</span><select name="remind">${remindOptions(t.remind)}</select></div>
    </div>
    <div class="form-actions">
      ${isNew ? '' : `<button type="button" class="btn btn-danger" data-act="del-task" data-id="${t.id}">${icon('trash')}Delete</button>`}
      <span class="spacer"></span>
      <button type="button" class="btn" data-act="close-sheet">Cancel</button>
      <button type="submit" class="btn btn-accent">${isNew ? 'Add task' : 'Save changes'}</button>
    </div>
  </form>`;
}

function certSheet(c) {
  const isNew = !c.id;
  const file = c.fileId ? S.files.find(f => f.id === c.fileId) : null;
  return `<h3>${isNew ? 'Add a certificate' : 'Edit certificate'}</h3>
  <form data-form="save-cert" data-id="${c.id || ''}">
    <div class="field" style="margin-bottom:12px"><span>What it is called</span>
      <input type="text" name="title" value="${esc(c.title || '')}" placeholder="AWS Certified Cloud Practitioner" required autocomplete="off"></div>
    <div class="grid2" style="margin-bottom:12px">
      <div class="field"><span>Issued by</span><input type="text" name="issuer" value="${esc(c.issuer || '')}" placeholder="Amazon Web Services" autocomplete="off"></div>
      <div class="field"><span>Credential ID</span><input type="text" name="credId" value="${esc(c.credId || '')}" placeholder="Optional" autocomplete="off"></div>
    </div>
    <div class="grid2" style="margin-bottom:12px">
      <div class="field"><span>Issued on</span><input type="date" name="issued" value="${esc(c.issued || '')}"></div>
      <div class="field"><span>Expires on</span><input type="date" name="expires" value="${esc(c.expires || '')}"></div>
    </div>
    <div class="field" style="margin-bottom:12px"><span>Link that verifies it</span>
      <input type="url" name="url" value="${esc(c.url || '')}" placeholder="https://" autocomplete="off"></div>
    <div class="field" style="margin-bottom:12px"><span>Notes</span>
      <textarea name="note" rows="2" placeholder="What it covers, what it took, where you have used it">${esc(c.note || '')}</textarea></div>
    <div class="field"><span>Scan or PDF${file ? ` — holding ${esc(file.name)}; choose a file to replace it` : ''}</span>
      <input type="file" name="file" accept="application/pdf,image/*"></div>
    <div class="form-actions">
      ${isNew ? '' : `<button type="button" class="btn btn-danger" data-act="del-cert" data-id="${c.id}">${icon('trash')}Delete</button>`}
      <span class="spacer"></span>
      <button type="button" class="btn" data-act="close-sheet">Cancel</button>
      <button type="submit" class="btn btn-accent">${isNew ? 'Add it' : 'Save changes'}</button>
    </div>
  </form>`;
}

async function saveCert(f) {
  const fd = new FormData(f);
  const val = k => String(fd.get(k) ?? '').trim();
  const id = f.dataset.id;
  const existing = id ? S.certs.find(c => c.id === id) : null;
  const picked = f.querySelector('input[name=file]')?.files?.[0] || null;
  const cert = {
    id: id || uid(),
    title: val('title'), issuer: val('issuer'), credId: val('credId'),
    issued: val('issued'), expires: val('expires'), url: val('url'), note: val('note'),
    fileId: existing?.fileId || null,
    added: existing?.added || Date.now(),
  };
  closeSheet();

  if (picked) {
    let folder = S.folders.find(x => x.name === 'Certificates');
    if (!folder) { folder = { id: uid(), name: 'Certificates', created: Date.now() }; S.folders.push(folder); }
    const nid = uid();
    try {
      await blobs.put(nid, picked);
      S.files.push({ id: nid, folderId: folder.id, subjectId: S.activeSubject, name: picked.name, type: picked.type || '', size: picked.size, added: Date.now() });
      cert.fileId = nid;
    } catch (e) { toast('Could not store that scan; the details were still saved.'); }
  }
  commit(s => {
    if (id) s.certs = s.certs.map(c => (c.id === id ? cert : c));
    else s.certs.push(cert);
    s.view = 'certificates';
  });
  toast(id ? 'Certificate saved' : 'Certificate added');
}

const textSheet = ({ title, label, value = '', placeholder = '', form, id = '', submit = 'Save', type = 'text', extra = '' }) =>
  `<h3>${esc(title)}</h3>
  <form data-form="${form}" data-id="${id}">
    <div class="field"><span>${esc(label)}</span>
      <input type="${type}" name="value" value="${esc(value)}" placeholder="${esc(placeholder)}" required autocomplete="off"></div>
    ${extra}
    <div class="form-actions">
      <button type="button" class="btn" data-act="close-sheet">Cancel</button>
      <button type="submit" class="btn btn-accent">${esc(submit)}</button>
    </div>
  </form>`;

const subjectSheet = (s = {}) => `<h3>${s.id ? 'Edit subject' : 'New subject'}</h3>
  <form data-form="save-subject" data-id="${s.id || ''}">
    <div class="field" style="margin-bottom:12px"><span>Subject name</span>
      <input type="text" name="name" value="${esc(s.name || '')}" placeholder="Cognitive Psychology" required autocomplete="off"></div>
    <div class="field"><span>Short code</span>
      <input type="text" name="code" value="${esc(s.code || '')}" placeholder="PSY 210" maxlength="12" autocomplete="off"></div>
    <div class="form-actions">
      <button type="button" class="btn" data-act="close-sheet">Cancel</button>
      <button type="submit" class="btn btn-accent">${s.id ? 'Save changes' : 'Create subject'}</button>
    </div>
  </form>`;

const hueSheet = s => `<h3>Colour for ${esc(s.code)}</h3>
  <p class="hint" style="margin-bottom:14px">This colour marks the subject across the timetable, notes and home.</p>
  <div class="row">
    ${[232, 200, 168, 140, 96, 56, 38, 18, 350, 320, 286, 262].map(h =>
      `<button type="button" class="icon-btn" data-act="set-hue" data-id="${s.id}" data-h="${h}" aria-label="Hue ${h}"
        style="background:hsl(${h} 62% 66%);width:38px;height:38px;border-radius:50%;${s.hue === h ? 'outline:2px solid var(--ink);outline-offset:2px' : ''}"></button>`).join('')}
  </div>
  <div class="form-actions"><span class="spacer"></span><button type="button" class="btn" data-act="close-sheet">Done</button></div>`;

function linkSheet() {
  saveRange();
  openSheet(textSheet({
    title: 'Add a link', label: 'Address', placeholder: 'https://', form: 'add-link', submit: 'Link it', type: 'url',
  }));
}

const moreSheet = () => `<h3>More</h3>
  <div class="line-list">
    <button class="line" data-act="view" data-view="files">${icon('files')}<span class="nm">Files</span><span class="rt">${S.files.length}</span></button>
    <button class="line" data-act="view" data-view="certificates">${icon('cert')}<span class="nm">Certificates</span><span class="rt">${S.certs.length}</span></button>
    <button class="line" data-act="palette">${icon('search')}<span class="nm">Search everything</span></button>
    <button class="line" data-act="view" data-view="settings">${icon('settings')}<span class="nm">Settings</span></button>
  </div>
  <div class="form-actions"><span class="spacer"></span><button type="button" class="btn" data-act="close-sheet">Close</button></div>`;

/* ---------- search ---------- */
let paletteIndex = -1;
function openPalette(on) {
  const p = $('#palette');
  p.hidden = !on;
  paletteIndex = -1;
  if (on) { $('#paletteInput').value = ''; $('#paletteResults').innerHTML = ''; setTimeout(() => $('#paletteInput').focus(), 30); }
}
function runSearch() {
  paletteIndex = -1;
  const q = $('#paletteInput').value.trim().toLowerCase();
  const all = $('input[name=scope]:checked').value === 'all';
  const box = $('#paletteResults');
  if (!q) { box.innerHTML = ''; return; }
  const inScope = x => all || x.subjectId === S.activeSubject;
  const hits = [
    ...S.notes.filter(n => inScope(n) && `${n.title} ${noteText(n)}`.toLowerCase().includes(q))
      .map(n => ({ kind: 'note', id: n.id, label: n.title || 'Untitled', sub: code(n.subjectId) })),
    ...S.tasks.filter(t => inScope(t) && t.title.toLowerCase().includes(q))
      .map(t => ({ kind: 'task', id: t.id, label: t.title, sub: `${code(t.subjectId)} · ${whenLabel(t)}` })),
    ...[...S.classes, ...S.events].filter(e => `${e.title} ${e.room || ''}`.toLowerCase().includes(q))
      .map(e => ({ kind: 'entry', id: e.id, label: e.title, sub: e.weekday !== undefined ? DAY_FULL[e.weekday] : e.date })),
    ...S.files.filter(f => f.name.toLowerCase().includes(q))
      .map(f => ({ kind: 'file', id: f.id, label: f.name, sub: folderName(f.folderId) })),
    ...S.certs.filter(c => `${c.title} ${c.issuer || ''} ${c.note || ''}`.toLowerCase().includes(q))
      .map(c => ({ kind: 'cert', id: c.id, label: c.title, sub: c.issuer || '' })),
  ].slice(0, 40);

  box.innerHTML = hits.length
    ? hits.map(h => `<li><button data-act="go" data-kind="${h.kind}" data-id="${h.id}">
        <span class="k">${h.kind}</span><span class="lb">${esc(h.label)}</span><span class="meta">${esc(h.sub || '')}</span></button></li>`).join('')
    : '<li><p class="hint" style="padding:14px">Nothing matches that.</p></li>';
}
function highlightPalette() {
  const results = $$('#paletteResults button');
  results.forEach((b, i) => b.classList.toggle('active', i === paletteIndex));
  results[paletteIndex]?.scrollIntoView({ block: 'nearest' });
}

/* ---------- backup ---------- */
function exportBackup() {
  const copy = JSON.parse(JSON.stringify(S));
  delete copy.fired;
  const blob = new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `studyframe-backup-${todayISO()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Backup downloaded');
}
function wireImporter() {
  const inp = $('#importer');
  if (!inp) return;
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.subjects)) throw new Error('not a Studyframe backup');
      if (!confirm('Restoring replaces the notes, timetable and tasks in this browser. Continue?')) return;
      data.fired = {};
      S = upgrade(data);
      S.notes.forEach(n => { n.html = cleanHTML(n.html); });
      save();
      render();
      toast('Backup restored');
    } catch (err) { toast('That file is not a Studyframe backup.'); }
  };
}

/* =============================================================================
   14 — actions and events
   ============================================================================= */
const actions = {
  rail: () => commit(s => { s.railOpen = !s.railOpen; }),
  view: (_, el) => { closeSheet(); commit(s => { s.view = el.dataset.view; }); },
  palette: () => { closeSheet(); openPalette(true); },
  'close-palette': () => openPalette(false),
  'close-sheet': () => closeSheet(),
  'close-lightbox': () => closeLightbox(),
  'lb-download': () => lbFile && download(lbFile.id),
  more: () => openSheet(moreSheet()),

  primary: () => {
    const [act] = PRIMARY[S.view] || PRIMARY.home;
    if (act === 'upload') { const p = $('#picker'); if (p) return p.click(); return commit(s => { s.view = 'files'; }); }
    actions[act]?.(null, { dataset: { date: S.ttDate } });
  },

  /* notes ------------------------------------------------------------------ */
  'new-note': () => {
    commit(s => {
      const n = { id: uid(), subjectId: s.activeSubject, title: '', html: '', files: [], updated: Date.now(), created: Date.now() };
      s.notes.push(n); s.noteId = n.id; s.view = 'notes';
    });
    setTimeout(() => $('#noteTitle')?.focus(), 60);
  },
  'open-note': (_, el) => {
    const n = S.notes.find(x => x.id === el.dataset.id);
    commit(s => { if (n) s.activeSubject = n.subjectId; s.noteId = el.dataset.id; s.view = 'notes'; });
  },
  'del-note': (_, el) => {
    if (!confirm('Delete this note? It cannot be recovered.')) return;
    commit(s => { s.notes = s.notes.filter(n => n.id !== el.dataset.id); s.noteId = null; });
    toast('Note deleted');
  },
  unattach: (_, el) => commit(s => {
    const n = s.notes.find(x => x.id === s.noteId);
    if (n) n.files = n.files.filter(x => x !== el.dataset.id);
  }),

  /* tasks ------------------------------------------------------------------ */
  'new-task': () => openSheet(taskSheet({ date: todayISO(), priority: S.newPrio ?? 1 })),
  'edit-task': (_, el) => {
    const t = S.tasks.find(x => x.id === el.dataset.id);
    if (t) openSheet(taskSheet(t));
  },
  toggle: (_, el) => {
    commit(s => {
      const t = s.tasks.find(x => x.id === el.dataset.id);
      if (!t) return;
      t.done = !t.done;
      t.doneAt = t.done ? Date.now() : null;
    });
  },
  'del-task': (_, el) => {
    commit(s => { s.tasks = s.tasks.filter(t => t.id !== el.dataset.id); });
    closeSheet();
    toast('Task deleted');
  },
  'clear-done': () => {
    if (!confirm('Remove every finished task?')) return;
    commit(s => { s.tasks = s.tasks.filter(t => !t.done); });
    toast('Finished tasks cleared');
  },
  'bump-prio': (_, el) => {
    let label = '';
    commit(s => {
      const t = s.tasks.find(x => x.id === el.dataset.id);
      if (!t) return;
      t.priority = (prio(t.priority).v + 1) % 4;
      label = prio(t.priority).label;
    });
    toast(`Priority: ${label}`);
  },
  'toggle-steps': (_, el) => {
    const id = el.dataset.id;
    EXPANDED.has(id) ? EXPANDED.delete(id) : EXPANDED.add(id);
    render();
  },
  'toggle-step': (_, el) => commit(s => {
    const t = s.tasks.find(x => x.id === el.dataset.id);
    const st = t?.steps.find(x => x.id === el.dataset.sid);
    if (st) st.done = !st.done;
  }),
  'del-step': (_, el) => commit(s => {
    const t = s.tasks.find(x => x.id === el.dataset.id);
    if (t) t.steps = t.steps.filter(x => x.id !== el.dataset.sid);
  }),
  'task-view': (_, el) => commit(s => { s.taskView = el.dataset.v; }),
  'task-scope': () => commit(s => { s.taskScope = s.taskScope === 'subject' ? 'all' : 'subject'; }),
  'show-done': () => commit(s => { s.taskShowDone = !s.taskShowDone; }),
  /* picking a priority must not wipe what is half-typed in the form */
  'pick-prio': (_, el) => {
    S.newPrio = Number(el.dataset.v);
    const form = el.closest('form');
    $$('[data-act="pick-prio"]', form).forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === S.newPrio)));
    form.querySelector('input[name=priority]').value = S.newPrio;
    persist();
  },
  'sheet-prio': (_, el) => {
    const form = el.closest('form');
    const v = Number(el.dataset.v);
    $$('[data-act="sheet-prio"]', form).forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === v)));
    form.querySelector('input[name=priority]').value = v;
    const lbl = form.querySelector('#prioLabel');
    if (lbl) lbl.textContent = prio(v).label;
  },

  /* timetable -------------------------------------------------------------- */
  mode: (_, el) => commit(s => { s.ttMode = el.dataset.mode; }),
  density: (_, el) => commit(s => { s.ttDensity = el.dataset.d; }),
  shift: (_, el) => commit(s => { s.ttDate = iso(addDays(parseISO(s.ttDate), Number(el.dataset.n))); }),
  today: () => commit(s => { s.ttDate = todayISO(); }),
  'goto-day': (_, el) => commit(s => { s.ttMode = 'day'; s.ttDate = el.dataset.date; s.view = 'timetable'; }),

  'new-entry': (e, el) => {
    const date = el.dataset.date || S.ttDate || todayISO();
    const wd = el.dataset.wd !== undefined ? Number(el.dataset.wd) : wdOf(parseISO(date));
    let start = '09:00';
    if (el.classList?.contains('tt-col') && e) {
      const r = el.getBoundingClientRect();
      const mins = TT.lo + ((e.clientY - r.top) / r.height) * (TT.hi - TT.lo);
      start = fromMin(clamp(Math.round(mins / 15) * 15, TT.lo, TT.hi - 30));
    }
    openSheet(entrySheet({ kind: 'class', weekday: wd, date, start, end: fromMin(toMin(start) + 60), subjectId: S.activeSubject, remind: null }), mountEntrySheet);
  },
  'edit-entry': (_, el) => {
    const { id, kind } = el.dataset;
    const entry = (kind === 'class' ? S.classes : S.events).find(x => x.id === id);
    if (entry) openSheet(entrySheet({ ...entry, kind }), mountEntrySheet);
  },
  'del-entry': (_, el) => {
    const { id, kind } = el.dataset;
    if (!confirm('Delete this timetable entry?')) return;
    commit(s => {
      if (kind === 'class') s.classes = s.classes.filter(x => x.id !== id);
      else s.events = s.events.filter(x => x.id !== id);
    });
    closeSheet();
    toast('Entry deleted');
  },

  /* files ------------------------------------------------------------------ */
  'file-view': (_, el) => commit(s => { s.fileView = el.dataset.v; }),
  'new-folder': () => openSheet(textSheet({ title: 'New folder', label: 'Folder name', placeholder: 'Week 1–6 slides', form: 'new-folder', submit: 'Create folder' })),
  'open-folder': (_, el) => commit(s => { s.folderId = el.dataset.id ? el.dataset.id : null; }),
  'rename-folder': (_, el) => {
    const f = S.folders.find(x => x.id === el.dataset.id);
    if (f) openSheet(textSheet({ title: 'Rename folder', label: 'Folder name', value: f.name, form: 'rename-folder', id: f.id }));
  },
  'del-folder': (_, el) => {
    const id = el.dataset.id;
    const n = S.files.filter(f => f.folderId === id).length;
    if (!confirm(n ? `Delete this folder? Its ${n} file${n > 1 ? 's' : ''} move to Unfiled — nothing is lost.` : 'Delete this folder?')) return;
    commit(s => {
      s.folders = s.folders.filter(f => f.id !== id);
      s.files.forEach(f => { if (f.folderId === id) f.folderId = null; });
      s.folderId = null;
    });
    toast('Folder deleted');
  },
  'rename-file': (_, el) => {
    const f = S.files.find(x => x.id === el.dataset.id);
    if (f) openSheet(textSheet({ title: 'Rename file', label: 'File name', value: f.name, form: 'rename-file', id: f.id }));
  },
  'open-file': (_, el) => openLightbox(el.dataset.id),
  'dl-file': (_, el) => download(el.dataset.id),
  'del-file': async (_, el) => {
    const id = el.dataset.id;
    if (!confirm('Delete this file? It is also removed from any note it is attached to.')) return;
    try { await blobs.del(id); } catch (e) { /* the record goes either way */ }
    commit(s => {
      s.files = s.files.filter(f => f.id !== id);
      s.notes.forEach(n => { n.files = n.files.filter(x => x !== id); });
      s.certs.forEach(c => { if (c.fileId === id) c.fileId = null; });
      if (s.fileId === id) s.fileId = null;
    });
    toast('File deleted');
  },

  /* certificates ----------------------------------------------------------- */
  'new-cert': () => openSheet(certSheet({})),
  'edit-cert': (_, el) => {
    const c = S.certs.find(x => x.id === el.dataset.id);
    if (c) openSheet(certSheet(c));
  },
  'del-cert': (_, el) => {
    const c = S.certs.find(x => x.id === el.dataset.id);
    if (!c) return;
    if (!confirm(c.fileId ? 'Delete this certificate? The uploaded scan stays in Files.' : 'Delete this certificate?')) return;
    commit(s => { s.certs = s.certs.filter(x => x.id !== el.dataset.id); });
    closeSheet();
    toast('Certificate deleted');
  },

  /* subjects + settings ---------------------------------------------------- */
  'new-subject': () => openSheet(subjectSheet()),
  'edit-subject': (_, el) => {
    const s = subj(el.dataset.id);
    if (s) openSheet(subjectSheet(s));
  },
  recolour: (_, el) => {
    const s = subj(el.dataset.id);
    if (s) openSheet(hueSheet(s));
  },
  'set-hue': (_, el) => {
    commit(st => { const s = st.subjects.find(x => x.id === el.dataset.id); if (s) s.hue = Number(el.dataset.h); });
    closeSheet();
  },
  'del-subject': (_, el) => {
    const id = el.dataset.id;
    if (S.subjects.length < 2) return toast('Keep at least one subject.');
    const n = S.notes.filter(x => x.subjectId === id).length + S.tasks.filter(x => x.subjectId === id).length + S.classes.filter(x => x.subjectId === id).length;
    if (!confirm(n ? `Delete this subject? Its ${n} item${n > 1 ? 's move' : ' moves'} to ${S.subjects.find(s => s.id !== id).name}.` : 'Delete this subject?')) return;
    commit(s => {
      const fallback = s.subjects.find(x => x.id !== id).id;
      [s.notes, s.tasks, s.classes, s.events, s.files].forEach(list => list.forEach(x => { if (x.subjectId === id) x.subjectId = fallback; }));
      s.subjects = s.subjects.filter(x => x.id !== id);
      if (s.activeSubject === id) s.activeSubject = fallback;
    });
    toast('Subject deleted');
  },
  'edit-name': () => openSheet(textSheet({ title: 'What should the home screen call you?', label: 'Your name', value: S.settings.name === 'there' ? '' : S.settings.name, form: 'set-name', placeholder: 'Your name' })),
  'ask-notify': async () => {
    if (typeof Notification === 'undefined') return toast('This browser has no notification support.');
    const p = await Notification.requestPermission();
    render();
    toast(p === 'granted' ? 'Desktop notifications on' : 'Notifications were not allowed');
  },
  'test-notify': () => fireReminder({
    id: 'test', title: 'Test reminder', start: `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`,
    room: '', subjectId: S.activeSubject, when: new Date(), kind: 'class',
  }, 0),
  export: () => exportBackup(),
  wipe: () => {
    if (!confirm('Erase all notes, timetable entries, tasks and stored files from this browser?')) return;
    if (!confirm('Last check — this cannot be undone. Erase everything?')) return;
    Promise.all(S.files.map(f => blobs.del(f.id).catch(() => {}))).then(() => {
      [KEY, ...OLD_KEYS].forEach(k => localStorage.removeItem(k));
      S = seed();
      save();
      render();
      toast('Everything erased');
    });
  },

  /* search ----------------------------------------------------------------- */
  go: (_, el) => {
    const { kind, id } = el.dataset;
    openPalette(false);
    if (kind === 'file') return openLightbox(id);
    commit(s => {
      if (kind === 'note') {
        const n = s.notes.find(x => x.id === id);
        if (n) { s.activeSubject = n.subjectId; s.noteId = id; s.view = 'notes'; }
      } else if (kind === 'task') {
        const t = s.tasks.find(x => x.id === id);
        if (t) { s.view = 'tasks'; s.taskScope = 'all'; }
      } else if (kind === 'entry') {
        const e = s.events.find(x => x.id === id);
        s.view = 'timetable';
        if (e) { s.ttMode = 'day'; s.ttDate = e.date; } else s.ttMode = 'week';
      } else if (kind === 'cert') {
        s.view = 'certificates';
      }
    });
  },
};

/* ---------- clicks ---------- */
document.addEventListener('click', e => {
  if (e.target === $('#palette')) return openPalette(false);
  if (e.target === $('#sheet')) return closeSheet();
  if (e.target === $('#lightbox')) return closeLightbox();
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (['INPUT', 'SELECT', 'TEXTAREA', 'FORM', 'OPTION'].includes(el.tagName)) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  e.stopPropagation();
  fn(e, el);
});

/* ---------- forms ---------- */
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const fd = new FormData(f);
  const val = k => String(fd.get(k) ?? '').trim();

  switch (f.dataset.form) {
    case 'add-task': {
      const title = val('title');
      if (!title) return;
      commit(s => {
        s.tasks.push({
          id: uid(), subjectId: s.activeSubject, title,
          date: val('date') || f.dataset.date || todayISO(),
          time: val('time'), done: false, order: s.tasks.length, remind: null,
          priority: Number(val('priority') || s.newPrio || 1), steps: [], created: Date.now(),
        });
      });
      toast('Task added');
      setTimeout(() => $(`form[data-form="add-task"] input[name=title]`)?.focus(), 40);
      break;
    }
    case 'save-task': {
      const id = f.dataset.id;
      commit(s => {
        const base = {
          title: val('title'), date: val('date') || todayISO(), time: val('time'),
          subjectId: val('subjectId'), priority: Number(val('priority') || 1),
          remind: val('remind') === '' ? null : Number(val('remind')),
        };
        if (id) {
          const t = s.tasks.find(x => x.id === id);
          if (t) Object.assign(t, base);
        } else {
          s.tasks.push({ id: uid(), done: false, order: s.tasks.length, steps: [], created: Date.now(), ...base });
          s.view = 'tasks';
        }
      });
      closeSheet();
      toast(id ? 'Task saved' : 'Task added');
      break;
    }
    case 'add-step': {
      const text = val('text');
      if (!text) return;
      const id = f.dataset.id;
      commit(s => {
        const t = s.tasks.find(x => x.id === id);
        if (t) t.steps.push({ id: uid(), text, done: false });
      });
      setTimeout(() => $(`form[data-form="add-step"][data-id="${id}"] input`)?.focus(), 40);
      break;
    }
    case 'save-entry': {
      const id = f.dataset.id, kind = val('kind');
      const entry = {
        id: id || uid(), subjectId: val('subjectId'), title: val('title'),
        start: val('start') || '09:00', end: val('end') || '10:00', room: val('room'),
        remind: val('remind') === '' ? null : Number(val('remind')),
      };
      if (toMin(entry.end) <= toMin(entry.start)) entry.end = fromMin(toMin(entry.start) + 30);
      if (kind === 'class') entry.weekday = Number(val('weekday'));
      else entry.date = val('date') || todayISO();

      commit(s => {
        if (id) { s.classes = s.classes.filter(x => x.id !== id); s.events = s.events.filter(x => x.id !== id); }
        if (kind === 'class') s.classes.push(entry); else s.events.push(entry);
        if (!id) { s.view = 'timetable'; if (kind === 'event') s.ttDate = entry.date; }
      });
      closeSheet();
      toast(id ? 'Entry saved' : 'Added to your timetable');
      break;
    }
    case 'save-subject': {
      const name = val('name');
      if (!name) return;
      const c = val('code') || name.slice(0, 6).toUpperCase();
      const id = f.dataset.id;
      commit(s => {
        if (id) {
          const x = s.subjects.find(y => y.id === id);
          if (x) { x.name = name; x.code = c; }
        } else {
          const nid = uid();
          s.subjects.push({ id: nid, name, code: c, hue: [232, 168, 38, 286, 200, 96, 350][s.subjects.length % 7] });
          s.activeSubject = nid; s.noteId = null;
        }
      });
      closeSheet();
      toast(id ? 'Subject saved' : 'Subject created');
      break;
    }
    case 'new-folder': {
      const name = val('value');
      if (!name) return;
      commit(s => { const id = uid(); s.folders.push({ id, name, created: Date.now() }); s.folderId = id; s.view = 'files'; });
      closeSheet();
      toast('Folder created');
      break;
    }
    case 'rename-folder': {
      commit(s => { const x = s.folders.find(y => y.id === f.dataset.id); if (x) x.name = val('value'); });
      closeSheet();
      break;
    }
    case 'rename-file': {
      commit(s => { const x = s.files.find(y => y.id === f.dataset.id); if (x) x.name = val('value'); });
      closeSheet();
      break;
    }
    case 'save-cert': saveCert(f); break;
    case 'set-name': {
      commit(s => { s.settings.name = val('value') || 'there'; });
      closeSheet();
      break;
    }
    case 'add-link': {
      const url = val('value');
      closeSheet();
      if (!url) return;
      setTimeout(() => { if (restoreRange()) { exec('createLink', url); afterEdit(); } }, 30);
      break;
    }
  }
});

/* ---------- typing ---------- */
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'paletteInput') return runSearch();
  const act = el.dataset?.act;
  if (act === 'note-title') {
    commit(s => {
      const n = s.notes.find(x => x.id === s.noteId);
      if (n) { n.title = el.value; n.updated = Date.now(); }
    }, { quiet: true });
  } else if (act === 'rename') {
    commit(s => { const t = s.tasks.find(x => x.id === el.dataset.id); if (t) t.title = el.value; }, { quiet: true });
  }
});

/* ---------- selects, switches ---------- */
document.addEventListener('change', e => {
  const el = e.target;
  if (el.name === 'scope') return runSearch();
  const act = el.dataset?.act;
  if (!act) return;

  if (act === 'subject') {
    if (el.value === '__new') { el.value = S.activeSubject; return openSheet(subjectSheet()); }
    return commit(s => { s.activeSubject = el.value; s.noteId = null; });
  }
  if (act === 'attach' && el.value) {
    const fid = el.value;
    return commit(s => {
      const n = s.notes.find(x => x.id === s.noteId);
      if (n && !n.files.includes(fid)) n.files.push(fid);
    });
  }
  if (act === 'move-file') return commit(s => { const f = s.files.find(x => x.id === el.dataset.id); if (f) f.folderId = el.value || null; });
  if (act === 'set-remind') {
    const { id, kind } = el.dataset;
    const v = el.value === '' ? null : Number(el.value);
    return commit(s => {
      const list = kind === 'class' ? s.classes : kind === 'event' ? s.events : s.tasks;
      const x = list.find(y => y.id === id);
      if (x) x.remind = v;
    }, { quiet: true });
  }
  if (act === 'set-lead') return commit(s => { s.settings.lead = Number(el.value); });
  if (act === 'toggle-sound') return commit(s => { s.settings.sound = el.checked; }, { quiet: true });
  if (act === 'set-allday') return commit(s => { s.settings.allDay = el.value || '09:00'; }, { quiet: true });
  if (act === 'set-daystart') return commit(s => { s.settings.dayStart = Math.min(Number(el.value), s.settings.dayEnd - 2); });
  if (act === 'set-dayend') return commit(s => { s.settings.dayEnd = Math.max(Number(el.value), s.settings.dayStart + 2); });
});

/* ---------- drag tasks between priority lanes ---------- */
let dragId = null;
document.addEventListener('dragstart', e => {
  const card = e.target.closest('.task[draggable="true"]');
  if (!card) return;
  dragId = card.dataset.id;
  e.dataTransfer.setData('text/plain', dragId);
  e.dataTransfer.effectAllowed = 'move';
  requestAnimationFrame(() => card.classList.add('dragging'));
});
document.addEventListener('dragend', () => {
  dragId = null;
  $$('.task.dragging').forEach(c => c.classList.remove('dragging'));
  $$('.lane.drop-on').forEach(l => l.classList.remove('drop-on'));
});
document.addEventListener('dragover', e => {
  const lane = e.target.closest('.lane[data-lane]');
  if (!lane || !dragId) return;
  e.preventDefault();
  $$('.lane.drop-on').forEach(l => { if (l !== lane) l.classList.remove('drop-on'); });
  lane.classList.add('drop-on');
});
document.addEventListener('drop', e => {
  const lane = e.target.closest('.lane[data-lane]');
  const id = dragId || e.dataTransfer.getData('text/plain');
  if (!lane || !id) return;
  e.preventDefault();
  const target = e.target.closest('.task');
  commit(s => {
    const t = s.tasks.find(x => x.id === id);
    if (!t) return;
    t.priority = Number(lane.dataset.lane);
    if (target && target.dataset.id !== id) {
      const other = s.tasks.find(x => x.id === target.dataset.id);
      if (other) { t.order = other.order - 0.5; s.tasks.sort((a, b) => a.order - b.order).forEach((x, i) => { x.order = i; }); }
    }
  });
});

/* ---------- keyboard ---------- */
document.addEventListener('keydown', e => {
  if (!$('#palette').hidden) {
    const results = $$('#paletteResults button');
    if (e.key === 'ArrowDown' && results.length) { e.preventDefault(); paletteIndex = (paletteIndex + 1) % results.length; return highlightPalette(); }
    if (e.key === 'ArrowUp' && results.length) { e.preventDefault(); paletteIndex = (paletteIndex - 1 + results.length) % results.length; return highlightPalette(); }
    if (e.key === 'Enter' && paletteIndex >= 0 && results[paletteIndex]) { e.preventDefault(); return results[paletteIndex].click(); }
    if (e.key === 'Escape') return openPalette(false);
  }
  if (e.key === 'Escape') {
    if (!$('#lightbox').hidden) return closeLightbox();
    if (!$('#sheet').hidden) return closeSheet();
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !$('#paperBody')?.contains(document.activeElement)) {
    e.preventDefault(); return openPalette(true);
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return toast('Saved — it autosaves anyway'); }

  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.toLowerCase() === 'n') { e.preventDefault(); return actions['new-note'](); }
  const n = Number(e.key);
  if (n >= 1 && n <= NAV.length) commit(s => { s.view = NAV[n - 1].v; });
});

/* =============================================================================
   15 — boot
   ============================================================================= */
// If anything above threw, the markup fallback in <main> is still on screen and
// this surfaces the actual reason rather than leaving a blank page.
addEventListener('error', e => {
  const box = document.querySelector('.boot-fallback');
  if (!box) return;
  const p = document.createElement('p');
  p.style.cssText = 'color:#E8635C;margin-top:12px';
  p.textContent = e.message || 'Script error';
  box.appendChild(p);
});

addEventListener('beforeunload', save);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { uiTick(); remindTick(); } });
addEventListener('resize', debounce(() => { if (S.view === 'timetable') fitTimetable(); }, 140));
mq.addEventListener('change', () => render());

render();
remindTick();
setInterval(uiTick, 1000);
setInterval(remindTick, 15000);
