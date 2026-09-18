# Studyframe

A study workspace that runs entirely in the browser. Notes, timetable, tasks,
files and certificates, in one dark, keyboard-friendly app. No build step, no
framework, no server, no account — three files and a static host.

```
index.html      shell, icon sprite, overlay containers
styles.css      design tokens, components, two layouts (desk and phone)
app.js          state, views, actions — everything else
```

---

## Running it

Open `index.html`. That's it.

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

### Notes
The one page that isn't dark. Writing happens on warm ruled paper with a red
margin rule, and the line height is locked to the rule spacing so text sits on
the lines rather than floating between them.

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

Two densities. **Compact** measures the earliest start and latest end across
the week and scales the hour height so everything fits the viewport with no
scrolling. **Roomy** uses the full day range from settings with taller rows.

Reminders live here rather than in a section of their own, which makes the
difference between *a thing at a time* and *a thing to finish* legible at a
glance. Set a lead time per entry in the Agenda view, or a default for
everything in Settings. Anything with a reminder shows a bell on the grid.

### Tasks
A **Focus** card puts the single hottest item up front — ranked by priority
weighted against how late it is, not by due date alone.

The **Board** has four priority lanes; drag a task between them to re-prioritise
it. The **List** view orders by date instead. Either way, tasks carry
checklists with a progress bar, so a long task shows how far in you are.

### Files
Folders down one side, a drop zone, and a grid or list of everything stored.
Images get real thumbnails; everything else gets a type-coloured tile. Click to
preview in a lightbox, or download.

### Certificates
Each certificate carries an arc showing how much of its validity is left, going
amber then red as expiry approaches. Anything expiring soon is pulled into a
banner at the top.

---

## Two interfaces

The phone layout isn't the desktop layout squeezed. Below 760px the side rail
becomes a bottom tab bar, dialogs become bottom sheets that slide up from the
thumb, search goes full-screen, row actions stop hiding behind hover, and the
week grid becomes stacked day panels rather than seven unreadable columns.

Above 760px you get the rail, a top bar with subject picker and live clock, and
hover affordances throughout.

---

## Keyboard

| Key | Does |
| --- | --- |
| `⌘K` / `Ctrl K` | Search everything |
| `N` | New note |
| `1` – `6` | Jump to a section |
| `Esc` | Close a dialog, lightbox or search |
| `⌘S` | Force a save (it autosaves regardless) |

In the note editor:

| Key | Does |
| --- | --- |
| `⌘B` `⌘I` `⌘U` | Bold, italic, underline |
| `⌘⇧H` | Highlight |
| `⌘K` | Insert link |
| `Tab` / `⇧Tab` | Indent / outdent a list item |

---

## Where your data lives

Everything stays on your device. Nothing is uploaded anywhere.

- **`localStorage`**, key `studyframe.v3` — notes, timetable, tasks,
  certificates, subjects and settings. Saved automatically, debounced, and
  again on page close.
- **`IndexedDB`**, database `studyframe`, store `files` — uploaded file blobs,
  which are too large for localStorage.

Because this is browser storage, it is per-browser and per-device. A different
browser, or clearing site data, means starting fresh.

**Settings → Back up** writes a single JSON file containing everything,
including file contents. **Restore** reads it back. Worth doing before you
clear anything.

### Upgrading from an older version
Saves under `studyframe.v2` and `studyframe.v1` are migrated automatically on
first load: tasks gain a priority and a checklist, Markdown note bodies are
converted to rich text, and the old section names are mapped across
(Deadlines → Tasks, Reminders → Timetable). The old key is left untouched, so
nothing is destroyed if you want to go back.

---

## Browser support

Any current version of Chrome, Edge, Safari or Firefox. The app uses
`localStorage`, `IndexedDB`, CSS custom properties, `color-mix()` and
`matchMedia` — all widely available since 2023.

Notifications are optional. If you grant permission, reminders also arrive as
system notifications; if you don't, they appear as cards in the corner with a
short tone, and nothing breaks.

Private/incognito windows may refuse storage. The app detects this and keeps
working for the session rather than failing.

---

## Notes on the build

- No dependencies, no bundler, no transpiler. `app.js` is plain ES2020 in
  fifteen numbered sections; `styles.css` is one file with tokens at the top.
- Views are functions that return HTML strings; a single delegated click
  handler dispatches every `data-act` to a handler in one `actions` map. Adding
  a feature means adding a view function and an entry in that map.
- Reduced-motion is respected throughout, focus rings are visible, and
  timetable and notes have print styles.
- Fonts (Instrument Sans, IBM Plex Mono, Newsreader) come from Google Fonts
  with system fallbacks, so the app stays usable offline.
