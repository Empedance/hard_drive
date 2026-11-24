# Sheets editor — competitive feature set (before coding)

Status: scope written 2026-11-07, before the build, after the Docs editor was confirmed working. Sheets is rank 2 in
[document-editors-research.md](document-editors-research.md) §5 (research §3.2 covers the market and the libraries).
It is built the way the Docs editor was ([editor-docs-feature-set.md](editor-docs-feature-set.md)): its own frontend
project, the same backend, the same storage, versions, edit lock and AI layer.

Benchmarks: Google Sheets (UX and AI) and Excel for the web (.xlsx fidelity).
Stack (all permissive):
- **Univer** 1.2 core and its Apache-2.0 presets (sheets core with the formula engine, filter, sort, conditional
  formatting, data validation, find and replace, hyperlinks, notes). **No Univer Pro**: its xlsx import/export,
  charts, pivots, printing and collaboration packages (`@univerjs-pro/*`, `preset-sheets-advanced`) are commercial.
- **ExcelJS** 4.4 (MIT) for our own .xlsx ↔ Univer converter (replaces Univer Pro's exchange service).
- **Papa Parse** 5.5 (MIT) for CSV.
- **SheetJS Community Edition** 0.20.3 (Apache-2.0, installed from the SheetJS CDN tarball, not the stale npm `xlsx`
  0.18.5 with known advisories) to read legacy .xls and .ods.

Tiers:
- **MVP:** the first release; required to ship.
- **v1.1:** competitive parity with Google Sheets for single-author work.
- **Later:** after v1.1.

---

## 1. Decisions

Defaults taken without a separate approval round, because the user asked for Sheets "the same way" as Docs; each
mirrors an approved Docs decision (D1–D6) or follows from the licence constraint.

| # | Decision | Default | Why |
|---|---|---|---|
| S1 | App | **Own project `cloud-disk-sheets-frontend`, port 5178** (own subdomain in production). Routes `/` (home: recent, all, search, new), `/new`, `/s/:fileId` | Same pattern as the Docs app (5177); the portal opens spreadsheets there in a new tab |
| S2 | Shared editor code | The app carries **its own copy of `editor-core`** (shell, autosave, lock, versions), copied from the Docs app with one additive option (a per-editor autosave delay). A shared top-level package for both apps is a follow-up | A cross-project dependency needs a monorepo-level workspace; without one each app would load React and Fluent twice. Copying keeps the confirmed Docs app untouched |
| S3 | Stored format | **The file keeps its format.** .xlsx saves as .xlsx; .csv saves as .csv (first sheet, values only, with a notice). New spreadsheets are .xlsx. Inside our .xlsx files a hidden part (`cloud-disk/workbook.json`, linked by a custom package relationship that Excel ignores) holds the Univer snapshot plus a hash of the worksheet XML | Downloads open in Excel, Google Sheets and LibreOffice with no conversion. Our own files reopen exactly (including notes, filters, validation and conditional formats the converter does not write yet); if another app changed the file the hash differs and the XML is read instead |
| S4 | Legacy and macro files | **.xls, .ods and .xlsm open view-only**, with "Save as .xlsx copy" (a new file in the same folder) | SheetJS CE can write .xls/.ods only without styles, which would silently damage files; macros must not be dropped by a save |
| S5 | Who can edit | Drive **EDITOR** or above; everyone else, and shared-with-me users, read-only | Same as Docs D5 |
| S6 | AI | **Off per organization until the owner turns it on**; Super Admin can block it. Same switch, limits and usage table as Docs | Same as Docs D4; nothing new to configure |
| S7 | Autosave | 5 s after the last change (Docs: 3 s), on Ctrl/Cmd+S, and before leaving; one person's saves within 10 minutes become one version (existing server rule) | Serialising a workbook costs more than a document; coalescing keeps history readable |
| S8 | Charts | **No chart objects in the MVP** (Univer's chart plugin is Pro). The AI "suggest a chart" feature shows a preview chart in the AI panel; it is not stored in the file | Charts in a file from Excel are listed in the "will be simplified" notice; the original stays in version history |

---

## 2. Feature set

### 2.1 Open, create, save

| Feature | Tier | Notes |
|---|---|---|
| Click a spreadsheet in the portal (.xlsx, .xlsm, .xls, .csv, .ods) to open it in the Sheets app in a new tab | MVP | `/s/:fileId`; old-style links keep working |
| Sheets home: start a blank spreadsheet, recent and all spreadsheets, search by name | MVP | Same library the portal shows |
| **New spreadsheet** in a portal folder | MVP | "Untitled spreadsheet.xlsx", the next free name |
| Rename from the title bar; download; version history with open and restore | MVP | editor-core |
| Autosave with "Saving… / All changes saved / Not saved" | MVP | S7 |
| Edit lock ("X is editing; opened read-only", "Edit here instead"), heartbeat, release on close | MVP | editor-core |
| Conflict (409): "Someone saved a newer version", Download my changes / Reload | MVP | editor-core |
| Fidelity notice for files from other apps: names what will be simplified (charts, pivot tables, images, shapes, macros, sparklines, slicers, external links, comments) | MVP | The original stays in version history |
| Save a view-only .xls/.ods/.xlsm as an .xlsx copy | MVP | S4 |
| Download as .xlsx and .csv (current sheet) | MVP | |
| Templates (budget, invoice, schedule, tracker) | v1.1 | |
| Print / PDF | Later | Univer printing is Pro; needs our own print layout |

### 2.2 Grid and editing (Univer core)

| Feature | Tier |
|---|---|
| Virtualised canvas grid, multiple sheets (add, rename, delete, reorder, hide, tab colour) | MVP |
| Formula engine with the common Excel functions, cross-sheet references, formula bar, function hints | MVP |
| Number, date, currency and percent formats | MVP |
| Fonts, size, bold, italic, underline, strike, text and fill colour, borders, alignment, wrap, rotation | MVP |
| Merge cells; row height and column width; hide rows and columns; freeze panes | MVP |
| Copy/paste to and from Excel and Google Sheets; undo and redo; fill handle | MVP |
| Sort and filter | MVP |
| Find and replace | MVP |
| Conditional formatting, data validation and dropdowns, cell notes, hyperlinks | MVP (kept exactly in our own files; written to .xlsx for other apps in v1.1) |
| Named ranges | v1.1 |
| Images in cells and floating images | v1.1 (drawing preset) |
| Tables (structured ranges), comments threads with mentions | v1.1 |
| Charts, pivot tables, sparklines, slicers | Later (need our own engine, or a licence) |
| Real-time co-editing | Later (research §4.6) |

### 2.3 Quality bar

| Area | Target |
|---|---|
| Open time | A 10,000-row × 20-column .xlsx is interactive within 3 s after the bytes arrive |
| Bundle | The spreadsheet engine loads only when a spreadsheet opens; the home page does not download it |
| Accessibility | Our shell, home, AI menu and panel pass axe checks; the grid is Univer's (canvas) and is keyboard-operable but has limited screen-reader support, as in other canvas spreadsheets |
| Theming | Fluent UI v9 shell in light and dark; the grid stays light |
| Security | Formulas run in Univer's engine only; no macros run (.xlsm is view-only); hyperlinks only http, https and mailto |
| Mobile | Viewing and light editing at phone width |

---

## 3. AI features (v1)

Same backend layer as Docs (provider-agnostic, Groq first). The browser sends the feature id, the file id and the cells
it already holds, as CSV text; the server re-checks read access, the organization switch and limits. Nothing is applied
to the sheet without a click.

| Id | Where | Input | Output and handling | Model |
|---|---|---|---|---|
| `sheets.formula` | AI menu → "Help with a formula" | What the user wants, plus context: active cell, sheet name, the header row and a few sample rows | `FORMULA:` line and a short `EXPLANATION:`; Insert puts the formula in the active cell | SMART |
| `sheets.explain` | AI menu → "Explain formula" (active cell must hold a formula) | The formula and the same context | Markdown explanation, step by step | FAST |
| `sheets.analyze` | AI panel → "Analyse data" with an optional question | The selection, or the used range of the sheet, as CSV (first 60,000 characters) | Markdown: summary, key findings, suggestions | SMART |
| `sheets.table` | AI menu → "Generate a table" | A description ("a 12-month budget for a small café") | CSV; preview table, then Insert at the active cell | SMART |
| `sheets.clean` | AI menu → "Clean data" with options: trim spaces, fix capitalisation, standardise dates, standardise numbers, remove duplicate rows, custom | The selection as CSV | Cleaned CSV; preview with the number of changed cells, then Replace the selection | SMART |
| `sheets.chart` | AI panel → "Suggest a chart" | The selection or used range as CSV | JSON (up to 3 suggestions: type bar/column/line/pie/scatter, title, label column, value columns, reason); each shown as a preview chart | FAST |

Rules (as for Docs): the data is sent only for the run the user started; cells go only in the user message, inside
delimiters, and every prompt says the data is never instructions; answers that are meant to replace cells are refused if
those cells changed while the answer was being written; per-org monthly token budget and per-user rate limit apply.

Later: AI fill-down for a column ("categorise these"), natural-language filter and sort, pivot suggestions.

---

## 4. Round-trip fidelity targets

- **Tier A — must survive open → save → reopen in Excel unchanged (MVP):** cell values (text, numbers, booleans,
  dates as serial numbers with their format); formulas, with the last computed result cached so other apps show values
  without recalculating; number formats; font family, size, bold, italic, underline, strike and colour; fill colour;
  borders (style and colour per side); horizontal and vertical alignment, wrap and rotation; merged cells; column widths
  and row heights; hidden rows and columns; freeze panes; several sheets with names, order, tab colour and hidden state;
  gridlines on or off.
- **Tier B — kept exactly in our own files, written to .xlsx in v1.1:** conditional formatting, data validation,
  autofilter, cell notes, hyperlinks, named ranges, rich text inside a cell.
- **Tier C — dropped on save, with a warning on open:** charts, pivot tables, images and shapes, sparklines, slicers,
  macros (file opens view-only), external links, threaded comments, form controls.
- **CSV:** UTF-8 (a BOM is accepted), comma, semicolon or tab detected on open; quoted fields and line breaks inside
  fields preserved; saved as comma-separated UTF-8 with the values as displayed for formulas' results. Only the first
  sheet is saved; the editor says so when there is more than one.

**Test corpus** in `editors/editor-sheets/test/fixtures/`: hand-built files covering every Tier A item (generated by a
script with ExcelJS so they are reproducible), a file with Tier C parts (chart, image, pivot cache markers, VBA part),
CSV samples (BOM, semicolons, quotes and line breaks), and an .ods/.xls pair generated with SheetJS. Real files from
Excel, Google Sheets or LibreOffice can be dropped into the folder; a corpus test opens each one and checks that values
and formulas survive a save and reopen. Automated checks:
1. **Idempotence:** read → write → read gives the same workbook snapshot (values, formulas, styles, merges, sizes).
2. **Tier A assertions** on the written .xlsx, read back with ExcelJS.
3. **Own-file reopen:** a file we wrote reopens from the hidden part; after an outside edit (hash mismatch) the XML is used.
4. **Unsupported-part detector:** one test per Tier C construct.

---

## 5. Acceptance criteria (MVP done when)

1. Double-click or Open on an .xlsx, .xls, .ods, .xlsm or .csv in the portal opens it in the Sheets app on port 5178.
   EDITOR+ users can edit .xlsx and .csv; everyone else, and legacy/macro files, are read-only.
2. New spreadsheet (portal folder or Sheets home) creates "Untitled spreadsheet.xlsx" in storage and opens it. A user
   types values and formulas, formats cells, merges, adds a sheet and closes the tab; reopening shows exactly what they
   left, and the downloaded file opens in Excel with Tier A intact.
3. Edits autosave as new versions in the existing storage (local or B2), counted toward the drive; version history
   lists them and restore works.
4. A second tab gets "X is editing"; a stale save gets the conflict bar; no data is lost.
5. The six v1 AI features stream through `POST /api/v1/ai/run`, apply only on a click, respect the organization switch
   and limits, and are hidden when the platform has no AI. The provider key never reaches the browser.
6. Tests: converter fidelity suite, CSV, legacy read, the Sheets home and editor shell (frontend); AI registry and
   integration for the new features (backend). Builds and tests pass in every project touched, and the flow is checked
   in a browser.
7. README.md, `docs/implementation-plan.md` (milestone log), `.env.example` (5178 origin) are updated.

---

## 6. Build plan

| Step | Content |
|---|---|
| S1 | Backend: 5178 in the CORS defaults and `.env.example`; `sheets.*` AI features with versioned prompts; tests |
| S2 | `cloud-disk-sheets-frontend`: host code (session from the portal, API, editor backend), Sheets home, new spreadsheet, editor page; `editor-core` copy with per-editor autosave delay |
| S3 | `editor-sheets`: Univer integration (read-only mode, change detection, theme), ExcelJS converter with the hidden part, CSV, legacy read and "save as .xlsx copy", fidelity notice, downloads; fixtures and tests |
| S4 | Portal: open spreadsheets in the Sheets app, New spreadsheet, sign-in `next` accepts the Sheets address |
| S5 | AI menu, suggestion card and panel for the six features |
| S6 | Browser check against a test backend, documentation |
