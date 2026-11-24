# Docs editor — competitive feature set (before coding)

Status: scope proposal, not built. Written 2026-11-06 after the user chose Docs as the first editor (see the ranked
shortlist in [document-editors-research.md](document-editors-research.md) §5). The architecture, backend additions, and
AI layer design are in that document's §4 and are not repeated here.

Benchmarks: Google Docs (UX and AI) and Word for the web (.docx fidelity).
Stack: Tiptap core (MIT) on ProseMirror, `docx` (MIT) for export, and mammoth (BSD-2) for import in the MVP. Our own
OOXML importer (JSZip and fast-xml-parser, MIT) replaces mammoth in v1.1.

Tiers:
- **MVP:** the first release users get; required to ship.
- **v1.1:** competitive parity with Google Docs for single-author and review workflows.
- **Later:** after v1.1.

---

## 1. Decisions

**Approved 2026-11-06 ("Approve defaults"): D1–D6 as recommended below.** *Correction 2026-11-07: the editor is its own app, `cloud-disk-docs-frontend` (own port and subdomain), with a Docs home (recent, search, new); paths in this document that say `cloud-disk-frontend/editors/` now mean `cloud-disk-docs-frontend/editors/`.*

| # | Decision | Recommended default | Why |
|---|---|---|---|
| D1 | Stored file format | **Always .docx.** New documents are created as `.docx`. We add a hidden part (`cloud-disk/editor.json`, linked by a custom package relationship that other apps ignore) holding our editor JSON plus a hash of `word/document.xml` | Downloads open in Word, Google Docs, and LibreOffice with no conversion. If the hash still matches on reopen, our own documents reopen losslessly. If Word changed the file, the hash differs and we parse the OOXML instead |
| D2 | Layout | **Page view** (A4/Letter pages, margins, page breaks) in the MVP. Pageless mode comes in v1.1 | Users opening .docx expect pages. Google Docs offers both |
| D3 | Comments and suggesting mode | **v1.1, not the MVP** | They need a DB-backed comment model and a "commenter" share role, which would add about 3 weeks to the MVP |
| D4 | AI availability | **Off per organization until the owner turns it on.** Super Admin can force it off | File content is sent to Groq when a user runs an AI action |
| D5 | Who can edit | Drive **EDITOR** or above. VIEWER and CONTRIBUTOR, and shared-with-me users, open the document read-only (shares have no edit role until v1.1) | Matches the existing permission model |
| D6 | Accessibility, fonts, documentation, final build. **Done 2026-11-07**, trimmed on request to save effort: automated accessibility checks and fixes and self-hosted fonts are done; the planned performance measurement on large documents and the light/dark look in a browser were **not** done | 0.5 wk |

---

## 2. Feature set

### 2.1 Open, create, save

| Feature | Tier | Notes |
|---|---|---|
| Click a .docx in the portal to open it at `/open/:fileId` | MVP | The registry picks Docs; other types fall back to preview or download |
| Read-only view with a loading preview for viewers | MVP | Users without edit rights see the document with no toolbar and a "View only" badge |
| **New → Document** in the portal (blank .docx in the current folder) | MVP | Name it "Untitled document", with inline rename in the title bar |
| Rename from the title bar | MVP | Uses the existing `PATCH /files/{id}` |
| Autosave (2–5 s after the last change, plus on blur and before unload), with a "Saving… / Saved / Offline" status | MVP | Editor saves by the same user within 10 minutes are coalesced into one version |
| Version history drawer: list, preview, restore (as a new version), "save a copy" | MVP | Backend `file_versions` |
| Conflict handling: a 409 on a stale save offers Reload / Save as copy | MVP | `baseNodeVersion` check |
| Edit lock: "Asha is editing; open read-only?", with heartbeat and release on close | MVP | Single writer until real-time co-editing |
| Unsaved-changes guard and offline retry queue (in memory) | MVP | |
| Open .odt and .rtf | Later | Convert on import |
| Templates gallery (letter, report, resume, meeting notes) | v1.1 | Built-in .docx templates |
| Make a copy, move, and share from inside the editor | v1.1 | Reuses the portal dialogs |

### 2.2 Text and paragraph formatting

| Feature | Tier |
|---|---|
| Undo and redo (deep history), with standard shortcuts (Ctrl/Cmd+B/I/U/K/Z/Y, etc.) | MVP |
| Paragraph styles: Normal text, Title, Subtitle, Heading 1–6 (mapped to Word's built-in styles) | MVP |
| Font family, size, bold, italic, underline, strikethrough, superscript, subscript | MVP |
| Text colour and highlight colour | MVP |
| Clear formatting and the paint-format brush | MVP (clear) / v1.1 (paint brush) |
| Alignment (left, centre, right, justify), line and paragraph spacing, indent and outdent | MVP |
| Bulleted, numbered, and multilevel lists; checklists | MVP |
| Markdown-style shortcuts (`# `, `- `, `1. `, `**bold**`, `---`) | MVP |
| Links (insert, edit, remove, open), with a link preview card | MVP (card in v1.1) |
| Special characters and emoji picker | MVP |
| Custom styles (edit and update "Heading 1" to match the selection) | v1.1 |
| Columns, drop cap, text boxes | Later |

### 2.3 Inserting content

| Feature | Tier | Notes |
|---|---|---|
| Images: upload, paste, drag-drop; resize; inline or wrapped alignment; alt text | MVP (wrap modes in v1.1) | Images live inside the .docx (media parts), not in separate storage |
| Tables: insert grid, add or remove rows and columns, merge and split cells, header row, resize columns, cell background, borders | MVP (borders in v1.1) | |
| Horizontal line, page break | MVP | |
| Headers and footers, page numbers, different first page | v1.1 | Simple headers and footers are kept on import in the MVP, but are not editable |
| Table of contents (generated from headings, with an update button) | v1.1 | Exported as a real Word TOC field |
| Footnotes and endnotes | v1.1 | |
| Equations, drawings, charts, smart chips (people, dates, files), bookmarks | Later | |

### 2.4 Layout and navigation

| Feature | Tier |
|---|---|
| Page view with page size (A4, Letter, Legal), margins, orientation (page setup dialog) | MVP |
| Zoom (50–200%), full-screen / focus mode | MVP |
| Document outline sidebar (heading navigation) | MVP |
| Find and replace (case, whole word, regex) | MVP |
| Word, character, and page count | MVP |
| Ruler with indent handles | v1.1 |
| Pageless mode | v1.1 |
| Document tabs (Google Docs tabs) | Later |

### 2.5 Review and collaboration

| Feature | Tier | Notes |
|---|---|---|
| Comments: threads, replies, resolve and reopen, anchored to a range; a "commenter" role | v1.1 | Stored in the DB while live, written to `word/comments.xml` on save; Word comments are imported |
| @mentions in comments, with email notification | v1.1 | Uses the existing `EmailService` |
| Suggesting mode (track changes): accept or reject, round-tripped as `w:ins`/`w:del` | v1.1 | |
| Share with "can edit" (`node_shares.role`) | v1.1 | |
| Real-time co-editing, presence cursors, offline editing | Later | Yjs (research §4.6) |

### 2.6 Export and print

| Feature | Tier | Notes |
|---|---|---|
| Download as .docx (the stored file) | MVP | |
| Download as PDF | MVP | Rendered by the browser's print engine from the page view with print CSS. Server-side PDF later |
| Print | MVP | |
| Download as Markdown and as plain text | MVP | |
| Download as .odt and HTML | Later | |

### 2.7 Paste and import quality

| Feature | Tier |
|---|---|
| Paste from Word, Google Docs, and web pages: keep headings, lists, tables, links, bold, italic, and images; strip junk styles and scripts | MVP |
| "Paste without formatting" (Ctrl/Cmd+Shift+V) | MVP |
| Import fidelity notice: detects unsupported parts and shows "Some features will be simplified when saved" with "Save as copy" | MVP |
| Own OOXML importer (styles, fonts, colours, exact spacing, numbering definitions, section page settings) replacing mammoth | v1.1 |

### 2.8 Quality bar (non-functional)

| Area | Target |
|---|---|
| Open time | A 50-page .docx is interactive in under 2 s after the bytes arrive (mid-range laptop) |
| Typing latency | Under 16 ms per keystroke in a 100-page document |
| Bundle | The Docs chunk loads only when a document opens; under 600 KB gzipped, excluding fonts |
| Accessibility | WCAG 2.2 AA; the full toolbar works by keyboard; screen-reader-labelled controls; visible focus |
| Theming | Fluent UI v9 tokens, light and dark. The page stays white in dark mode, as in Google Docs |
| Mobile | Viewing on phone widths; light editing with a collapsed toolbar |
| Security | No script execution from document content; sanitised paste; macro files (.docm) open read-only |
| Spell check | The browser's built-in spell check in the MVP; AI grammar fix as the upgrade |

---

## 3. AI features

Each feature is a registry entry on the backend (research §4.4) with an id, a prompt template, a model tier, and token
caps. The browser sends only the feature id, the node id, and the selected or nearby text.

### MVP

| Id | Where | What it does | Output handling |
|---|---|---|---|
| `docs.write` | "Help me write" button on an empty document, or at the cursor | Drafts content from the user's prompt (with an optional length and tone) | Streams into a preview card, then Insert / Replace / Try again / Discard |
| `docs.rewrite` | Selection toolbar → AI menu | Improve writing; make shorter; make longer; simplify; change tone (professional, casual, friendly, confident); custom instruction | Diff preview (strikethrough and insert), then Accept / Discard |
| `docs.proofread` | Selection toolbar and the AI menu | Fixes spelling, grammar, and punctuation, keeping meaning and formatting | Same diff preview |
| `docs.translate` | Selection toolbar | Translates the selection into a chosen language | Replace, or insert below |
| `docs.continue` | AI menu, or a shortcut at the cursor | Continues writing from the preceding text | Ghost text; Tab accepts, Esc dismisses |
| `docs.summarize` | AI side panel | Summary of the whole document: a TL;DR, key points, and action items | Panel, with an "Insert at cursor" button |
| `docs.ask` | AI side panel (chat) | Q&A about this document; each answer quotes the paragraphs it used, and clicking a quote scrolls to it | Panel |

Rules:
- Model output is never applied without a click.
- Formatting is preserved: the editor sends structured text (paragraph boundaries and marks), and the model returns
  Markdown, which we convert back.
- Long documents are chunked (map-reduce) for summarise and ask.
- Every run counts toward the per-org monthly token budget and per-user rate limit. When a limit is hit the UI says so
  plainly.

### v1.1

| Id | What |
|---|---|
| `docs.proofread_document` | Proofreads the whole document, delivered as suggestions in suggesting mode |
| `docs.outline` | Generates an outline or headings from a topic or the current text |
| `docs.table` | "Make a table from this text" |
| `docs.translate_document` | Translates the whole document into a new copy |
| `docs.title` | Suggests a title and file name for "Untitled document" |

### Later

Drafting from other files in the drive (needs embeddings and retrieval through a second provider), image
generation (needs a provider other than Groq), and voice dictation.

---

## 4. .docx fidelity targets

- **Tier A, must survive open → save → reopen in Word with no visible change:** paragraph text; built-in heading,
  title, and normal styles; bold, italic, underline, strike, sub, and sup; font family, size, and colour; highlight;
  alignment; spacing and indents; bulleted, numbered, and multilevel lists; tables with merges, widths, and header
  rows; inline images with size; links; page breaks; page size, margins, and orientation.
- **Tier B, kept in v1.1:** headers and footers, page numbers, comments, track changes, footnotes, TOC, cell
  borders and shading, custom styles, section breaks.
- **Tier C, simplified, with a warning shown on open:** text boxes and shapes, SmartArt, charts, embedded OLE objects,
  fields other than page number and TOC, content controls, mixed-orientation sections, macros.

**Test corpus:** at least 40 fixtures under `cloud-disk-frontend/editors/editor-docs/test/fixtures/`, including files
saved by Word, Google Docs, and LibreOffice, plus anonymised real-world samples (contracts, resumes, reports, tables,
long documents). Automated checks:
1. **Idempotence:** import → export → import gives the same editor JSON.
2. **Tier A preservation:** assertions per element type on the exported XML.
3. **Visual diff:** a subset rendered with docx-preview before and after a save, compared with Playwright screenshots
   within a tolerance.
4. **Unsupported-feature detector:** unit tests per Tier C construct.

---

## 5. Acceptance criteria (MVP is done when)

1. Clicking a .docx in any drive view opens it in the editor in under 2 s for a 50-page file. EDITOR+ users can edit;
   everyone else sees it read-only.
2. A user can create a new document, type, format, add a table and an image, and close the tab. Reopening it shows
   exactly what they left, and Word opens the downloaded file with Tier A intact.
3. Two tabs on the same file: the second gets the "is editing" notice. A stale save gets a 409 and offers
   reload / copy. No data is lost in either case.
4. Version history lists the saves; restoring an old version creates a new version; the original upload is always
   recoverable.
5. All seven MVP AI features stream responses, can be accepted or discarded, respect the org switch and limits, and
   never send the Groq key to the browser. With `AI_PROVIDER=none` the AI UI is hidden.
6. Backend unit and integration tests cover versions, conflicts, locks, permissions, quota on save, and the AI
   proxy (with a stub provider). Frontend tests cover the converter (fidelity suite) and the editor shell. Both builds
   pass.
7. README.md, `docs/implementation-plan.md` (milestone log), and `.env.example` (the `GROQ_API_KEY` placeholder) are
   updated.

---

## 6. Build plan (about 8 weeks for the MVP)

| Step | Content | Est. |
|---|---|---|
| D1 | Backend foundation: `V15` migration (`file_versions`, `edit_sessions`, upload session REPLACE mode); `GET /files/{id}/content` (inline presign); version create, list, and restore with the 409 check; edit-lock endpoints; quota on save; audit; tests | 1.5 wk |
| D2 | Editor packages (npm workspace in `cloud-disk-frontend/editors/`); `editor-core` (shell, `EditorModule` registry, file I/O, autosave, lock heartbeat, version drawer); `/open/:fileId` route and the preview fallback. **Done 2026-11-06.** New → Document moved to D4, because creating a blank .docx needs the .docx writer | 1 wk |
| D3 | `editor-docs` editing core: Tiptap schema, Fluent toolbar, styles, lists, tables, images, page view and page setup, find and replace, outline, paste cleaning. **Done 2026-11-06**, with part of D4 brought forward so documents can be saved: .docx export (`docx`), import (mammoth, page settings from the XML), the hidden JSON part with its hash, and the notice about what Word features get simplified | 2 wk |
| D4 | New → Document; our own OOXML reader (fonts, colours, alignment, spacing, indent, styles, lists, links, images, tables with merges); Markdown, plain-text and PDF (print) export; a drop-in folder for real Word / Google Docs / LibreOffice test files; one-row scrolling toolbar on phones. **Done 2026-11-07.** Not done: tests against real Word files (none available on this machine; hand-built Word-style files are used), and true pagination | 1.5 wk |
| D5 | AI: backend `AiProvider` / `OpenAiCompatibleProvider` (Groq), feature registry and prompts, streaming endpoint, `ai_usage` table and limits, owner switch, Super Admin block and limit; frontend AI menu, suggestion card with diff, side panel for summaries and questions. **Done 2026-11-07**, with these differences from the plan: the AI menu is in the toolbar (no floating menu on selection); "continue writing" shows a suggestion card instead of ghost text with Tab; long documents are cut at the feature's character limit instead of being summarized in chunks; the stream is written straight to the response rather than through `SseEmitter`. **Not verified against real Groq** (no key was available): the wire format is tested against a local OpenAI-compatible server | 1.5 wk |
| D6 | Performance, accessibility, and dark mode pass; documentation; full build and test run | 0.5 wk |

v1.1 (about 8–10 weeks more): comments and the commenter role, suggesting mode, headers and footers with page
numbers, TOC, footnotes, own OOXML importer, edit role on shares, templates, ruler, pageless mode, and the v1.1 AI
features.

Before D5, the user supplies a Groq API key, which goes only into the gitignored `.env`.
