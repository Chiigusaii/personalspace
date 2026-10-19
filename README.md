# Studyframe

A study workspace that runs in the browser. Notes, timetable, tasks, files and
certificates, in one dark, keyboard-friendly app — with its own layout for
phones, and optional sync so every device shows the same data. No build step,
no framework, no server of its own — three files and a static host.

```
index.html      shell, icon sprite, overlay containers
styles.css      design tokens, components, two layouts (desk and phone)
app.js          state, views, actions — everything else
```

---

## Running it

Open `index.html`. That's it. (Or open `studyframe-preview.html`, the same app
in a single file.)

To publish on **GitHub Pages**: push these files to a repository, then
Settings → Pages → *Deploy from a branch* → `main` / `root`. The app is fully
static, so it works from any path — no base-URL configuration.

For local development, any static server will do (`python3 -m http.server`),
though opening the file directly also works.

---

## What's inside

### Home
The day as one horizontal strip — every class, event and deadline in
proportion, with a marker that tracks the current time. Beside it, a countdown
ring to whatever is next. Below, three panels: today's schedule, what to do
next (ranked, not just sorted by date), and recent notes.

### Notes — each note is a notebook
Notes sit on a shelf as little books. Pick one and you see its **cover** —
leather in the subject's colour, the title in gold, how many pages and words
it holds. Click the cover (or *Open notebook*) and it swings open onto ruled
pages.

On a laptop the book opens as a **two-page spread**; on a phone it is one page
at a time. Keep writing past the foot of a page and the text flows onto the
next one and the **page turns by itself**. Turn pages with *Previous / Next*,
the folded page corners, `PageUp` / `PageDown`, or a sideways swipe on a phone.
The line height is locked to the rule spacing so text sits on the lines.

Formatting works the way it does in a word processor: bold, italic, underline,
strikethrough, three heading levels, bulleted and numbered lists, quotes,
highlight, inline code and links. Pasted content is passed through an
allow-list sanitiser, so markup from a web page arrives as clean text with its
formatting intact and nothing else.

Files can be attached to a note and opened from the foot of the page.

### Timetable
Repeating classes and one-off events on the same grid, in three views:

| View | What it's for |
| --- | --- |
| **Week** | The whole week at a glance |
| **Day** | One column, more room per block |
| **Agenda** | A list — and where reminders are configured |

The week grid has **hours across the top and one row per day down the side**.
It is compact on purpose: it only spans the hours your week actually uses
(earliest start to latest finish) and sizes the rows so the whole week fits on
screen. On narrow windows it scrolls sideways while the day names stay put. Entries that clash sit side by side
instead of on top of each other, very short entries still get enough room to
show their name, and tasks due outside the hours shown are pinned to the left or
right edge of their day.

Reminders live here rather than in a section of their own, which makes the
difference between *a thing at a time* and *a thing to finish* legible at a
glance. Set a lead time per entry in the Agenda view, or a default for
everything in Settings. Anything with a reminder shows a bell on the grid.

### Tasks
An overview strip sits under the Focus card: a **Task progress** chart (tasks
added vs. finished, daily / weekly / monthly), a **Status overview** donut (to do,
in progress, done) and the **Upcoming** tasks for the next seven days. Every task
is a card with its subject badge, a status pill (Overdue, Due today, Due soon,
Planned, Done), a progress bar and its priority. Views replay a short entrance
animation when you change week or switch task view.

A **Focus** card puts the single hottest item up front — ranked by priority
weighted against how late it is, not by due date alone.

The **Board** has four priority lanes; drag a task between them to re-prioritise
it. The **List** view orders by date instead. Either way, tasks carry
checklists with a progress bar, so a long task shows how far in you are.

### Files — a file explorer
Back, forward and up buttons, an address bar you can click through, a folder
tree down the side, and folders inside folders. Two views — **large icons** and
**details** (name, date, type, size; click a column to sort). Click to select
(`Ctrl`/`⌘` and `Shift` for more than one), double-click to open, right-click
for Open / Download / Rename / Move to… / Delete, drag items onto a folder to
move them, and drag files from your computer onto the window to upload. Images
get real thumbnails. On a phone the tree folds away, a tap opens, and every
item has a ⋯ menu (or press and hold).

### Certificates
Each certificate carries an arc showing how much of its validity is left, going
amber then red as expiry approaches. Anything expiring soon is pulled into a
banner at the top.

---

## Two interfaces

The phone layout isn't the desktop layout squeezed. Below 760px the side rail
becomes a bottom tab bar, dialogs become bottom sheets that slide up from the
thumb, search goes full-screen, row actions stop hiding behind hover, the
notebook shows one page at a time with large page buttons, the week grid
becomes stacked day panels rather than seven unreadable columns, and the file
explorer becomes a single tap-to-open pane.

Above 760px you get the rail, a top bar with subject picker and live clock, the
two-page notebook, the full explorer window, and hover affordances throughout.

---

## Keyboard

| Key | Does |
| --- | --- |
| `⌘K` / `Ctrl K` | Search everything |
| `N` | New note |
| `1` – `6` | Jump to a section |
| `Esc` | Close a dialog, menu, lightbox or search |
| `⌘S` | Force a save (it autosaves regardless) |

In the note editor:

| Key | Does |
| --- | --- |
| `⌘B` `⌘I` `⌘U` | Bold, italic, underline |
| `⌘⇧H` | Highlight |
| `⌘K` | Insert link |
| `Tab` / `⇧Tab` | Indent / outdent a list item |
| `PageDown` / `PageUp` | Turn the page |

In Files: `Enter` opens, `F2` renames, `Delete` deletes, `Ctrl/⌘ A` selects all.

---

## The same data on every device

GitHub Pages only serves files, so there is no Studyframe server to hold your
data. Instead, sync keeps a copy in a **private GitHub repository of your own**:

1. On GitHub, create a new repository, e.g. `studyframe-data`. Make it
   **Private** and tick *Add a README*.
2. GitHub → Settings → Developer settings → Personal access tokens →
   **Fine-grained tokens** → *Generate new token*. Repository access: *Only
   select repositories* → `studyframe-data`. Permissions → Repository →
   **Contents: Read and write**. Copy the token.
3. In Studyframe, **Settings → Sync across devices**: paste `your-name/studyframe-data`
   and the token, press **Connect**.
4. Press **Copy setup code for another device**, and on your phone (or any other
   device) paste that code into the same panel and press *Connect with code*.
   When asked, choose **Use the cloud copy on this device**.

From then on each device syncs by itself — after every change, whenever you come
back to the tab, and every minute while it is open. It still works offline and
catches up when the connection returns.

- Notes, timetable, tasks, subjects, folders, certificates and settings go to
  `studyframe/state.json`; each uploaded file goes to `studyframe/files/`.
- Merging is per item: if you edit a note on the laptop and add a task on the
  phone, both survive. If the *same* item is edited on two devices, the newest
  edit wins. Deletions travel too.
- Files up to 40 MB are synced; bigger ones stay on the device they were added on.
- The token is stored only in that browser and sent only to GitHub. Treat the
  setup code like a password.
- The cloud-sync icon in the top bar shows the state (green = synced, amber =
  syncing, red = a problem — hover or open Settings for the reason). Click it to
  sync now.

## Where your data lives on each device

- **`localStorage`**, key `studyframe.v3` — notes, timetable, tasks,
  certificates, subjects and settings. Saved automatically, debounced, and
  again on page close.
- **`IndexedDB`**, database `studyframe`, store `files` — uploaded file blobs,
  which are too large for localStorage.

Without sync this is per-browser and per-device. With sync on, a new browser
only has to connect to get everything back.

**Settings → Back up** writes a single JSON file containing everything,
including the uploaded files themselves. **Restore** reads it back on any
device.

### Upgrading from an older version
Your existing data carries straight over — same storage key, upgraded in place
on first load. Old flat folders become top-level folders, "Unfiled" files sit at
the top of *Files*, and the old Compact/Roomy setting is simply dropped. Saves
under `studyframe.v2` and `studyframe.v1` are migrated too: tasks gain a
priority and a checklist, Markdown note bodies are converted to rich text, and
the old section names are mapped across (Deadlines → Tasks, Reminders →
Timetable).

---

## Browser support

Any current version of Chrome, Edge, Safari or Firefox. The app uses
`localStorage`, `IndexedDB`, CSS custom properties, CSS columns, `color-mix()`
and `matchMedia` — all widely available since 2023.

Notifications are optional. If you grant permission, reminders also arrive as
system notifications; if you don't, they appear as cards in the corner with a
short tone, and nothing breaks.

Private/incognito windows may refuse storage. The app detects this and keeps
working for the session rather than failing.

---

## Notes on the build

- No dependencies, no bundler, no transpiler. `app.js` is plain ES2020 in
  sixteen numbered sections; `styles.css` is one file with tokens at the top.
- The notebook's pages are CSS columns of one rich-text note, so the saved
  format is unchanged; the book only decides which spread is on screen.
- Views are functions that return HTML strings; a single delegated click
  handler dispatches every `data-act` to a handler in one `actions` map. Adding
  a feature means adding a view function and an entry in that map.
- Reduced-motion is respected throughout, focus rings are visible, and
  timetable and notes have print styles.
- Fonts (Instrument Sans, IBM Plex Mono, Newsreader) come from Google Fonts
  with system fallbacks, so the app stays usable offline.
