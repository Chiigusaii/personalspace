/* =============================================================================
   Studyframe — app.js
   Notes, timetable, tasks, files and certificates. Everything stays in this
   browser (state in localStorage, uploaded files in IndexedDB) and, if you
   connect it, is mirrored to a private GitHub repository of your own so every
   device sees the same data. No build step, no server, no dependencies.

   Sections
     1  helpers            6  view: timetable      11 file store
     2  state + migration  7  view: tasks          12 reminders
     3  markup safety      8  view: files          13 sheets + search
     4  view: home         9  view: certificates   14 actions + events
     5  view: notes       10  view: settings       15 cloud sync
                                                   16 boot
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
dbp.catch(() => { /* private window: blobs fall back to memory below */ });
const MEMBLOBS = new Map();
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
  async put(id, blob) {
    MEMBLOBS.set(id, blob);
    try { await blobs.run('readwrite', s => s.put(blob, id)); } catch (e) { /* kept in memory for this session */ }
  },
  async get(id) {
    try { const b = await blobs.run('readonly', s => s.get(id)); if (b) return b; } catch (e) { /* fall through */ }
    return MEMBLOBS.get(id) || null;
  },
  async del(id) {
    MEMBLOBS.delete(id);
    try { await blobs.run('readwrite', s => s.delete(id)); } catch (e) { /* nothing stored */ }
  },
};

const KEY = 'studyframe.v3';
const OLD_KEYS = ['studyframe.v2', 'studyframe.v1'];

/* The collections that are the same on every device. Everything else in S
   (which view is open, which week the timetable shows…) stays per device. */
const SYNCED = ['subjects', 'notes', 'classes', 'events', 'tasks', 'folders', 'files', 'certs'];

/* Seed records have fixed ids and a sync time of 0, so two devices that both
   start from the example workspace merge into one copy instead of two. */
function seed() {
  const a = 'seed-psy', b = 'seed-math', c = 'seed-law';
  const t = new Date();
  return {
    v: 4,
    view: 'home', railOpen: false,
    activeSubject: a, noteId: null, fileId: null, folderId: null,
    ttMode: 'week', ttDate: todayISO(),
    taskView: 'board', taskShowDone: false, fileView: 'icons', fileSort: { key: 'name', dir: 1 },
    settings: { name: 'there', lead: 15, sound: true, allDay: '09:00', dayStart: 8, dayEnd: 21 },
    settingsAt: 0,
    subjects: [
      { id: a, name: 'Cognitive Psychology', code: 'PSY 210', hue: 232, _t: 0 },
      { id: b, name: 'Linear Algebra', code: 'MATH 152', hue: 168, _t: 0 },
      { id: c, name: 'Media Law', code: 'LAW 118', hue: 38, _t: 0 },
    ],
    notes: [{
      id: 'seed-note-1', subjectId: a, title: 'Week 3 — Working memory',
      html: '<p>This notebook behaves like a real one. Select any text and use the bar above to set it in <strong>bold</strong>, <em>italic</em>, <u>underline</u> or <mark>highlight</mark>.</p><p></p><h2>What the toolbar gives you</h2><ul><li>Headings, bullet and numbered lists</li><li>Quotes, inline code and links</li><li>Undo, redo, and a button that strips formatting back to plain text</li></ul><p></p><blockquote>Keep writing past the bottom of a page and the book turns to the next one by itself.</blockquote>',
      files: [], updated: Date.now(), created: Date.now(), _t: 0,
    }],
    classes: [
      { id: 'seed-cls-1', subjectId: a, title: 'Lecture', weekday: 0, start: '09:00', end: '10:30', room: 'B-204', remind: null, _t: 0 },
      { id: 'seed-cls-2', subjectId: b, title: 'Tutorial', weekday: 1, start: '13:00', end: '14:00', room: 'M-11', remind: null, _t: 0 },
      { id: 'seed-cls-3', subjectId: a, title: 'Lab', weekday: 2, start: '11:00', end: '13:00', room: 'Psy Lab 2', remind: 30, _t: 0 },
      { id: 'seed-cls-4', subjectId: c, title: 'Seminar', weekday: 4, start: '10:00', end: '12:00', room: 'L-301', remind: null, _t: 0 },
    ],
    events: [
      { id: 'seed-evt-1', subjectId: b, title: 'Study group', date: iso(addDays(t, 1)), start: '16:00', end: '18:00', room: 'Library 3F', remind: 30, _t: 0 },
    ],
    tasks: [
      { id: 'seed-task-1', subjectId: a, title: 'Read Baddeley ch. 4', date: todayISO(), time: '', done: false, order: 0, remind: null, priority: 2, steps: [], created: Date.now(), _t: 0 },
      { id: 'seed-task-2', subjectId: b, title: 'Problem set 3', date: iso(addDays(t, 2)), time: '23:59', done: false, order: 1, remind: null, priority: 3, steps: [{ id: 'seed-step-1', text: 'Questions 1–4', done: true }, { id: 'seed-step-2', text: 'Questions 5–8', done: false }], created: Date.now(), _t: 0 },
      { id: 'seed-task-3', subjectId: c, title: 'Case brief draft', date: iso(addDays(t, 6)), time: '17:00', done: false, order: 2, remind: null, priority: 1, steps: [], created: Date.now(), _t: 0 },
    ],
    folders: [
      { id: 'seed-fld-1', name: 'Lecture slides', parentId: null, created: Date.now(), _t: 0 },
      { id: 'seed-fld-2', name: 'Readings', parentId: null, created: Date.now(), _t: 0 },
    ],
    files: [],
    certs: [],
    deleted: {},
    fired: {},
  };
}

/** Bring anything older up to the current shape without losing a keystroke. */
function upgrade(s) {
  const d = seed();
  s.v = 4;
  s.settings = Object.assign({}, d.settings, s.settings || {});
  SYNCED.forEach(k => { if (!Array.isArray(s[k])) s[k] = []; });
  if (!s.subjects.length) s.subjects = d.subjects;
  s.fired = s.fired && typeof s.fired === 'object' ? s.fired : {};
  s.deleted = s.deleted && typeof s.deleted === 'object' ? s.deleted : {};
  s.settingsAt = Number(s.settingsAt) || 0;
  s.ttMode = ['week', 'day', 'agenda'].includes(s.ttMode) ? s.ttMode : 'week';
  delete s.ttDensity;                                              // one timetable layout now
  s.taskView = s.taskView === 'list' ? 'list' : 'board';
  s.fileView = (s.fileView === 'list' || s.fileView === 'details') ? 'details' : 'icons';
  if (!s.fileSort || !['name', 'date', 'type', 'size'].includes(s.fileSort.key)) s.fileSort = { key: 'name', dir: 1 };
  s.ttDate = /^\d{4}-\d{2}-\d{2}$/.test(s.ttDate || '') ? s.ttDate : todayISO();
  if (s.view === 'deadlines') s.view = 'tasks';
  if (s.view === 'reminders') s.view = 'settings';
  if (s.view === 'vault') s.view = 'files';
  if (!['home', 'notes', 'timetable', 'tasks', 'files', 'certificates', 'settings'].includes(s.view)) s.view = 'home';

  s.subjects.forEach(x => { if (typeof x.hue !== 'number') x.hue = 232; });
  s.notes.forEach(n => {
    n.files = Array.isArray(n.files) ? n.files : [];
    if (n.html === undefined) n.html = mdToHTML(n.body || '');      // v1/v2 stored Markdown
    delete n.body;
    n.title = n.title || '';
    n.created = n.created || n.updated || Date.now();
    n.updated = n.updated || n.created;
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
  s.folders.forEach(f => { if (f.parentId === undefined || !s.folders.some(x => x.id === f.parentId)) f.parentId = null; });
  s.files.forEach(f => { if (f.folderId === undefined || (f.folderId && !s.folders.some(x => x.id === f.folderId))) f.folderId = null; });
  if (s.folderId === '__unfiled' || (s.folderId && !s.folders.some(x => x.id === s.folderId))) s.folderId = null;
  SYNCED.forEach(k => s[k].forEach(r => { if (typeof r._t !== 'number') r._t = 0; }));
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
let storageOK = true;

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); storageOK = true; }
  catch (e) {
    if (storageOK) toast('This browser refused to save. Export a backup, or connect sync in Settings.');
    storageOK = false;
  }
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

/* ---------- change tracking for sync ----------
   After every change, each record is compared with how it looked last time.
   Anything new or different gets a fresh `_t`; anything gone gets a tombstone
   in S.deleted. Sync then merges record by record, newest wins. */
const sansT = r => JSON.stringify(r, (k, v) => (k === '_t' ? undefined : v));
let SNAP = new Map(), SNAP_SETTINGS = '';
function snapshot() {
  SNAP = new Map();
  SYNCED.forEach(k => S[k].forEach(r => SNAP.set(r.id, sansT(r))));
  SNAP_SETTINGS = JSON.stringify(S.settings);
}
function stamp() {
  const now = Date.now();
  let changed = false;
  const seen = new Set();
  SYNCED.forEach(k => S[k].forEach(r => {
    if (!r.id) r.id = uid();
    seen.add(r.id);
    const j = sansT(r);
    if (SNAP.get(r.id) !== j) { r._t = now; changed = true; delete S.deleted[r.id]; }
  }));
  SNAP.forEach((_, id) => { if (!seen.has(id)) { S.deleted[id] = now; changed = true; } });
  const st = JSON.stringify(S.settings);
  if (st !== SNAP_SETTINGS) { S.settingsAt = now; changed = true; }
  if (changed) snapshot();
  return changed;
}
snapshot();

/** Mutate → stamp → autosave → re-render. {quiet:true} skips the re-render (typing). */
function commit(fn, opts = {}) {
  fn(S);
  const changed = stamp();
  const el = $('#saved');
  if (el) el.textContent = 'Saving';
  persist();
  if (changed && typeof schedulePush === 'function') schedulePush();
  if (!opts.quiet) render();
}

/* lookups ------------------------------------------------------------------ */
const subj = id => S.subjects.find(s => s.id === id);
const activeSubj = () => subj(S.activeSubject) || S.subjects[0];
const hue = id => { const s = subj(id); return s ? `hsl(${s.hue} 62% 66%)` : 'var(--rule2)'; };
const code = id => subj(id)?.code || '';
const openTasks = () => S.tasks.filter(t => !t.done);
const folderById = id => S.folders.find(f => f.id === id);
const folderName = id => folderById(id)?.name || 'Files';
const noteText = n => String(n.html || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');

function toast(msg) {
  const el = $('#toast');
  if (!el) return;
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
   5 — view: notes, as a notebook
   Each note is a book. Closed, you see its cover; open, you write on ruled
   pages that sit side by side like a spread (one page at a time on a phone).
   Text that reaches the foot of a page flows onto the next one and the book
   turns the page for you. The note itself is still one piece of rich text —
   the pages are drawn with CSS columns, so nothing about saving changes.
   ============================================================================= */
const BOOK = { id: null, open: false, spread: 0, per: 2, pages: 1, stride: 0, lines: 0, w: 0, turning: false };
const PAGES_SEEN = new Map();                     // note id → page count, for the cover
const MARK = new Map();                           // note id → last spread, a bookmark per session
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function viewNotes() {
  const s = activeSubj();
  const notes = S.notes.filter(n => n.subjectId === s.id).sort((a, b) => b.updated - a.updated);
  if (!notes.some(n => n.id === S.noteId)) S.noteId = notes[0]?.id || null;
  const note = S.notes.find(n => n.id === S.noteId);
  if (!note || BOOK.id !== note.id) {
    if (BOOK.id) MARK.set(BOOK.id, BOOK.spread);
    BOOK.id = note?.id || null; BOOK.open = false; BOOK.spread = MARK.get(BOOK.id) || 0;
  }

  const shelf = `<aside class="shelf" aria-label="Notebooks in ${esc(s.code)}">
    <button class="btn btn-accent shelf-new" data-act="new-note">${icon('plus')}New notebook</button>
    ${notes.length ? `<div class="shelf-list">${notes.map(n => `
      <button class="shelf-book" data-act="open-note" data-id="${n.id}" aria-current="${n.id === S.noteId}" style="--hue:${s.hue}">
        <span class="mini-cover" aria-hidden="true"><i></i></span>
        <span class="sb-txt"><b>${esc(n.title || 'Untitled')}</b>
          <span>${esc(fmtDate(new Date(n.updated), { day: '2-digit', month: 'short' }))}${n.files.length ? ` · ${n.files.length} file${n.files.length > 1 ? 's' : ''}` : ''}</span></span>
      </button>`).join('')}</div>`
    : `<p class="empty"><b>No notebooks in ${esc(s.code)}</b>Every notebook is filed under the subject in the top bar.</p>`}
  </aside>`;

  if (!note) {
    return `<div class="wrap"><div class="notes-layout">${shelf}
      <section class="desk"><p class="empty"><b>The shelf is empty</b>Start a notebook and its cover appears here.</p></section></div></div>`;
  }
  return `<div class="wrap"><div class="notes-layout">${shelf}
    <section class="desk" id="desk">${BOOK.open ? openBookHTML(note, s) : coverHTML(note, s)}</section>
  </div></div>`;
}

function coverHTML(note, s) {
  const words = (noteText(note).match(/\S+/g) || []).length;
  const pages = PAGES_SEEN.get(note.id) || Math.max(1, Math.ceil(words / 170));
  return `<div class="closed-book" id="closedBook" style="--hue:${s.hue}">
    <div class="cover" data-act="open-book" role="button" tabindex="0" aria-label="Open ${esc(note.title || 'this notebook')}">
      <span class="ribbon" aria-hidden="true"></span>
      <span class="cover-band" aria-hidden="true"></span>
      <div class="cover-frame">
        <span class="cover-k">${esc(s.code)}</span>
        <textarea class="cover-title" id="noteTitle" data-act="note-title" rows="1" placeholder="Name this notebook"
          aria-label="Notebook title" autocomplete="off" maxlength="80" spellcheck="false">${esc(note.title)}</textarea>
        <span class="cover-sub">${esc(s.name)}</span>
        <span class="cover-rule" aria-hidden="true"></span>
        <span class="cover-meta">${pages} page${pages === 1 ? '' : 's'} · ${words} word${words === 1 ? '' : 's'}</span>
      </div>
      <span class="cover-plate">Begun ${esc(fmtDate(new Date(note.created), { day: 'numeric', month: 'short', year: 'numeric' }))}</span>
    </div>
    <span class="book-edges" aria-hidden="true"></span>
  </div>
  <div class="cover-actions">
    <button class="btn btn-accent" data-act="open-book">${icon('notes')}Open notebook</button>
    <button class="btn btn-danger" data-act="del-note" data-id="${note.id}">${icon('trash')}Delete</button>
  </div>`;
}

function openBookHTML(note, s) {
  const clean = cleanHTML(note.html);
  const attached = note.files.map(id => S.files.find(f => f.id === id)).filter(Boolean);
  return `<div class="sheet-bar" id="toolbar">
      ${tool('close-book', 'left', 'Close the notebook')}
      <span class="tool-sep"></span>
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

    <div class="book-wrap" id="bookWrap">
      <div class="book" id="book" style="--hue:${s.hue}">
        <div class="pg pg-l">
          <header class="pg-head"><span>${esc(note.title || 'Untitled')}</span></header>
          <div class="pg-lines" aria-hidden="true"></div>
          <footer class="pg-num" id="pnL"></footer>
        </div>
        <div class="pg pg-r">
          <header class="pg-head"><span>${esc(s.code)} · ${esc(s.name)}</span></header>
          <div class="pg-lines" aria-hidden="true"></div>
          <footer class="pg-num" id="pnR"></footer>
        </div>
        <span class="spine" aria-hidden="true"></span>
        <div class="pages-clip" id="pagesClip">
          <div class="paper-body" id="paperBody" contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true"
               aria-label="Note" data-ph="Start writing.">${clean}</div>
        </div>
        <button class="corner corner-prev" data-act="page-prev" aria-label="Previous page"></button>
        <button class="corner corner-next" data-act="page-next" aria-label="Next page"></button>
      </div>
    </div>

    <div class="book-nav">
      <button class="btn btn-sm" data-act="page-prev" id="prevBtn">${icon('left')}<span>Previous</span></button>
      <span class="page-label" id="pageLabel">Page 1</span>
      <button class="btn btn-sm" data-act="page-next" id="nextBtn"><span>Next</span>${icon('right')}</button>
    </div>

    <div class="sheet-foot">
      ${attached.map(f => `<span class="clip">${icon('doc')}<span class="n">${esc(f.name)}</span>
        <button data-act="open-file" data-id="${f.id}" aria-label="Open ${esc(f.name)}">${icon('ext')}</button>
        <button data-act="unattach" data-id="${f.id}" aria-label="Remove ${esc(f.name)}">${icon('close')}</button></span>`).join('')}
      ${S.files.length ? `<span class="attach-pick"><label class="vh" for="attachSel">Attach a file</label>
        <select id="attachSel" data-act="attach"><option value="">Attach a file…</option>
        ${S.files.filter(f => !note.files.includes(f.id)).map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></span>`
      : `<button class="clip" data-act="view" data-view="files">${icon('up-tray')}<span class="n">Upload a file to attach it</span></button>`}
    </div>`;
}

/* ---------- page geometry ---------- */
const PAGE = { head: 44, foot: 40, padL: 62, padR: 30 };

/** Size the book to the screen and set up the columns that make the pages. */
function layoutBook(force) {
  const book = $('#book'), body = $('#paperBody'), wrap = $('#bookWrap');
  if (!book || !body || !wrap) return;
  const cs = getComputedStyle(wrap);
  const avail = Math.floor(wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  if (!force && avail === BOOK.w && BOOK.lines) { measureBook(); return; }
  BOOK.w = avail;

  const lh = MOBILE ? 28 : 30;
  BOOK.per = !MOBILE && avail >= 780 ? 2 : 1;
  const pageW = Math.floor(Math.min(avail, BOOK.per === 2 ? 1120 : 640) / BOOK.per);
  const top = wrap.getBoundingClientRect().top - ($('#main').getBoundingClientRect().top || 0);
  const room = window.innerHeight - Math.max(0, top) - (MOBILE ? 250 : 200);
  BOOK.lines = clamp(Math.floor((room - PAGE.head - PAGE.foot) / lh), MOBILE ? 12 : 14, 22);

  const padL = MOBILE ? 44 : PAGE.padL, padR = MOBILE ? 20 : PAGE.padR;
  const textW = pageW - padL - padR;
  const gap = padL + padR;
  BOOK.stride = textW + gap;
  BOOK.textW = textW; BOOK.gap = gap;

  book.classList.toggle('single', BOOK.per === 1);
  book.style.setProperty('--lh', `${lh}px`);
  book.style.setProperty('--page-w', `${pageW}px`);
  book.style.setProperty('--pad-l', `${padL}px`);
  book.style.setProperty('--pad-r', `${padR}px`);
  book.style.setProperty('--text-h', `${BOOK.lines * lh}px`);
  book.style.width = `${pageW * BOOK.per}px`;
  body.style.columnGap = `${gap}px`;
  BOOK.cols = 0;
  measureBook();
}

/** Count the pages the text fills and keep a spare one ready after it. */
function measureBook() {
  const body = $('#paperBody');
  if (!body || !BOOK.stride) return;
  const ensure = n => {
    if (n === BOOK.cols) return;
    BOOK.cols = n;
    body.style.columnCount = String(n);
    body.style.width = `${n * BOOK.textW + (n - 1) * BOOK.gap}px`;
  };
  if (!BOOK.cols) ensure(BOOK.per * 2);
  const left = body.getBoundingClientRect().left;
  let right = left;
  const r = document.createRange();
  r.selectNodeContents(body);
  for (const rect of r.getClientRects()) if (rect.width || rect.height) right = Math.max(right, rect.right);
  for (const el of body.children) for (const rect of el.getClientRects()) right = Math.max(right, rect.right);
  const pages = Math.max(1, Math.floor((right - left - 1) / BOOK.stride) + 1);
  BOOK.pages = pages;
  PAGES_SEEN.set(BOOK.id, pages);
  const want = Math.ceil((pages + 1) / BOOK.per) * BOOK.per;
  if (want > BOOK.cols || want < BOOK.cols - BOOK.per) ensure(want);
  BOOK.spread = clamp(BOOK.spread, 0, lastSpread());
  paintSpread();
}
const lastSpread = () => Math.max(0, Math.ceil(BOOK.pages / BOOK.per) - 1);

function paintSpread() {
  const body = $('#paperBody');
  if (!body) return;
  body.style.transform = `translateX(${-BOOK.spread * BOOK.per * BOOK.stride}px)`;
  const first = BOOK.spread * BOOK.per + 1;
  const l = $('#pnL'), rr = $('#pnR'), lab = $('#pageLabel');
  if (l) l.textContent = first <= BOOK.pages ? `— ${first} —` : '';
  if (rr) rr.textContent = BOOK.per === 2 && first + 1 <= BOOK.pages ? `— ${first + 1} —` : '';
  if (lab) {
    lab.textContent = BOOK.per === 2 && first + 1 <= BOOK.pages
      ? `Pages ${first}–${first + 1} of ${BOOK.pages}` : `Page ${first} of ${BOOK.pages}`;
  }
  const atStart = BOOK.spread === 0, atEnd = BOOK.spread >= lastSpread();
  $$('[data-act="page-prev"]').forEach(b => { b.disabled = atStart; });
  $$('[data-act="page-next"]').forEach(b => { b.disabled = atEnd; });
}

/** Which page the caret is on, counted from 0. */
function caretPage() {
  const body = $('#paperBody'), sel = window.getSelection();
  if (!body || !sel || !sel.rangeCount || !body.contains(sel.focusNode)) return null;
  const range = document.createRange();
  try { range.setStart(sel.focusNode, sel.focusOffset); } catch (e) { return null; }
  range.collapse(true);
  let rect = [...range.getClientRects()].find(x => x.height);
  if (!rect) {
    let el = sel.focusNode.nodeType === 1 ? (sel.focusNode.childNodes[sel.focusOffset] || sel.focusNode) : sel.focusNode.parentNode;
    if (el && el.nodeType !== 1) el = el.parentNode;
    if (el === body) el = body.children[Math.min(sel.focusOffset, body.children.length - 1)];
    rect = el?.getClientRects?.()[0];
  }
  if (!rect) return null;
  const x = rect.left + 1 - body.getBoundingClientRect().left;
  return Math.max(0, Math.floor(x / BOOK.stride));
}

/** Turn the book to show the page the caret has moved onto. */
function followCaret() {
  const body = $('#paperBody');
  if (!body || document.activeElement !== body || BOOK.turning) return;
  const p = caretPage();
  if (p === null) return;
  const spread = Math.floor(p / BOOK.per);
  if (spread !== BOOK.spread) turnTo(spread);
}

function turnTo(target, opts = {}) {
  const book = $('#book');
  target = clamp(target, 0, lastSpread());
  if (!book || target === BOOK.spread) { paintSpread(); return; }
  const forward = target > BOOK.spread;
  const finish = () => {
    BOOK.spread = target;
    MARK.set(BOOK.id, target);
    paintSpread();
    if (opts.placeCaret) caretToSpread();
  };
  if (reducedMotion() || BOOK.turning) { finish(); return; }

  BOOK.turning = true;
  const leaf = document.createElement('div');
  leaf.className = `leaf ${forward ? 'fwd' : 'back'} ${BOOK.per === 1 ? 'one' : 'two'}`;
  leaf.innerHTML = '<span class="leaf-face front"></span><span class="leaf-face rear"></span>';
  book.appendChild(leaf);
  book.classList.add('turning');
  setTimeout(finish, 280);
  setTimeout(() => {
    leaf.remove();
    book.classList.remove('turning');
    BOOK.turning = false;
    followCaret();
  }, 620);
}

/** After a manual page turn, put the caret at the top of the new page. */
function caretToSpread() {
  const body = $('#paperBody'), clip = $('#pagesClip');
  if (!body || !clip || document.activeElement !== body) return;
  const r = clip.getBoundingClientRect();
  const x = r.left + 4, y = r.top + 6;
  let range = null;
  if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(x, y);
  else if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) { range = document.createRange(); range.setStart(p.offsetNode, p.offset); }
  }
  if (range && body.contains(range.startContainer)) {
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    saveRange();
  }
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
  body.focus({ preventScroll: true });
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
  if (cmd === 'close-book') return actions['close-book']();

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

function wireCover() {
  const t = $('#noteTitle');
  if (!t) return;
  const fit = () => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; };
  fit();
  t.addEventListener('input', () => { t.value = t.value.replace(/\n/g, ' '); fit(); });
}

function wireEditor() {
  wireCover();
  const body = $('#paperBody');
  if (!body) return;
  try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* fine */ }
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* fine */ }
  updateWordCount();
  layoutBook(true);
  if (document.fonts?.ready) document.fonts.ready.then(() => { if ($('#paperBody') === body) measureBook(); });

  const reflow = () => { measureBook(); followCaret(); };
  // older browsers without overflow:clip may try to scroll the page frame to the caret — undo that
  const clip = $('#pagesClip');
  clip.addEventListener('scroll', () => { clip.scrollLeft = 0; clip.scrollTop = 0; });
  body.addEventListener('input', () => { saveNoteBody(); saveRange(); updateWordCount(); reflow(); });
  body.addEventListener('keyup', () => { saveRange(); syncTools(); followCaret(); });
  body.addEventListener('mouseup', () => { saveRange(); syncTools(); });
  body.addEventListener('focus', () => requestAnimationFrame(followCaret));
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
    reflow();
  });
  body.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (mod && !e.shiftKey && k === 'b') { e.preventDefault(); runTool('bold'); }
    if (mod && !e.shiftKey && k === 'i') { e.preventDefault(); runTool('italic'); }
    if (mod && !e.shiftKey && k === 'u') { e.preventDefault(); runTool('underline'); }
    if (mod && e.shiftKey && k === 'h') { e.preventDefault(); runTool('mark'); }
    if (mod && k === 'k') { e.preventDefault(); saveRange(); linkSheet(); }
    if (e.key === 'Tab') { e.preventDefault(); exec(e.shiftKey ? 'outdent' : 'indent'); afterEdit(); }
    if (e.key === 'PageDown') { e.preventDefault(); turnTo(BOOK.spread + 1, { placeCaret: true }); }
    if (e.key === 'PageUp') { e.preventDefault(); turnTo(BOOK.spread - 1, { placeCaret: true }); }
  });

  const bar = $('#toolbar');
  bar.addEventListener('mousedown', e => { if (e.target.closest('.tool')) e.preventDefault(); });
  bar.addEventListener('click', e => {
    const b = e.target.closest('.tool');
    if (b) runTool(b.dataset.tool);
  });

  /* swipe to turn on touch screens — only a clear sideways flick counts */
  const book = $('#book');
  let sx = 0, sy = 0, st = 0;
  book.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
  book.addEventListener('touchend', e => {
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    const sel = window.getSelection();
    if (Date.now() - st > 600 || Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    if (sel && !sel.isCollapsed) return;
    turnTo(BOOK.spread + (dx < 0 ? 1 : -1), { placeCaret: true });
  }, { passive: true });
}

/* the caret can move without a key press (clicks, IME, toolbar) */
document.addEventListener('selectionchange', debounce(() => {
  if (document.activeElement && document.activeElement.id === 'paperBody') followCaret();
}, 60));

/* =============================================================================
   6 — view: timetable (absorbs reminders)
   One layout. The grid only spans the hours your week actually uses, then
   sizes each hour so the whole week fits on screen — but never so small that
   the shortest class can't show its name. Clashing entries sit side by side
   instead of on top of each other.
   ============================================================================= */
let TT = { lo: 480, hi: 1260, hours: 13, minDur: 60 };

function ttWindow(keys) {
  const all = keys.flatMap(k => dayBlocks(k));
  let lo, hi;
  if (all.length) {
    lo = Math.min(...all.map(b => toMin(b.start)));
    hi = Math.max(...all.map(b => toMin(b.end)));
    lo = Math.floor((lo - 30) / 60) * 60;
    hi = Math.ceil((hi + 30) / 60) * 60;
    if (hi - lo < 240) {                                  // keep at least four hours visible
      const mid = (lo + hi) / 2;
      lo = Math.floor((mid - 120) / 60) * 60; hi = lo + 240;
    }
  } else {
    lo = S.settings.dayStart * 60; hi = S.settings.dayEnd * 60;
  }
  lo = clamp(lo, 0, 1200);
  hi = clamp(hi, lo + 240, 1440);
  const minDur = all.length ? Math.max(15, Math.min(...all.map(b => Math.max(1, toMin(b.end) - toMin(b.start))))) : 60;
  return { lo, hi, hours: Math.max(1, Math.round((hi - lo) / 60)), minDur };
}

/** Side-by-side lanes for entries that overlap in time. */
function laneLayout(blocks) {
  // very short entries are drawn at least ~30 min tall, so lay them out as if they were
  const items = blocks.map(b => ({ b, s: toMin(b.start), e: Math.max(toMin(b.end), toMin(b.start) + 30) }))
    .sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    cluster.forEach(it => {
      let i = lanes.findIndex(end => end <= it.s);
      if (i < 0) { i = lanes.length; lanes.push(0); }
      lanes[i] = it.e; it.lane = i;
    });
    cluster.forEach(it => { it.n = lanes.length; });
    cluster = [];
  };
  items.forEach(it => {
    if (cluster.length && it.s >= clusterEnd) flush();
    cluster.push(it); clusterEnd = Math.max(clusterEnd, it.e);
  });
  flush();
  return items;
}

function ttBar(label, mode) {
  const step = mode === 'week' ? 7 : 1;
  return `<div class="tt-bar">
    <div class="tt-nav">
      <button data-act="shift" data-n="${-step}" aria-label="Previous">${icon('left')}</button>
      <button class="mid" data-act="today" title="Back to today">${esc(label)}</button>
      <button data-act="shift" data-n="${step}" aria-label="Next">${icon('right')}</button>
    </div>
    <div class="seg">
      <button data-act="mode" data-mode="week" aria-pressed="${mode === 'week'}">Week</button>
      <button data-act="mode" data-mode="day" aria-pressed="${mode === 'day'}">Day</button>
      <button data-act="mode" data-mode="agenda" aria-pressed="${mode === 'agenda'}">Agenda</button>
    </div>
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

  /* hours run across the top… */
  const hours = [];
  for (let m = W.lo; m <= W.hi; m += 60) hours.push(`<span style="left:${pct(m)}%">${pad(m / 60)}:00</span>`);

  /* …and each day is a row down the side */
  const rows = keys.map((key, i) => {
    const d = parseISO(key), isToday = key === todayISO();
    const tasks = S.tasks.filter(t => t.date === key && !t.done);
    const lay = laneLayout(dayBlocks(key));
    const lanes = lay.reduce((n, it) => Math.max(n, it.n), 1);
    const blocks = lay.map(it => blockHTMLH(it, pct)).join('');
    /* tasks due outside the hours shown are pinned to the left or right edge */
    const chips = tasks.filter(t => t.time).map(t => {
      const m = toMin(t.time);
      const pos = m < W.lo ? 'left:2px' : m > W.hi ? 'right:2px' : `left:clamp(2px, ${pct(m)}%, calc(100% - 142px))`;
      const edge = m < W.lo || m > W.hi ? `<span class="tt-due">${esc(t.time)}</span>` : '';
      return `<button class="tt-task" style="${pos};--pcol:${prio(t.priority).css}"
        data-act="edit-task" data-id="${t.id}" title="${esc(t.title)} · due ${esc(t.time)}">${icon('flag')}<b>${esc(t.title)}</b>${edge}</button>`;
    }).join('');

    return `<div class="tth-row ${isToday ? 'is-today' : ''} ${i > 4 ? 'is-weekend' : ''}" style="--i:${i};--ln:${lanes}">
      <button class="tth-day" data-act="goto-day" data-date="${key}" title="Open ${DAY_FULL[i]}">
        <span class="dw">${DAY_FULL[i]}</span>
        <span class="dn">${d.getDate()} ${esc(fmtDate(d, { month: 'short' }))}</span>
        <span class="pips">${tasks.slice(0, 4).map(t => `<i style="--pcol:${prio(t.priority).css}"></i>`).join('')}</span>
      </button>
      <div class="tth-track" data-act="new-entry" data-date="${key}" data-wd="${i}">
        ${blocks}${chips}${isToday ? nowLineHTML(pct) : ''}
      </div>
    </div>`;
  }).join('');

  return `<div class="wrap">
    ${ttBar(`Week of ${fmtDate(mon, { day: 'numeric', month: 'long' })}`, 'week')}
    <div class="tth" id="ttGrid">
      <div class="tth-inner" style="--hrs:${W.hours}">
        <div class="tth-head"><div class="tth-corner">${icon('clock')}</div><div class="tth-hours">${hours.join('')}</div></div>
        <div class="tth-body" id="ttBody">${rows}</div>
      </div>
    </div>
    <p class="tt-legend">
      <span><i style="background:color-mix(in srgb,var(--iris) 24%,#0E131B);border-left:3px solid var(--iris)"></i>Repeats weekly</span>
      <span><i style="background:#0E131B;border:1px dashed var(--rule2);border-left:3px solid var(--rule2)"></i>One-off, this date only</span>
      <span>${icon('bell')} has a reminder</span>
      <span>Showing ${pad(W.lo / 60)}:00–${pad(W.hi / 60)}:00 · click an empty slot to add something there</span>
    </p>
  </div>`;
}

function blockHTMLH(it, pct) {
  const b = it.b;
  const left = pct(toMin(b.start));
  const w = Math.max(1.2, pct(toMin(b.end)) - left);
  const h = 100 / it.n;
  const bell = (b.remind !== null && b.remind !== undefined && b.remind >= 0) ? icon('bell', 'ic bell') : '';
  const where = [code(b.subjectId), b.room].filter(Boolean).join(' · ');
  return `<button class="tt-block ${b.kind === 'event' ? 'is-event' : ''}"
    style="left:calc(${left}% + 1px);width:calc(${w}% - 2px);top:calc(${it.lane * h}% + 3px);height:calc(${h}% - 6px);--subject:${hue(b.subjectId)}"
    data-act="edit-entry" data-id="${b.id}" data-kind="${b.kind}" title="${esc(b.title)} · ${esc(b.start)}–${esc(b.end)}${b.room ? ' · ' + esc(b.room) : ''}">
    ${bell}<span class="bn">${esc(b.title)}<span class="bt-inline"> · ${esc(b.start)}</span></span>
    ${where ? `<span class="br">${esc(where)}</span>` : ''}<span class="bt">${esc(b.start)}–${esc(b.end)}</span>
  </button>`;
}

function nowLineHTML(pct) {
  const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
  if (m < TT.lo || m > TT.hi) return '';
  return `<div class="tt-now" id="ttNow" style="left:${pct(m)}%"></div>`;
}

/** Fit the seven day-rows on screen, then label each entry by how much room it got. */
function fitTimetable() {
  const grid = $('#ttGrid'), body = $('#ttBody');
  if (!grid || !body) return;
  const rows = $$('.tth-row', body);
  if (!rows.length) return;
  const head = $('.tth-head', grid)?.offsetHeight || 38;
  const avail = window.innerHeight - grid.getBoundingClientRect().top - head - 64;
  grid.style.setProperty('--rowh', `${Math.round(clamp(avail / rows.length, 64, 120))}px`);
  $$('.tt-block', body).forEach(b => {
    b.classList.remove('sm', 'md', 'narrow');
    const h = b.offsetHeight;
    if (h < 40) b.classList.add('sm');
    else if (h < 62) b.classList.add('md');
    if (b.offsetWidth < 70) b.classList.add('narrow');
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

  return `<div class="wrap tf">
    <div class="sec-h">
      <h2>Tasks</h2>
      <p>${open.length} open${late ? ` · ${late} overdue` : ''}</p>
      <span class="spacer"></span>
    </div>

    ${top ? focusHTML(top) : `<div class="focus" style="--pcol:var(--mint)">
      <span class="focus-k">All clear</span>
      <div><h3>Nothing on your plate</h3><p class="m">Add a task below and the most pressing one is pinned here.</p></div>
    </div>`}

    <div class="tf-overview">
      ${chartPanel(all)}${donutPanel(all)}${upcomingPanel(open)}
    </div>

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

/* ---- overview strip: progress chart, status donut, upcoming ---------------- */
let TASKRANGE = 'day';

function taskStatus(t) {
  if (t.done) return { k: 'done', l: 'Done' };
  return { late: { k: 'late', l: 'Overdue' }, today: { k: 'today', l: 'Due today' }, soon: { k: 'soon', l: 'Due soon' }, later: { k: 'later', l: 'Planned' } }[urgency(t.date)];
}
const taskState = t => t.done ? 'done' : t.steps.some(s => s.done) ? 'doing' : 'todo';

function smoothPath(p, lo, hi) {
  if (p.length < 2) return '';
  const cy = y => clamp(y, lo, hi);
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${cy(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)},${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${cy(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)},${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function chartPanel(all) {
  const today = parseISO(todayISO());
  const B = [];
  if (TASKRANGE === 'month') {
    for (let i = 5; i >= 0; i--) {
      const s = new Date(today.getFullYear(), today.getMonth() - i, 1), e = new Date(today.getFullYear(), today.getMonth() - i + 1, 1);
      B.push({ s: s.getTime(), e: e.getTime(), l: fmtDate(s, { month: 'short' }) });
    }
  } else if (TASKRANGE === 'week') {
    const m = mondayOf(today);
    for (let i = 7; i >= 0; i--) { const s = addDays(m, -7 * i); B.push({ s: s.getTime(), e: addDays(s, 7).getTime(), l: fmtDate(s, { day: 'numeric', month: 'short' }) }); }
  } else {
    for (let i = 13; i >= 0; i--) { const s = addDays(today, -i); B.push({ s: s.getTime(), e: addDays(s, 1).getTime(), l: fmtDate(s, { day: 'numeric', month: 'short' }) }); }
  }
  const fin = B.map(b => all.filter(t => t.doneAt && t.doneAt >= b.s && t.doneAt < b.e).length);
  const add = B.map(b => all.filter(t => t.created && t.created >= b.s && t.created < b.e).length);
  const sumF = fin.reduce((a, b) => a + b, 0), sumA = add.reduce((a, b) => a + b, 0);

  const VW = 520, VH = 240, L = 30, R = 10, T = 12, Bm = 28, base = VH - Bm;
  const top = Math.max(3, Math.ceil(Math.max(...fin, ...add) / 3) * 3);
  const X = i => L + i * (VW - L - R) / (B.length - 1), Y = v => base - (v / top) * (base - T);
  const ptsF = fin.map((v, i) => [X(i), Y(v)]), ptsA = add.map((v, i) => [X(i), Y(v)]);
  const line = p => smoothPath(p, T, base);
  const area = p => `${line(p)} L${p[p.length - 1][0].toFixed(1)} ${base} L${p[0][0].toFixed(1)} ${base} Z`;
  const step = B.length > 8 ? 2 : 1;
  const grid = [0, 1, 2, 3].map(k => { const v = top * k / 3, y = Y(v);
    return `<line class="gl" x1="${L}" x2="${VW - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text x="${L - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${Math.round(v)}</text>`; }).join('');
  const labels = B.map((b, i) => (B.length - 1 - i) % step === 0 ? `<text x="${X(i).toFixed(1)}" y="${VH - 8}" text-anchor="middle">${esc(b.l)}</text>` : '').join('');
  const dots = (pts, vals, cls, name) => pts.map((p, i) => `<g class="hit"><circle class="hz" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="10"/><circle class="pt ${cls}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.6"/><title>${esc(B[i].l)} · ${vals[i]} ${name}</title></g>`).join('');

  return `<section class="panel tf-panel tf-chart">
    <div class="panel-h">${icon('clock')}<h3>Task progress</h3><span class="spacer"></span>
      <div class="seg seg-sm" role="group" aria-label="Chart range">
        ${[['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']].map(([r, l]) => `<button data-act="task-range" data-r="${r}" aria-pressed="${TASKRANGE === r}">${l}</button>`).join('')}
      </div>
    </div>
    <div class="ch-legend"><span><i class="f"></i>Finished <b data-count="${sumF}">${sumF}</b></span><span><i class="a"></i>Added <b data-count="${sumA}">${sumA}</b></span></div>
    <div class="ch-box">
      <svg class="ch" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Tasks finished and added over time">
        <defs>
          <linearGradient id="tfgF" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9B94A" stop-opacity=".34"/><stop offset="1" stop-color="#E9B94A" stop-opacity="0"/></linearGradient>
          <linearGradient id="tfgA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8FA6CE" stop-opacity=".26"/><stop offset="1" stop-color="#8FA6CE" stop-opacity="0"/></linearGradient>
        </defs>
        ${grid}${labels}
        <path class="ar" d="${area(ptsA)}" fill="url(#tfgA)"/><path class="ln a" pathLength="1" d="${line(ptsA)}"/>
        <path class="ar" d="${area(ptsF)}" fill="url(#tfgF)"/><path class="ln f" pathLength="1" d="${line(ptsF)}"/>
        ${dots(ptsA, add, 'a', 'added')}${dots(ptsF, fin, 'f', 'finished')}
      </svg>
      ${sumF + sumA === 0 ? '<p class="ch-empty">Add and finish a task and the lines start to move.</p>' : ''}
    </div>
  </section>`;
}

function donutPanel(all) {
  const n = { todo: 0, doing: 0, done: 0 };
  all.forEach(t => { n[taskState(t)]++; });
  const total = all.length, R = 46, C = 2 * Math.PI * R, gap = total > 1 ? 3 : 0;
  const parts = [['todo', 'To do', 'var(--p1)'], ['doing', 'In progress', 'var(--iris)'], ['done', 'Done', 'var(--mint)']];
  let off = 0;
  const segs = parts.map(([k, label, col]) => {
    if (!n[k]) return '';
    const len = Math.max(0.5, C * n[k] / total - gap);
    const s = `<circle class="seg" cx="60" cy="60" r="${R}" fill="none" stroke="${col}" stroke-width="11" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 60 60)"><title>${label}: ${n[k]}</title></circle>`;
    off += C * n[k] / total;
    return s;
  }).join('');
  return `<section class="panel tf-panel tf-donut">
    <div class="panel-h">${icon('layers')}<h3>Status overview</h3></div>
    <div class="donut-wrap">
      <svg class="donut" viewBox="0 0 120 120" role="img" aria-label="${n.todo} to do, ${n.doing} in progress, ${n.done} done">
        <circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--rule)" stroke-width="11"/>${segs}
      </svg>
      <div class="donut-c"><b data-count="${total}">${total}</b><span>${total === 1 ? 'task' : 'tasks'}</span></div>
    </div>
    <ul class="tf-legend">${parts.map(([k, l, c]) => `<li><i style="background:${c}"></i>${l}<b data-count="${n[k]}">${n[k]}</b></li>`).join('')}</ul>
  </section>`;
}

function upcomingPanel(open) {
  const t0 = todayISO(), t7 = iso(addDays(parseISO(t0), 7));
  const list = open.filter(t => t.date >= t0 && t.date <= t7)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99')).slice(0, 5);
  return `<section class="panel tf-panel tf-up">
    <div class="panel-h">${icon('flag')}<h3>Upcoming</h3><span class="spacer"></span><span class="hint">next 7 days</span></div>
    ${list.length ? `<div class="up-list">${list.map(t => { const d = parseISO(t.date); return `
      <button class="up-row" style="--pcol:${prio(t.priority).css}" data-act="edit-task" data-id="${t.id}">
        <span class="up-d"><b>${d.getDate()}</b><i>${esc(fmtDate(d, { month: 'short' }))}</i></span>
        <span class="up-bd"><b>${esc(t.title)}</b><span>${esc([code(t.subjectId), t.time || 'any time'].filter(Boolean).join(' · '))}</span></span>
        <span class="up-dot" title="${prio(t.priority).label} priority"></span>
      </button>`; }).join('')}</div>`
    : '<p class="empty"><b>Nothing due this week</b>Tasks dated in the next seven days show up here.</p>'}
  </section>`;
}

/** Numbers climb to their value when a view is replayed. */
function countUps(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  $$('[data-count]', root).forEach(el => {
    const to = Number(el.dataset.count) || 0;
    if (!to) return;
    const t0 = performance.now();
    const step = now => { const k = Math.min(1, (now - t0) / 750); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    el.textContent = '0'; requestAnimationFrame(step);
  });
}

/** A soft light follows the pointer across cards and panels. */
document.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  const el = e.target.closest?.('.task, .tf-panel, .focus');
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
}, { passive: true });

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
  const total = t.steps.length;
  const doneSteps = t.steps.filter(x => x.done).length;
  const pctDone = t.done ? 100 : total ? Math.round(doneSteps / total * 100) : 0;
  const expanded = EXPANDED.has(t.id);
  const showSteps = total || expanded;
  const st = taskStatus(t);

  return `<article class="task ${t.done ? 'done' : ''} ${compact ? 'is-compact' : ''}" data-id="${t.id}" draggable="${!compact}" style="--pcol:${p.css};--subject:${hue(t.subjectId)}">
    <div class="task-top">
      <button class="task-check" data-act="toggle" data-id="${t.id}" aria-pressed="${t.done}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}"><span class="lt">${esc((s?.code || '•').charAt(0).toUpperCase())}</span>${icon('check')}</button>
      <span class="task-sub">${esc(code(t.subjectId) || 'No subject')}</span>
      <span class="tf-pill st-${st.k}">${st.l}</span>
    </div>
    <div class="task-bd">
      <input class="task-title" data-act="rename" data-id="${t.id}" value="${esc(t.title)}" aria-label="Task name">
      <div class="task-meta">
        <span class="due u-${urgency(t.date)}">${esc(whenLabel(t))}</span>
        ${total ? `<span>${doneSteps}/${total} steps</span>` : ''}
        ${t.remind !== null && t.remind >= 0 ? `<span>${icon('bell')}</span>` : ''}
      </div>
      <div class="prog-row"><div class="prog"><i style="width:${pctDone}%"></i></div><b>${total || t.done ? pctDone + '%' : '–'}</b></div>
      ${showSteps ? `<div class="steps">
        ${t.steps.map(st2 => `<button class="step ${st2.done ? 'on' : ''}" data-act="toggle-step" data-id="${t.id}" data-sid="${st2.id}">
          <span class="bx">${icon('check')}</span><span>${esc(st2.text)}</span>
          <span class="rm" data-act="del-step" data-id="${t.id}" data-sid="${st2.id}" role="button" aria-label="Remove step">${icon('close')}</span>
        </button>`).join('')}
        <form class="step-add" data-form="add-step" data-id="${t.id}">
          <input type="text" name="text" placeholder="Add a step…" required autocomplete="off">
          <button class="btn btn-sm">${icon('plus')}</button>
        </form>
      </div>` : ''}
    </div>
    <div class="task-foot">
      <span class="task-flag">${icon('flag')}${p.label}</span>
      <div class="task-actions">
        <button class="icon-btn" data-act="bump-prio" data-id="${t.id}" aria-label="Change priority" title="Priority: ${p.label}">${icon('flag')}</button>
        <button class="icon-btn" data-act="toggle-steps" data-id="${t.id}" aria-label="Checklist" title="Checklist">${icon('list')}</button>
        <button class="icon-btn" data-act="edit-task" data-id="${t.id}" aria-label="Edit task" title="Edit">${icon('pencil')}</button>
        <button class="icon-btn danger" data-act="del-task" data-id="${t.id}" aria-label="Delete task" title="Delete">${icon('trash')}</button>
      </div>
    </div>
  </article>`;
}


/* =============================================================================
   8 — view: files, laid out like a file explorer
   Back / forward / up, an address bar, a folder tree down the side, folders
   that hold folders, large-icon and details views, sorting, right-click menus,
   drag-to-move, and a status bar. On a phone the tree folds away, a tap opens
   and each item carries a ⋯ menu.
   ============================================================================= */
const EXT = n => (String(n).includes('.') ? String(n).split('.').pop() : 'file').toUpperCase().slice(0, 4);
const size = b => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((b || 0) / 1024))} KB`;
const XP = { back: [], fwd: [], sel: new Set(), q: '', open: new Set(), anchor: null };

function ftype(f) {
  const t = String(f.type || ''), e = EXT(f.name);
  if (t.startsWith('image/')) return { c: '#58D6C0', label: 'Image' };
  if (t === 'application/pdf' || e === 'PDF') return { c: '#FF6B6B', label: 'PDF document' };
  if (['PPT', 'PPTX', 'KEY', 'ODP'].includes(e)) return { c: '#F6A524', label: 'Presentation' };
  if (['XLS', 'XLSX', 'CSV', 'TSV', 'ODS'].includes(e)) return { c: '#4FBF7A', label: 'Spreadsheet' };
  if (['DOC', 'DOCX', 'ODT', 'RTF'].includes(e)) return { c: '#7C8CF8', label: 'Word document' };
  if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ'].includes(e)) return { c: '#98A4BC', label: 'Archive' };
  if (t.startsWith('audio/')) return { c: '#C08CF8', label: 'Audio' };
  if (t.startsWith('video/')) return { c: '#C08CF8', label: 'Video' };
  if (t.startsWith('text/')) return { c: '#98A4BC', label: 'Text document' };
  return { c: '#98A4BC', label: `${e} file` };
}

/* drawn icons — no ids inside, so any number of copies can share a page */
const folderSVG = full => `<svg class="fold-ic" viewBox="0 0 64 52" aria-hidden="true">
  <path d="M4 8a4 4 0 0 1 4-4h15l6 6h27a4 4 0 0 1 4 4v4H4Z" fill="#C9962B"/>
  <rect x="4" y="12" width="56" height="36" rx="4" fill="#D9A93A"/>
  ${full ? '<rect x="11" y="9" width="40" height="22" rx="2" fill="#F4F1EA"/><rect x="15" y="6" width="36" height="20" rx="2" fill="#FFFFFF" opacity=".9"/>' : ''}
  <path d="M2 20a4 4 0 0 1 4-4h52a4 4 0 0 1 4 4l-2 24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z" fill="#F2C14E"/>
  <path d="M2 20a4 4 0 0 1 4-4h52a4 4 0 0 1 4 4v1H2Z" fill="#F7D57A"/>
</svg>`;
const fileSVG = f => {
  const t = ftype(f), e = EXT(f.name);
  return `<svg class="file-ic" viewBox="0 0 48 60" aria-hidden="true">
    <path d="M6 2h26l14 14v38a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Z" fill="#F4F3F1"/>
    <path d="M32 2v10a4 4 0 0 0 4 4h10Z" fill="#CFCFD4"/>
    <path d="M10 26h24M10 32h28M10 38h20" stroke="#D5D5DA" stroke-width="2" stroke-linecap="round"/>
    <rect x="2" y="42" width="${Math.max(24, e.length * 8 + 10)}" height="13" rx="2" fill="${t.c}"/>
    <text x="7" y="52" font-family="ui-monospace,Menlo,monospace" font-size="9" font-weight="700" fill="#101012">${esc(e)}</text>
  </svg>`;
};

/* tree helpers --------------------------------------------------------------- */
const childFolders = pid => S.folders.filter(f => (f.parentId || null) === (pid || null)).sort((a, b) => a.name.localeCompare(b.name));
const filesIn = fid => S.files.filter(f => (f.folderId || null) === (fid || null));
function folderPath(id) {
  const out = []; let f = folderById(id); const guard = new Set();
  while (f && !guard.has(f.id)) { guard.add(f.id); out.unshift(f); f = folderById(f.parentId); }
  return out;
}
function isInside(id, ancestor) {
  let f = folderById(id); const guard = new Set();
  while (f && !guard.has(f.id)) { if (f.id === ancestor) return true; guard.add(f.id); f = folderById(f.parentId); }
  return false;
}
const folderCount = id => childFolders(id).length + filesIn(id).length;
const latest = id => Math.max(folderById(id)?.created || 0, ...filesIn(id).map(f => f.added || 0));

function sortItems(folders, files) {
  const { key, dir } = S.fileSort;
  const cmpName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const fileCmp = {
    name: cmpName,
    date: (a, b) => (a.added || 0) - (b.added || 0),
    size: (a, b) => (a.size || 0) - (b.size || 0),
    type: (a, b) => ftype(a).label.localeCompare(ftype(b).label) || cmpName(a, b),
  }[key];
  const folderCmp = key === 'date' ? (a, b) => latest(a.id) - latest(b.id) : cmpName;
  return {
    folders: [...folders].sort((a, b) => folderCmp(a, b) * (key === 'name' || key === 'date' ? dir : 1)),
    files: [...files].sort((a, b) => fileCmp(a, b) * dir),
  };
}

function currentItems() {
  const q = XP.q.trim().toLowerCase();
  if (q) {
    return sortItems(S.folders.filter(f => f.name.toLowerCase().includes(q)), S.files.filter(f => f.name.toLowerCase().includes(q)));
  }
  return sortItems(childFolders(S.folderId), filesIn(S.folderId));
}

function viewFiles() {
  if (S.folderId && !folderById(S.folderId)) S.folderId = null;
  const here = S.folderId;
  const path = folderPath(here);
  const used = S.files.reduce((n, f) => n + (f.size || 0), 0);
  const crumbs = [`<button class="xp-crumb" data-act="xp-go" data-id="">${icon('files')}<span>Files</span></button>`,
    ...path.map(f => `<button class="xp-crumb" data-act="xp-go" data-id="${f.id}"><span>${esc(f.name)}</span></button>`)]
    .join(`<span class="xp-sep" aria-hidden="true">${icon('right')}</span>`);
  const sortLabel = { name: 'Name', date: 'Date', type: 'Type', size: 'Size' };

  return `<div class="wrap wrap-wide">
  <div class="xp ${MOBILE ? 'xp-phone' : ''}" id="xp">
    <div class="xp-bar">
      <div class="xp-navbtns">
        <button class="icon-btn" data-act="xp-back" aria-label="Back" ${XP.back.length ? '' : 'disabled'}>${icon('left')}</button>
        ${MOBILE ? '' : `<button class="icon-btn" data-act="xp-fwd" aria-label="Forward" ${XP.fwd.length ? '' : 'disabled'}>${icon('right')}</button>`}
        <button class="icon-btn xp-up" data-act="xp-up" aria-label="Up one level" ${here ? '' : 'disabled'}>${icon('up')}</button>
      </div>
      <nav class="xp-addr" aria-label="Location">${crumbs}</nav>
      <label class="xp-search">${icon('search')}<span class="vh">Search files</span>
        <input type="search" id="xpSearch" data-act="xp-search" placeholder="Search Files" value="${esc(XP.q)}" autocomplete="off"></label>
    </div>

    <div class="xp-cmd">
      <button class="btn btn-sm" data-act="new-folder">${icon('plus')}<span>New folder</span></button>
      <label class="btn btn-sm btn-accent">${icon('up-tray')}<span>Upload</span><input type="file" id="picker" multiple hidden></label>
      <span class="xp-cmd-sep" aria-hidden="true"></span>
      <span class="xp-selcmds" id="xpSelCmds"></span>
      <span class="spacer"></span>
      <label class="xp-sort"><span class="vh">Sort by</span>
        <select data-act="xp-sort">${Object.entries(sortLabel).map(([k, l]) => `<option value="${k}" ${S.fileSort.key === k ? 'selected' : ''}>Sort: ${l}</option>`).join('')}</select></label>
      <button class="icon-btn" data-act="xp-dir" aria-label="Reverse order" title="${S.fileSort.dir > 0 ? 'Ascending' : 'Descending'}">${icon(S.fileSort.dir > 0 ? 'up' : 'down')}</button>
      <div class="seg">
        <button data-act="file-view" data-v="icons" aria-pressed="${S.fileView === 'icons'}" aria-label="Large icons" title="Large icons">${icon('grid')}</button>
        <button data-act="file-view" data-v="details" aria-pressed="${S.fileView === 'details'}" aria-label="Details" title="Details">${icon('list')}</button>
      </div>
    </div>

    <div class="xp-main">
      ${MOBILE ? '' : `<nav class="xp-tree" aria-label="Folders">
        <button class="xp-node ${here === null ? 'on' : ''}" data-act="xp-go" data-id="" data-drop="" style="--d:0">
          ${folderSVG(false)}<span>Files</span><span class="c">${S.files.length}</span></button>
        ${treeHTML(null, 1)}
        <div class="xp-tree-foot">${icon('layers')}<span>${S.files.length} file${S.files.length === 1 ? '' : 's'} · ${size(used)}</span></div>
      </nav>`}
      <div class="xp-pane" id="xpPane" data-act="xp-blank" tabindex="-1">${paneHTML()}</div>
    </div>

    <div class="xp-status" id="xpStatus"></div>
  </div></div>`;
}

function treeHTML(pid, depth) {
  return childFolders(pid).map(f => {
    const kids = childFolders(f.id).length;
    const open = XP.open.has(f.id) || isInside(S.folderId, f.id);
    return `<div class="xp-branch">
      <button class="xp-node ${S.folderId === f.id ? 'on' : ''}" data-act="xp-go" data-id="${f.id}" data-drop="${f.id}" style="--d:${depth}">
        ${kids ? `<span class="xp-tw ${open ? 'open' : ''}" data-act="xp-twist" data-id="${f.id}" role="button" aria-label="${open ? 'Collapse' : 'Expand'}">${icon('right')}</span>` : '<span class="xp-tw none"></span>'}
        ${folderSVG(folderCount(f.id) > 0)}<span>${esc(f.name)}</span></button>
      ${kids && open ? treeHTML(f.id, depth + 1) : ''}
    </div>`;
  }).join('');
}

function paneHTML() {
  const { folders, files } = currentItems();
  const searching = !!XP.q.trim();
  if (!folders.length && !files.length) {
    return `<div class="xp-empty">
      ${folderSVG(false)}
      <b>${searching ? 'No matches' : 'This folder is empty'}</b>
      <p class="hint">${searching ? 'Nothing here has that in its name.' : (MOBILE ? 'Tap Upload to add lecture files.' : 'Drag files from your computer onto this window, or use Upload.')}</p>
    </div>`;
  }
  const menuBtn = (kind, id) => `<button class="xp-more" data-act="xp-menu" data-kind="${kind}" data-id="${id}" aria-label="More actions">${icon('more')}</button>`;
  const where = f => searching ? folderPath(f.folderId ?? f.parentId).map(x => x.name).join(' › ') || 'Files' : '';

  if (S.fileView === 'details') {
    const head = (k, l) => `<button class="xp-th" data-act="xp-sortby" data-k="${k}">${l}${S.fileSort.key === k ? `<span class="arr">${S.fileSort.dir > 0 ? '▲' : '▼'}</span>` : ''}</button>`;
    return `<div class="xp-details" role="grid">
      <div class="xp-row xp-head" role="row">${head('name', 'Name')}${head('date', 'Date modified')}${head('type', 'Type')}${head('size', 'Size')}<span></span></div>
      ${folders.map(f => `<div class="xp-row xp-item ${XP.sel.has('d:' + f.id) ? 'sel' : ''}" role="row" draggable="true"
          data-act="xp-item" data-kind="folder" data-id="${f.id}" data-drop="${f.id}" tabindex="0">
        <span class="xp-nm">${folderSVG(folderCount(f.id) > 0)}<span>${esc(f.name)}${searching ? `<small>${esc(where({ parentId: f.parentId }))}</small>` : ''}</span></span>
        <span>${esc(fmtDate(new Date(latest(f.id)), { day: '2-digit', month: 'short', year: 'numeric' }))}</span>
        <span>File folder</span><span>${folderCount(f.id)} item${folderCount(f.id) === 1 ? '' : 's'}</span>${menuBtn('folder', f.id)}</div>`).join('')}
      ${files.map(f => `<div class="xp-row xp-item ${XP.sel.has('f:' + f.id) ? 'sel' : ''}" role="row" draggable="true"
          data-act="xp-item" data-kind="file" data-id="${f.id}" tabindex="0">
        <span class="xp-nm"><span class="xp-mini" ${String(f.type).startsWith('image/') ? `data-thumb="${f.id}"` : ''}>${fileSVG(f)}</span><span>${esc(f.name)}${searching ? `<small>${esc(where(f))}</small>` : ''}</span></span>
        <span>${esc(fmtDate(new Date(f.added || Date.now()), { day: '2-digit', month: 'short', year: 'numeric' }))}</span>
        <span>${esc(ftype(f).label)}</span><span>${size(f.size)}</span>${menuBtn('file', f.id)}</div>`).join('')}
    </div>`;
  }

  return `<div class="xp-icons">
    ${folders.map(f => `<div class="xp-tile xp-item ${XP.sel.has('d:' + f.id) ? 'sel' : ''}" draggable="true"
        data-act="xp-item" data-kind="folder" data-id="${f.id}" data-drop="${f.id}" tabindex="0" title="${esc(f.name)}">
      <span class="xp-art">${folderSVG(folderCount(f.id) > 0)}</span>
      <span class="xp-name">${esc(f.name)}</span>
      <span class="xp-sub">${searching ? esc(where({ parentId: f.parentId })) : `${folderCount(f.id)} item${folderCount(f.id) === 1 ? '' : 's'}`}</span>
      ${menuBtn('folder', f.id)}</div>`).join('')}
    ${files.map(f => `<div class="xp-tile xp-item ${XP.sel.has('f:' + f.id) ? 'sel' : ''}" draggable="true"
        data-act="xp-item" data-kind="file" data-id="${f.id}" tabindex="0" title="${esc(f.name)}">
      <span class="xp-art ${String(f.type).startsWith('image/') ? 'is-img' : ''}" ${String(f.type).startsWith('image/') ? `data-thumb="${f.id}"` : ''}>${fileSVG(f)}</span>
      <span class="xp-name">${esc(f.name)}</span>
      <span class="xp-sub">${searching ? esc(where(f)) : size(f.size)}</span>
      ${menuBtn('file', f.id)}</div>`).join('')}
  </div>`;
}

/** Selection only changes classes — re-rendering here would break double-click. */
function xpSelectionUI() {
  $$('#xpPane .xp-item').forEach(el => el.classList.toggle('sel', XP.sel.has((el.dataset.kind === 'folder' ? 'd:' : 'f:') + el.dataset.id)));
  const { folders, files } = currentItems();
  const n = XP.sel.size;
  const status = $('#xpStatus');
  if (status) {
    const selBytes = [...XP.sel].filter(k => k.startsWith('f:')).reduce((t, k) => t + (S.files.find(f => f.id === k.slice(2))?.size || 0), 0);
    status.textContent = `${folders.length + files.length} item${folders.length + files.length === 1 ? '' : 's'}`
      + (n ? `   ·   ${n} selected${selBytes ? ' · ' + size(selBytes) : ''}` : '')
      + (XP.q.trim() ? '   ·   search results' : '');
  }
  const cmds = $('#xpSelCmds');
  if (cmds) {
    const one = n === 1 ? [...XP.sel][0] : null;
    cmds.innerHTML = n ? `
      ${one ? `<button class="btn btn-sm btn-ghost" data-act="xp-open">${icon('eye')}<span>Open</span></button>` : ''}
      ${[...XP.sel].some(k => k.startsWith('f:')) ? `<button class="btn btn-sm btn-ghost" data-act="xp-download">${icon('down-tray')}<span>Download</span></button>` : ''}
      ${one ? `<button class="btn btn-sm btn-ghost" data-act="xp-rename">${icon('pencil')}<span>Rename</span></button>` : ''}
      <button class="btn btn-sm btn-ghost" data-act="xp-move">${icon('files')}<span>Move</span></button>
      <button class="btn btn-sm btn-ghost btn-danger" data-act="xp-delete">${icon('trash')}<span>Delete</span></button>` : '';
  }
}

function refreshPane() {
  const pane = $('#xpPane');
  if (!pane) return;
  pane.innerHTML = paneHTML();
  xpSelectionUI();
  wireThumbs();
}

function xpNavigate(id, push = true) {
  id = id || null;
  if (push && id !== S.folderId) { XP.back.push(S.folderId); XP.fwd = []; }
  XP.sel.clear(); XP.q = '';
  commit(s => { s.folderId = id; });
}

function xpOpenItem(kind, id) {
  if (kind === 'folder') return xpNavigate(id);
  openLightbox(id);
}

/* context menu ---------------------------------------------------------------- */
function showMenu(x, y, items) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'ctx'; m.id = 'ctx'; m.setAttribute('role', 'menu');
  m.innerHTML = items.map(it => it === '-' ? '<span class="ctx-sep"></span>'
    : `<button role="menuitem" class="${it.danger ? 'danger' : ''}" data-act="${it.act}">${icon(it.ic)}<span>${esc(it.label)}</span></button>`).join('');
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${clamp(x, 8, innerWidth - r.width - 8)}px`;
  m.style.top = `${clamp(y, 8, innerHeight - r.height - 8)}px`;
  m.querySelector('button')?.focus({ preventScroll: true });
}
function closeMenu() { $('#ctx')?.remove(); }

function itemMenu(x, y) {
  const n = XP.sel.size, one = n === 1 ? [...XP.sel][0] : null;
  const hasFile = [...XP.sel].some(k => k.startsWith('f:'));
  showMenu(x, y, [
    ...(one ? [{ act: 'xp-open', ic: one.startsWith('d:') ? 'files' : 'eye', label: 'Open' }] : []),
    ...(hasFile ? [{ act: 'xp-download', ic: 'down-tray', label: n > 1 ? `Download ${n} items` : 'Download' }] : []),
    '-',
    ...(one ? [{ act: 'xp-rename', ic: 'pencil', label: 'Rename' }] : []),
    { act: 'xp-move', ic: 'files', label: 'Move to…' },
    '-',
    { act: 'xp-delete', ic: 'trash', label: n > 1 ? `Delete ${n} items` : 'Delete', danger: true },
  ]);
}
function blankMenu(x, y) {
  showMenu(x, y, [
    { act: 'new-folder', ic: 'plus', label: 'New folder' },
    { act: 'upload', ic: 'up-tray', label: 'Upload files…' },
    '-',
    { act: 'xp-view-icons', ic: 'grid', label: 'Large icons' },
    { act: 'xp-view-details', ic: 'list', label: 'Details' },
  ]);
}

function folderOptions(sel, exclude = []) {
  const out = [`<option value="" ${!sel ? 'selected' : ''}>Files (top level)</option>`];
  const walk = (pid, depth) => childFolders(pid).forEach(f => {
    if (exclude.some(x => f.id === x || isInside(f.id, x))) return;
    out.push(`<option value="${f.id}" ${sel === f.id ? 'selected' : ''}>${' '.repeat(depth)}${esc(f.name)}</option>`);
    walk(f.id, depth + 1);
  });
  walk(null, 1);
  return out.join('');
}

/** Move selected keys ('f:id' / 'd:id') into a folder. */
function moveItems(keys, target) {
  target = target || null;
  let moved = 0, refused = 0;
  commit(s => {
    keys.forEach(k => {
      const id = k.slice(2);
      if (k.startsWith('f:')) {
        const f = s.files.find(x => x.id === id);
        if (f && (f.folderId || null) !== target) { f.folderId = target; moved++; }
      } else {
        const f = s.folders.find(x => x.id === id);
        if (!f) return;
        if (target && (target === id || isInside(target, id))) { refused++; return; }
        if ((f.parentId || null) !== target) { f.parentId = target; moved++; }
      }
    });
  });
  if (refused) toast('A folder cannot go inside itself.');
  else if (moved) toast(`Moved ${moved} item${moved > 1 ? 's' : ''} to ${target ? folderName(target) : 'Files'}`);
}

async function deleteItems(keys) {
  const files = keys.filter(k => k.startsWith('f:')).map(k => k.slice(2));
  const folders = keys.filter(k => k.startsWith('d:')).map(k => k.slice(2));
  const msg = folders.length
    ? `Delete ${keys.length === 1 ? 'this folder' : `${keys.length} items`}? Anything inside ${folders.length > 1 || files.length ? 'the folders' : 'it'} moves up one level — only the folder${folders.length > 1 ? 's go' : ' goes'}.${files.length ? ` ${files.length} file${files.length > 1 ? 's are' : ' is'} deleted for good.` : ''}`
    : `Delete ${files.length === 1 ? 'this file' : `${files.length} files`}? ${files.length === 1 ? 'It is' : 'They are'} also removed from any note ${files.length === 1 ? 'it is' : 'they are'} attached to.`;
  if (!confirm(msg)) return;
  await Promise.all(files.map(id => blobs.del(id)));
  commit(s => {
    folders.forEach(id => {
      const f = s.folders.find(x => x.id === id);
      if (!f) return;
      s.folders.forEach(x => { if (x.parentId === id) x.parentId = f.parentId || null; });
      s.files.forEach(x => { if (x.folderId === id) x.folderId = f.parentId || null; });
      if (s.folderId === id || isInside(s.folderId, id)) s.folderId = f.parentId || null;
    });
    s.folders = s.folders.filter(x => !folders.includes(x.id));
    s.files = s.files.filter(f => !files.includes(f.id));
    s.notes.forEach(n => { n.files = n.files.filter(x => !files.includes(x)); });
    s.certs.forEach(c => { if (files.includes(c.fileId)) c.fileId = null; });
  });
  XP.sel.clear();
  xpSelectionUI();
  toast(keys.length > 1 ? `${keys.length} items deleted` : folders.length ? 'Folder deleted' : 'File deleted');
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
    <div class="sec-h"><h2>Settings</h2><p>${SYNC.cfg ? 'Synced across your devices' : 'Stored in this browser until you turn on sync'}</p></div>

    ${syncPanelHTML()}

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
        <p class="hint" style="margin-bottom:14px">A single file with your notes, timetable, tasks, certificates and the uploaded files themselves. Restore it on any device to pick up exactly where you left off.</p>
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
          <div class="bd"><b>Erase this device</b><span>Notes, timetable, tasks, files in this browser. No undo.${SYNC.cfg ? ' Sync is switched off first, so your cloud copy is kept.' : ''}</span></div>
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
  home: ['new-note', 'New note'], notes: ['new-note', 'New notebook'], timetable: ['new-entry', 'Add entry'],
  tasks: ['new-task', 'New task'], files: ['upload', 'Upload'], certificates: ['new-cert', 'Add certificate'],
  settings: ['export', 'Back up'],
};

/* Phone and desktop are two different layouts, chosen by screen width. */
const mq = window.matchMedia('(max-width: 760px)');
let MOBILE = mq.matches;
const TOUCH = window.matchMedia('(hover: none)').matches;

function renderChrome() {
  const late = openTasks().filter(t => urgency(t.date) === 'late').length;
  const dueToday = openTasks().filter(t => t.date <= todayISO()).length;

  $('#app').classList.toggle('rail-open', !!S.railOpen);
  $('.rail-expand')?.setAttribute('aria-expanded', String(!!S.railOpen));
  document.body.dataset.view = S.view;
  document.body.classList.toggle('is-phone', MOBILE);

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

  $('#crumb').textContent = TITLES[S.view] || 'Studyframe';

  const sel = $('#subjectSel');
  sel.innerHTML = S.subjects.map(s =>
    `<option value="${s.id}" ${s.id === S.activeSubject ? 'selected' : ''}>${esc(s.code)} — ${esc(s.name)}</option>`
  ).join('') + '<option value="__new">+ New subject…</option>';
  $('#subjectDot').style.background = hue(S.activeSubject);
  $('#subjectDot').style.boxShadow = `0 0 0 3px color-mix(in srgb, ${hue(S.activeSubject)} 22%, transparent)`;

  const [, label] = PRIMARY[S.view] || PRIMARY.home;
  $('#primaryLabel').textContent = label;
  $('#primaryBtn')?.setAttribute('aria-label', label);
  syncBadge();
}

let lastView = null;
let lastFx = null;
function render() {
  const was = MOBILE;
  MOBILE = mq.matches;
  if (was !== MOBILE) BOOK.w = 0;
  closeMenu();
  renderChrome();
  const main = $('#main');
  const changed = S.view !== lastView;
  const keep = main.scrollTop;
  lastView = S.view;
  main.classList.remove('enter');
  main.innerHTML = (VIEWS[S.view] || viewHome)();
  if (changed) {
    main.scrollTop = 0;
    void main.offsetWidth;
    main.classList.add('enter');
  } else main.scrollTop = keep;

  const fxKey = S.view === 'timetable' ? `tt:${S.ttMode}:${S.ttDate}` : S.view === 'tasks' ? `tk:${S.taskView}:${S.taskScope}:${!!S.taskShowDone}:${TASKRANGE}` : null;
  main.classList.remove('fx');
  if (fxKey && fxKey !== lastFx) { void main.offsetWidth; main.classList.add('fx'); countUps(main); }
  lastFx = fxKey;

  if (S.view === 'notes') wireEditor();
  if (S.view === 'files') { wireFiles(); wireThumbs(); xpSelectionUI(); }
  if (S.view === 'certificates') wireThumbs();
  if (S.view === 'settings') wireImporter();
  if (S.view === 'timetable') { fitTimetable(); requestAnimationFrame(fitTimetable); }
  uiTick();
}

/** Re-render unless the person is typing somewhere; then wait until they stop. */
let renderPending = false;
function renderSafely() {
  const a = document.activeElement;
  const typing = a && (a.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && $('#main').contains(a)));
  if (typing || !$('#sheet').hidden) { renderPending = true; return; }
  renderPending = false;
  render();
}
document.addEventListener('focusout', () => setTimeout(() => {
  if (renderPending && !(document.activeElement && (document.activeElement.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)))) renderSafely();
}, 200));

/* =============================================================================
   11 — file store: upload, thumbnails, preview, download
   ============================================================================= */
async function addFiles(list) {
  const folderId = S.folderId && folderById(S.folderId) ? S.folderId : null;
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
    toast(`${added} file${added > 1 ? 's' : ''} added to ${folderId ? folderName(folderId) : 'Files'}`);
  }
}

/** A stored file: this device first, then the cloud copy if sync is on. */
async function blobGet(id) {
  let blob = null;
  try { blob = await blobs.get(id); } catch (e) { /* not here */ }
  if (blob) return blob;
  if (SYNC.cfg && S.files.some(f => f.id === id)) {
    try {
      blob = await ghGetFile(id);
      if (blob) await blobs.put(id, blob);
    } catch (e) { blob = null; }
  }
  return blob;
}

function wireFiles() {
  const picker = $('#picker'), xp = $('#xp');
  if (!picker || !xp) return;
  picker.onchange = () => { if (picker.files.length) addFiles([...picker.files]); picker.value = ''; };
  const hasOSFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  xp.addEventListener('dragover', e => { if (hasOSFiles(e)) { e.preventDefault(); xp.classList.add('over'); } });
  xp.addEventListener('dragleave', e => { if (!xp.contains(e.relatedTarget)) xp.classList.remove('over'); });
  xp.addEventListener('drop', e => {
    xp.classList.remove('over');
    if (!hasOSFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]);
  });
  const search = $('#xpSearch');
  if (search) search.addEventListener('input', () => { XP.q = search.value; XP.sel.clear(); refreshPane(); });
}

let thumbURLs = [];
async function wireThumbs() {
  thumbURLs.forEach(u => URL.revokeObjectURL(u));
  thumbURLs = [];
  for (const el of $$('[data-thumb]')) {
    try {
      const blob = await blobGet(el.dataset.thumb);
      if (!blob || !el.isConnected) continue;
      const u = URL.createObjectURL(blob);
      thumbURLs.push(u);
      const img = new Image();
      img.src = u; img.alt = ''; img.draggable = false;
      img.onload = () => { el.innerHTML = ''; el.appendChild(img); el.classList.add('has-img'); };
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

  const blob = await blobGet(id);
  if (lbFile !== f) return;
  if (!blob) {
    body.innerHTML = `<p class="empty"><b>This file is not on this device</b>${SYNC.cfg ? 'It has not reached the cloud copy yet — open it on the device you added it from, then sync.' : 'Turn on sync in Settings, or upload it again here.'}</p>`;
    return;
  }
  if (lbURL) URL.revokeObjectURL(lbURL);
  lbURL = URL.createObjectURL(blob);
  const type = f.type || blob.type || '';
  if (type.startsWith('image/')) body.innerHTML = `<img src="${lbURL}" alt="${esc(f.name)}">`;
  else if (type === 'application/pdf') body.innerHTML = `<iframe src="${lbURL}" title="${esc(f.name)}"></iframe>`;
  else if (type.startsWith('text/')) body.innerHTML = `<pre>${esc((await blob.text()).slice(0, 200000))}</pre>`;
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
  const blob = await blobGet(id);
  if (!blob) return toast('This file is not on this device yet.');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = f.name;
  document.body.appendChild(a); a.click(); a.remove();
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
    if (m >= TT.lo && m <= TT.hi) { tl.style.left = `${((m - TT.lo) / (TT.hi - TT.lo)) * 100}%`; tl.style.display = ''; }
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
/* One JSON file with everything, uploaded files included (as base64). */
async function exportBackup() {
  toast('Preparing backup…');
  const copy = JSON.parse(JSON.stringify(S));
  delete copy.fired;
  copy._blobs = {};
  let missing = 0;
  for (const f of S.files) {
    const b = await blobGet(f.id);
    if (b) copy._blobs[f.id] = await blob64(b);
    else missing++;
  }
  const blob = new Blob([JSON.stringify(copy)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `studyframe-backup-${todayISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
  toast(missing ? `Backup downloaded — ${missing} file${missing > 1 ? 's were' : ' was'} not on this device` : 'Backup downloaded');
}
function wireImporter() {
  const inp = $('#importer');
  if (!inp) return;
  inp.onchange = async () => {
    const f = inp.files[0];
    inp.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.subjects)) throw new Error('not a Studyframe backup');
      if (!confirm('Restoring replaces the notes, timetable, tasks and files on this device. Continue?')) return;
      const stored = data._blobs || {};
      delete data._blobs;
      for (const [id, b64] of Object.entries(stored)) {
        const meta = (data.files || []).find(x => x.id === id);
        const bin = atob(b64), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        await blobs.put(id, new Blob([bytes], { type: meta?.type || '' }));
      }
      const before = S;
      data.fired = {};
      S = upgrade(data);
      S.notes.forEach(n => { n.html = cleanHTML(n.html); });
      // a restore is a deliberate edit: mark every record as new so sync spreads it
      SNAP = new Map(); SNAP_SETTINGS = '';
      before.subjects && SYNCED.forEach(k => (before[k] || []).forEach(r => { if (!S[k].some(x => x.id === r.id)) S.deleted[r.id] = Date.now(); }));
      stamp();
      save();
      render();
      schedulePush();
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
    actions[act]?.(null, { dataset: { date: S.ttDate } });
  },
  upload: () => {
    closeMenu();
    const p = $('#picker');
    if (p) return p.click();
    commit(s => { s.view = 'files'; });
    setTimeout(() => $('#picker')?.click(), 60);
  },
  'sync-badge': () => {
    if (!SYNC.cfg) return commit(s => { s.view = 'settings'; });
    syncNow({ manual: true });
  },
  'sync-now': () => syncNow({ manual: true }),
  'sync-off': () => {
    if (!confirm('Stop syncing this device? Your data stays here and in the cloud copy.')) return;
    disconnectSync(); render(); toast('Sync is off on this device');
  },
  'sync-code': async () => {
    const code = setupCode();
    try { await navigator.clipboard.writeText(code); toast('Setup code copied — paste it into Settings on your other device'); }
    catch (e) {
      openSheet(`<h3>Setup code</h3><p class="hint" style="margin-bottom:12px">Copy this and paste it into Settings → Sync on your other device. It contains your access token, so only paste it into your own devices.</p>
        <textarea rows="4" readonly onclick="this.select()">${esc(code)}</textarea>
        <div class="form-actions"><span class="spacer"></span><button type="button" class="btn" data-act="close-sheet">Done</button></div>`);
    }
  },
  'sync-choice': (_, el) => { const f = SYNC.pendingFinish; SYNC.pendingFinish = null; if (f) f(el.dataset.mode); },

  /* notes ------------------------------------------------------------------ */
  'new-note': () => {
    closeSheet();
    commit(s => {
      const n = { id: uid(), subjectId: s.activeSubject, title: '', html: '', files: [], updated: Date.now(), created: Date.now() };
      s.notes.push(n); s.noteId = n.id; s.view = 'notes';
    });
    setTimeout(() => $('#noteTitle')?.focus(), 80);
  },
  'open-note': (_, el) => {
    const n = S.notes.find(x => x.id === el.dataset.id);
    if (n && n.id === S.noteId && S.view === 'notes') return;
    commit(s => { if (n) s.activeSubject = n.subjectId; s.noteId = el.dataset.id; s.view = 'notes'; });
  },
  'open-book': () => {
    const closed = $('#closedBook');
    const go = () => {
      BOOK.open = true;
      render();
      const body = $('#paperBody');
      if (body && !MOBILE && !body.textContent.trim()) { body.focus({ preventScroll: true }); }
    };
    if (!closed || reducedMotion()) return go();
    closed.classList.add('opening');
    setTimeout(go, 560);
  },
  'close-book': () => {
    const body = $('#paperBody');
    if (body) commit(s => { const n = s.notes.find(x => x.id === s.noteId); if (n) { n.html = cleanHTML(body.innerHTML); } }, { quiet: true });
    MARK.set(BOOK.id, BOOK.spread);
    BOOK.open = false;
    render();
  },
  'page-prev': () => turnTo(BOOK.spread - 1, { placeCaret: true }),
  'page-next': () => turnTo(BOOK.spread + 1, { placeCaret: true }),
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
  'task-range': (_, el) => { TASKRANGE = el.dataset.r; render(); },
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
  shift: (_, el) => commit(s => { s.ttDate = iso(addDays(parseISO(s.ttDate), Number(el.dataset.n))); }),
  today: () => commit(s => { s.ttDate = todayISO(); }),
  'goto-day': (_, el) => commit(s => { s.ttMode = 'day'; s.ttDate = el.dataset.date; s.view = 'timetable'; }),

  'new-entry': (e, el) => {
    const date = el.dataset.date || S.ttDate || todayISO();
    const wd = el.dataset.wd !== undefined ? Number(el.dataset.wd) : wdOf(parseISO(date));
    let start = '09:00';
    if (el.classList?.contains('tth-track') && e) {
      const r = el.getBoundingClientRect();
      const mins = TT.lo + ((e.clientX - r.left) / r.width) * (TT.hi - TT.lo);
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
  'xp-view-icons': () => { closeMenu(); commit(s => { s.fileView = 'icons'; }); },
  'xp-view-details': () => { closeMenu(); commit(s => { s.fileView = 'details'; }); },
  'xp-dir': () => commit(s => { s.fileSort = { ...s.fileSort, dir: -s.fileSort.dir }; }),
  'xp-sortby': (_, el) => commit(s => {
    const k = el.dataset.k;
    s.fileSort = s.fileSort.key === k ? { key: k, dir: -s.fileSort.dir } : { key: k, dir: 1 };
  }),
  'new-folder': () => {
    closeMenu();
    openSheet(textSheet({ title: 'New folder', label: 'Folder name', placeholder: 'Week 1–6 slides', form: 'new-folder', submit: 'Create folder',
      extra: `<p class="hint" style="margin-top:8px">Created inside ${esc(S.folderId ? folderName(S.folderId) : 'Files')}.</p>` }));
  },
  'xp-go': (_, el) => xpNavigate(el.dataset.id || null),
  'xp-up': () => xpNavigate(folderById(S.folderId)?.parentId || null),
  'xp-back': () => {
    if (!XP.back.length) return;
    XP.fwd.push(S.folderId);
    xpNavigate(XP.back.pop(), false);
  },
  'xp-fwd': () => {
    if (!XP.fwd.length) return;
    XP.back.push(S.folderId);
    xpNavigate(XP.fwd.pop(), false);
  },
  'xp-twist': (_, el) => {
    const id = el.dataset.id;
    if (XP.open.has(id) || isInside(S.folderId, id)) {
      XP.open.delete(id);
      if (isInside(S.folderId, id)) return xpNavigate(id);
    } else XP.open.add(id);
    render();
  },
  'xp-blank': () => { if (XP.sel.size) { XP.sel.clear(); xpSelectionUI(); } },
  'xp-item': (e, el) => {
    const key = (el.dataset.kind === 'folder' ? 'd:' : 'f:') + el.dataset.id;
    if (TOUCH && !(e && (e.ctrlKey || e.metaKey || e.shiftKey))) return xpOpenItem(el.dataset.kind, el.dataset.id);
    if (e && (e.ctrlKey || e.metaKey)) { XP.sel.has(key) ? XP.sel.delete(key) : XP.sel.add(key); }
    else if (e && e.shiftKey && XP.anchor) {
      const keys = $$('#xpPane .xp-item').map(x => (x.dataset.kind === 'folder' ? 'd:' : 'f:') + x.dataset.id);
      const a = keys.indexOf(XP.anchor), b = keys.indexOf(key);
      if (a >= 0 && b >= 0) { XP.sel = new Set(keys.slice(Math.min(a, b), Math.max(a, b) + 1)); }
    } else { XP.sel = new Set([key]); }
    if (!e?.shiftKey) XP.anchor = key;
    xpSelectionUI();
  },
  'xp-menu': (_, el) => {
    const key = (el.dataset.kind === 'folder' ? 'd:' : 'f:') + el.dataset.id;
    if (!XP.sel.has(key)) { XP.sel = new Set([key]); xpSelectionUI(); }
    const r = el.getBoundingClientRect();
    itemMenu(r.left - 160, r.bottom + 4);
  },
  'xp-open': () => {
    closeMenu();
    const k = [...XP.sel][0];
    if (k) xpOpenItem(k.startsWith('d:') ? 'folder' : 'file', k.slice(2));
  },
  'xp-download': async () => {
    closeMenu();
    const ids = [...XP.sel].filter(k => k.startsWith('f:')).map(k => k.slice(2));
    for (const id of ids) { await download(id); await new Promise(r => setTimeout(r, 250)); }
  },
  'xp-rename': () => {
    closeMenu();
    const k = [...XP.sel][0];
    if (!k) return;
    const id = k.slice(2);
    if (k.startsWith('d:')) {
      const f = folderById(id);
      if (f) openSheet(textSheet({ title: 'Rename folder', label: 'Folder name', value: f.name, form: 'rename-folder', id: f.id }));
    } else {
      const f = S.files.find(x => x.id === id);
      if (f) openSheet(textSheet({ title: 'Rename file', label: 'File name', value: f.name, form: 'rename-file', id: f.id }));
    }
  },
  'xp-move': () => {
    closeMenu();
    const keys = [...XP.sel];
    if (!keys.length) return;
    const exclude = keys.filter(k => k.startsWith('d:')).map(k => k.slice(2));
    openSheet(`<h3>Move ${keys.length === 1 ? 'this item' : `${keys.length} items`}</h3>
      <form data-form="move-items">
        <div class="field"><span>Move to</span><select name="target">${folderOptions(S.folderId, exclude)}</select></div>
        <div class="form-actions"><span class="spacer"></span>
          <button type="button" class="btn" data-act="close-sheet">Cancel</button>
          <button type="submit" class="btn btn-accent">Move here</button></div>
      </form>`);
  },
  'xp-delete': () => { closeMenu(); const keys = [...XP.sel]; if (keys.length) deleteItems(keys); },
  'rename-file': (_, el) => {
    const f = S.files.find(x => x.id === el.dataset.id);
    if (f) openSheet(textSheet({ title: 'Rename file', label: 'File name', value: f.name, form: 'rename-file', id: f.id }));
  },
  'open-file': (_, el) => openLightbox(el.dataset.id),
  'dl-file': (_, el) => download(el.dataset.id),
  'del-file': (_, el) => deleteItems(['f:' + el.dataset.id]),

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
    if (!confirm('Last check — this cannot be undone. Erase everything on this device?')) return;
    const wasSynced = !!SYNC.cfg;
    disconnectSync();
    Promise.all(S.files.map(f => blobs.del(f.id).catch(() => {}))).then(() => {
      try { [KEY, ...OLD_KEYS].forEach(k => localStorage.removeItem(k)); } catch (e) { /* fine */ }
      S = seed();
      snapshot();
      save();
      render();
      toast(wasSynced ? 'This device is erased — your cloud copy is untouched' : 'Everything erased');
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
  if (!e.target.closest('#ctx')) closeMenu();
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
      commit(s => { s.folders.push({ id: uid(), name, parentId: s.folderId && folderById(s.folderId) ? s.folderId : null, created: Date.now() }); s.view = 'files'; });
      closeSheet();
      toast('Folder created');
      break;
    }
    case 'move-items': {
      const keys = [...XP.sel];
      closeSheet();
      moveItems(keys, val('target') || null);
      XP.sel.clear();
      xpSelectionUI();
      break;
    }
    case 'sync-connect': {
      if (e.submitter && e.submitter.name === 'use') {
        const c = readSetupCode(val('code'));
        if (!c) { toast('That setup code is not valid — copy it again from the connected device.'); return; }
        connectSync(c.r, c.t);
      } else connectSync(val('repo'), val('token'));
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
  if (act === 'xp-sort') return commit(s => { s.fileSort = { key: el.value, dir: s.fileSort.dir || 1 }; });
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

/* ---------- drag files and folders between folders ---------- */
let xpDrag = null;
document.addEventListener('dragstart', e => {
  const item = e.target.closest?.('.xp-item');
  if (!item) return;
  const key = (item.dataset.kind === 'folder' ? 'd:' : 'f:') + item.dataset.id;
  if (!XP.sel.has(key)) { XP.sel = new Set([key]); xpSelectionUI(); }
  xpDrag = [...XP.sel];
  e.dataTransfer.setData('application/x-studyframe', xpDrag.join(','));
  e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragend', () => { xpDrag = null; $$('.drop-into').forEach(x => x.classList.remove('drop-into')); });
document.addEventListener('dragover', e => {
  if (!xpDrag) return;
  const t = e.target.closest?.('[data-drop]');
  $$('.drop-into').forEach(x => { if (x !== t) x.classList.remove('drop-into'); });
  if (!t) return;
  const target = t.dataset.drop || null;
  if (xpDrag.includes('d:' + target)) return;
  e.preventDefault();
  t.classList.add('drop-into');
});
document.addEventListener('drop', e => {
  if (!xpDrag) return;
  const t = e.target.closest?.('[data-drop]');
  if (!t) return;
  e.preventDefault();
  const keys = xpDrag; xpDrag = null;
  moveItems(keys, t.dataset.drop || null);
  XP.sel.clear();
});

/* ---------- double-click, right-click and long-press in the file explorer ---------- */
document.addEventListener('dblclick', e => {
  const item = e.target.closest('.xp-item');
  if (!item || e.target.closest('.xp-more')) return;
  xpOpenItem(item.dataset.kind, item.dataset.id);
});
document.addEventListener('contextmenu', e => {
  const item = e.target.closest('.xp-item');
  if (item) {
    e.preventDefault();
    const key = (item.dataset.kind === 'folder' ? 'd:' : 'f:') + item.dataset.id;
    if (!XP.sel.has(key)) { XP.sel = new Set([key]); xpSelectionUI(); }
    return itemMenu(e.clientX, e.clientY);
  }
  if (e.target.closest('#xpPane')) { e.preventDefault(); XP.sel.clear(); xpSelectionUI(); blankMenu(e.clientX, e.clientY); }
});
let pressT = null;
document.addEventListener('touchstart', e => {
  const item = e.target.closest('.xp-item');
  if (!item) return;
  const t = e.touches[0];
  pressT = setTimeout(() => {
    pressT = 'fired';
    const key = (item.dataset.kind === 'folder' ? 'd:' : 'f:') + item.dataset.id;
    XP.sel = new Set([key]); xpSelectionUI();
    itemMenu(t.clientX, t.clientY);
  }, 520);
}, { passive: true });
['touchend', 'touchmove', 'touchcancel'].forEach(ev => document.addEventListener(ev, e => {
  if (pressT === 'fired' && ev === 'touchend') { e.preventDefault(); pressT = null; return; }
  if (pressT && pressT !== 'fired') clearTimeout(pressT);
  pressT = null;
}, { passive: false }));
window.addEventListener('scroll', closeMenu, true);
window.addEventListener('resize', closeMenu);

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
    if ($('#ctx')) return closeMenu();
    if (!$('#lightbox').hidden) return closeLightbox();
    if (!$('#sheet').hidden) return closeSheet();
  }
  if (e.target.id === 'noteTitle' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); return actions['open-book'](); }
  if (e.target.classList?.contains('cover') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); return actions['open-book'](); }
  if (S.view === 'files' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && $('#sheet').hidden) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && XP.sel.size) { e.preventDefault(); return deleteItems([...XP.sel]); }
    if (e.key === 'Enter' && e.target.classList?.contains('xp-item')) { e.preventDefault(); return xpOpenItem(e.target.dataset.kind, e.target.dataset.id); }
    if (e.key === 'F2' && XP.sel.size === 1) { e.preventDefault(); return actions['xp-rename'](); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && $('#lightbox').hidden) {
      e.preventDefault();
      XP.sel = new Set($$('#xpPane .xp-item').map(x => (x.dataset.kind === 'folder' ? 'd:' : 'f:') + x.dataset.id));
      return xpSelectionUI();
    }
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
   15 — cloud sync through a private GitHub repository
   A static site has no server of its own, so the shared copy lives in a
   private repository you own. Each device keeps working offline from its own
   storage and, when it can, merges with that copy:
     studyframe/state.json      notes, timetable, tasks, folders, certificates
     studyframe/files/<id>      each uploaded file
   Merging is per record — the newer edit of a note, task or class wins, and
   deletions travel as tombstones — so two devices never overwrite each other
   wholesale. The access token stays in this browser's storage only.
   ============================================================================= */
const SYNC_KEY = 'studyframe.sync';
const STATE_PATH = 'studyframe/state.json';
const FILES_DIR = 'studyframe/files';
const MAX_SYNC_FILE = 40 * 1048576;
const SYNC = { cfg: null, busy: false, again: false, status: 'off', msg: '', last: 0, timer: null, skipped: new Set() };
try { SYNC.cfg = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null'); } catch (e) { SYNC.cfg = null; }
if (SYNC.cfg && !(SYNC.cfg.owner && SYNC.cfg.repo && SYNC.cfg.token)) SYNC.cfg = null;
try { SYNC.last = Number(localStorage.getItem(SYNC_KEY + '.last')) || 0; } catch (e) { /* fine */ }
if (SYNC.cfg) SYNC.status = 'idle';

/* ---------- GitHub contents API ---------- */
const enc64 = str => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const dec64 = b64 => {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};
const blob64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

class GHError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function gh(path, opts = {}, cfg = SYNC.cfg) {
  const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method: opts.method || 'GET',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: opts.accept || 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) { throw new GHError(0, 'Offline — will try again shortly.'); }
  if (res.status === 404 && opts.allow404) return null;
  if (!res.ok) {
    let m = '';
    try { m = (await res.json()).message || ''; } catch (e) { /* no body */ }
    const why = res.status === 401 ? 'The token was refused. Check it has not expired.'
      : res.status === 403 ? (/rate limit/i.test(m) ? 'GitHub rate limit reached — sync resumes in a few minutes.' : 'The token cannot write to that repository. Give it Contents: Read and write.')
        : res.status === 404 ? 'Repository not found. Check the name and that the token can see it.'
          : `GitHub said: ${m || res.status}`;
    throw new GHError(res.status, why);
  }
  return opts.raw ? res : (res.status === 204 ? null : res.json());
}
const contentPath = p => `/contents/${p.split('/').map(encodeURIComponent).join('/')}`;

async function ghGetState() {
  const meta = await gh(contentPath(STATE_PATH), { allow404: true });
  if (!meta) return null;
  let text;
  if (meta.content && meta.encoding === 'base64') text = dec64(meta.content);
  else text = await (await gh(contentPath(STATE_PATH), { accept: 'application/vnd.github.raw+json', raw: true })).text();
  return { sha: meta.sha, data: JSON.parse(text) };
}
async function ghPutState(payload, sha) {
  const r = await gh(contentPath(STATE_PATH), {
    method: 'PUT',
    body: { message: `Studyframe sync ${new Date().toISOString()}`, content: enc64(JSON.stringify(payload)), ...(sha ? { sha } : {}) },
  });
  return r?.content?.sha;
}
async function ghListFiles() {
  const list = await gh(contentPath(FILES_DIR), { allow404: true });
  if (!Array.isArray(list)) return null;
  const out = new Map();
  list.forEach(x => { if (!x.name.startsWith('.')) out.set(x.name, x.sha); });
  return out;
}
async function ghGetFile(id) {
  const res = await gh(contentPath(`${FILES_DIR}/${id}`), { accept: 'application/vnd.github.raw+json', raw: true, allow404: true });
  if (!res) return null;
  const f = S.files.find(x => x.id === id);
  const b = await res.blob();
  return f?.type ? new Blob([b], { type: f.type }) : b;
}

/* ---------- merge ---------- */
function payloadOf(s) {
  const p = { v: 4, settings: s.settings, settingsAt: s.settingsAt || 0, deleted: s.deleted || {} };
  SYNCED.forEach(k => { p[k] = s[k] || []; });
  return p;
}
function mergeInto(local, remote) {
  const deleted = { ...(remote.deleted || {}) };
  Object.entries(local.deleted || {}).forEach(([id, t]) => { deleted[id] = Math.max(deleted[id] || 0, t); });
  const cutoff = Date.now() - 90 * 86400000;
  Object.keys(deleted).forEach(id => { if (deleted[id] < cutoff) delete deleted[id]; });
  const out = { deleted };
  SYNCED.forEach(k => {
    const map = new Map();
    (local[k] || []).forEach(r => map.set(r.id, r));
    (Array.isArray(remote[k]) ? remote[k] : []).forEach(r => {
      if (!r || !r.id) return;
      const mine = map.get(r.id);
      if (!mine || (r._t || 0) >= (mine._t || 0)) map.set(r.id, r);
    });
    out[k] = [...map.values()].filter(r => !(deleted[r.id] && deleted[r.id] >= (r._t || 0)));
  });
  const remoteNewer = (remote.settingsAt || 0) > (local.settingsAt || 0);
  out.settings = remoteNewer ? Object.assign({}, local.settings, remote.settings) : local.settings;
  out.settingsAt = Math.max(remote.settingsAt || 0, local.settingsAt || 0);
  return out;
}
/** Put merged shared data into S, keep this device's own view state. */
function adopt(merged) {
  SYNCED.forEach(k => { S[k] = merged[k]; });
  S.settings = merged.settings; S.settingsAt = merged.settingsAt; S.deleted = merged.deleted;
  upgrade(S);
  snapshot();
  save();
}

/* ---------- the sync loop ---------- */
function setSync(status, msg = '') {
  SYNC.status = status; SYNC.msg = msg;
  syncBadge();
  const p = $('#syncState');
  if (p) p.innerHTML = syncStateHTML();
}
function syncBadge() {
  const b = $('#syncBtn');
  if (!b) return;
  const st = SYNC.cfg ? SYNC.status : 'off';
  b.dataset.state = st;
  b.title = st === 'off' ? 'Sync is off — set it up in Settings'
    : st === 'syncing' ? 'Syncing…' : st === 'error' ? `Sync problem: ${SYNC.msg}` : `Synced ${SYNC.last ? relTime(SYNC.last) : ''}`;
  b.setAttribute('aria-label', b.title);
}

async function syncNow({ manual = false } = {}) {
  if (!SYNC.cfg) return;
  if (SYNC.busy) { SYNC.again = true; return; }
  if (!navigator.onLine) { setSync('error', 'Offline — will sync when the connection is back.'); return; }
  SYNC.busy = true;
  setSync('syncing');
  try {
    stamp();
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await ghGetState();
      const before = JSON.stringify(payloadOf(S));
      const merged = remote ? mergeInto(payloadOf(S), remote.data || {}) : payloadOf(S);
      const mergedJSON = JSON.stringify(payloadOf(merged));
      if (mergedJSON !== before) { adopt(merged); renderSafely(); }
      if (!remote || mergedJSON !== JSON.stringify(payloadOf(Object.assign({ settings: {} }, remote.data)))) {
        try { await ghPutState(payloadOf(S), remote?.sha); }
        catch (e) { if (e.status === 409 || e.status === 422) continue; throw e; }
      }
      break;
    }
    await syncFiles();
    SYNC.last = Date.now();
    try { localStorage.setItem(SYNC_KEY + '.last', String(SYNC.last)); } catch (e) { /* fine */ }
    setSync('ok');
    if (manual) toast('Everything is in sync');
  } catch (e) {
    setSync('error', e.message || 'Sync failed');
    if (manual) toast(e.message || 'Sync failed');
  } finally {
    SYNC.busy = false;
    if (SYNC.again) { SYNC.again = false; setTimeout(() => syncNow(), 400); }
  }
}

async function syncFiles() {
  let remote = await ghListFiles();
  if (!remote) {
    // keep the folder in existence, so later checks find it instead of a 404
    await gh(contentPath(`${FILES_DIR}/.keep`), { method: 'PUT', body: { message: 'Studyframe files folder', content: enc64('Uploaded files live here.') } }).catch(() => {});
    remote = new Map();
  }
  for (const f of S.files) {
    if (remote.has(f.id) || SYNC.skipped.has(f.id)) continue;
    let blob = null;
    try { blob = await blobs.get(f.id); } catch (e) { /* not on this device */ }
    if (!blob) continue;                                   // another device will upload it
    if (blob.size > MAX_SYNC_FILE) {
      SYNC.skipped.add(f.id);
      toast(`${f.name} is over ${MAX_SYNC_FILE / 1048576} MB, so it stays on this device only.`);
      continue;
    }
    await gh(contentPath(`${FILES_DIR}/${f.id}`), {
      method: 'PUT',
      body: { message: `Add ${f.name}`, content: await blob64(blob) },
    }).catch(e => { if (e.status !== 422) throw e; });       // 422: already there from another device
  }
  for (const [name, sha] of remote) {
    if (S.deleted[name] && !S.files.some(f => f.id === name)) {
      await gh(contentPath(`${FILES_DIR}/${name}`), { method: 'DELETE', body: { message: 'Remove deleted file', sha } }).catch(() => {});
    }
  }
}

const schedulePush = debounce(() => { if (SYNC.cfg) syncNow(); }, 2500);

/* ---------- connect / disconnect ---------- */
function parseRepo(str) {
  const m = String(str || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '').match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function connectSync(repoStr, token) {
  const r = parseRepo(repoStr);
  if (!r) return toast('Write the repository as owner/name, for example jen/studyframe-data.');
  token = String(token || '').trim();
  if (!token) return toast('Paste the access token as well.');
  const cfg = { ...r, token };
  setSync('syncing');
  try {
    const info = await gh('', {}, cfg);
    if (info && info.permissions && info.permissions.push === false) throw new GHError(403, 'That token can read the repository but not write to it.');
    if (info && info.private === false && !confirm('That repository is public — anyone could read your notes. Use it anyway?')) { setSync('off'); return; }
    const remote = await (async () => { const old = SYNC.cfg; SYNC.cfg = cfg; try { return await ghGetState(); } finally { SYNC.cfg = old; } })();
    const finish = mode => {
      SYNC.cfg = cfg;
      try { localStorage.setItem(SYNC_KEY, JSON.stringify(cfg)); } catch (e) { /* session only */ }
      if (mode === 'replace' && remote) {
        const d = remote.data || {};
        adopt({
          ...Object.fromEntries(SYNCED.map(k => [k, Array.isArray(d[k]) ? d[k] : []])),
          settings: Object.assign({}, S.settings, d.settings || {}),
          settingsAt: d.settingsAt || 0,
          deleted: d.deleted || {},
        });
        S.folderId = null; S.noteId = null;
        save();
      }
      closeSheet();
      render();
      syncNow({ manual: true });
    };
    if (remote) {
      const d = remote.data || {};
      const count = k => (Array.isArray(d[k]) ? d[k].length : 0);
      openSheet(`<h3>Your cloud copy already has data</h3>
        <p class="hint" style="margin-bottom:14px">It holds ${count('notes')} note${count('notes') === 1 ? '' : 's'}, ${count('tasks')} task${count('tasks') === 1 ? '' : 's'},
          ${count('classes') + count('events')} timetable entr${count('classes') + count('events') === 1 ? 'y' : 'ies'} and ${count('files')} file${count('files') === 1 ? '' : 's'}.
          This device has ${S.notes.length} note${S.notes.length === 1 ? '' : 's'} and ${S.tasks.length} task${S.tasks.length === 1 ? '' : 's'}.</p>
        <div class="choice-list">
          <button class="choice" data-act="sync-choice" data-mode="replace"><b>Use the cloud copy on this device</b><span>Best when this is your second device. What is on this device now is replaced.</span></button>
          <button class="choice" data-act="sync-choice" data-mode="merge"><b>Merge both</b><span>Keeps everything from both. Example data that each device made separately may then appear twice.</span></button>
        </div>
        <div class="form-actions"><span class="spacer"></span><button type="button" class="btn" data-act="close-sheet">Cancel</button></div>`);
      SYNC.pendingFinish = finish;
      setSync('off');
    } else finish('merge');
  } catch (e) {
    setSync('off');
    toast(e.message || 'Could not reach GitHub.');
  }
}

function disconnectSync() {
  SYNC.cfg = null;
  try { localStorage.removeItem(SYNC_KEY); } catch (e) { /* fine */ }
  setSync('off');
}

const setupCode = () => btoa(unescape(encodeURIComponent(JSON.stringify({ r: `${SYNC.cfg.owner}/${SYNC.cfg.repo}`, t: SYNC.cfg.token }))));
function readSetupCode(code) {
  try { const o = JSON.parse(decodeURIComponent(escape(atob(String(code).trim())))); return o.r && o.t ? o : null; } catch (e) { return null; }
}

function syncStateHTML() {
  if (!SYNC.cfg) return '';
  const st = SYNC.status;
  return `<span class="sync-dot" data-state="${st}"></span>
    <span>${st === 'syncing' ? 'Syncing…' : st === 'error' ? esc(SYNC.msg) : SYNC.last ? `Last synced ${esc(relTime(SYNC.last))}` : 'Connected — not synced yet'}</span>`;
}

function syncPanelHTML() {
  if (SYNC.cfg) {
    return `<section class="panel sync-panel">
      <div class="panel-h">${icon('cloud')}<h3>Sync across devices</h3><span class="spacer"></span>
        <span class="chip">${icon('check')}On</span></div>
      <p class="sync-repo">Saving to <b>${esc(SYNC.cfg.owner)}/${esc(SYNC.cfg.repo)}</b> on GitHub. Notes, timetable, tasks, files and certificates are the same on every device connected to it.</p>
      <p class="sync-state" id="syncState">${syncStateHTML()}</p>
      <div class="row" style="margin-top:12px">
        <button class="btn btn-accent" data-act="sync-now">${icon('cloud')}Sync now</button>
        <button class="btn" data-act="sync-code">${icon('link')}Copy setup code for another device</button>
        <button class="btn btn-danger" data-act="sync-off">Turn off on this device</button>
      </div>
      <p class="hint" style="margin-top:12px">It syncs on its own when you make a change, when you come back to the tab, and every minute while it is open.</p>
    </section>`;
  }
  return `<section class="panel sync-panel">
    <div class="panel-h">${icon('cloud')}<h3>Sync across devices</h3><span class="spacer"></span><span class="chip">Off</span></div>
    <p class="hint" style="margin-bottom:14px">Studyframe is a static site, so the shared copy lives in a <b>private GitHub repository of your own</b>. Set it up once, then connect each phone or laptop.</p>
    <div class="sync-grid">
      <ol class="sync-steps">
        <li><b>Make a private repository.</b> On GitHub choose <i>New repository</i>, name it e.g. <code>studyframe-data</code>, set it to <b>Private</b> and tick <i>Add a README</i>.</li>
        <li><b>Make an access token.</b> GitHub → Settings → Developer settings → Personal access tokens → <i>Fine-grained tokens</i> → Generate. Under <i>Repository access</i> pick <i>Only select repositories</i> → <code>studyframe-data</code>. Under <i>Permissions → Repository</i> set <b>Contents</b> to <b>Read and write</b>.</li>
        <li><b>Paste both here</b> and press Connect. On your other devices, use the setup code instead.</li>
      </ol>
      <form class="sync-form" data-form="sync-connect">
        <div class="field"><span>Repository</span><input type="text" name="repo" placeholder="your-name/studyframe-data" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
        <div class="field"><span>Access token</span><input type="password" name="token" placeholder="github_pat_…" autocomplete="off"></div>
        <button class="btn btn-accent" type="submit">${icon('cloud')}Connect</button>
        <hr class="hr">
        <div class="field"><span>…or a setup code from a device that is already connected</span><input type="text" name="code" placeholder="Paste setup code" autocomplete="off" spellcheck="false"></div>
        <button class="btn" type="submit" name="use" value="code">Connect with code</button>
        <p class="hint">The token is kept in this browser only and sent to nobody but GitHub.</p>
      </form>
    </div>
  </section>`;
}

/* =============================================================================
   16 — boot
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

// A file dropped anywhere outside the Files window should not make the browser leave the app.
['dragover', 'drop'].forEach(ev => addEventListener(ev, e => {
  if ([...(e.dataTransfer?.types || [])].includes('Files') && !e.target.closest?.('#xp')) e.preventDefault();
}));

addEventListener('beforeunload', save);
addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { save(); return; }
  uiTick(); remindTick();
  if (SYNC.cfg) syncNow();
});
addEventListener('online', () => { if (SYNC.cfg) syncNow(); });

let lastW = innerWidth;
addEventListener('resize', debounce(() => {
  if (S.view === 'timetable') fitTimetable();
  // phones change height when the keyboard opens; only re-lay the book on a width change
  if (S.view === 'notes' && innerWidth !== lastW) layoutBook(true);
  lastW = innerWidth;
}, 140));
mq.addEventListener('change', () => render());

render();
remindTick();
setInterval(uiTick, 1000);
setInterval(remindTick, 15000);
if (SYNC.cfg) {
  setTimeout(() => syncNow(), 300);
  setInterval(() => { if (!document.hidden) syncNow(); }, 60000);
}

