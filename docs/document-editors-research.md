# In-browser document editors — research and shortlist (Phase 1)

Status: research only, nothing built. Written 2026-11-05. Library licences and competitor features change often, so
re-check each one (its LICENSE file and release notes) when its editor starts.

Goal: clicking a file in the HarDisk consumer portal (`cloud-disk-frontend`) opens it in the right in-browser viewer
or editor instead of downloading it. There is one editor project per document type, modelled on Google Docs and Sheets,
with AI features through an LLM. Groq is the first LLM provider, behind a provider-agnostic layer.

---

## 1. What users expect to open in a cloud drive

All the major products (Google Drive, OneDrive / Microsoft 365 web, Dropbox, Box, Zoho WorkDrive, Nextcloud with
OnlyOffice or Collabora) set the same baseline: **every common file previews in the browser**, and Office files and PDFs
**edit in place**. Users treat "it downloads instead of opening" as broken.

| Type | Typical share of files people open | Expectation today | Importance |
|---|---|---|---|
| PDF | Very high (contracts, invoices, scans) | View, search, zoom, print; annotate, fill forms, sign; organise pages | **Critical** |
| Images (jpg/png/webp/heic/gif/svg) | Very high | Instant preview and gallery; crop, rotate, resize, basic adjust | **Critical** (preview) / High (edit) |
| Word docs (.docx, .odt, .rtf) | High | Open, edit, comment, track changes, export to PDF, save back as .docx | **Critical** |
| Spreadsheets (.xlsx, .csv, .ods) | High | Formulas, formatting, sort/filter, charts, multiple sheets, save back as .xlsx | **Critical** |
| Presentations (.pptx, .odp) | Medium | View and present everywhere; light edits (text, images, reorder) | High (view) / Medium (edit) |
| Plain text, Markdown, code, JSON, logs | Medium (high for technical users) | Syntax highlighting, search, live Markdown preview, edit and save | High |
| Video / audio | Medium | Streaming playback, scrubbing, thumbnails | High (preview only) |
| Archives (.zip) | Low–medium | List contents, extract a single file | Medium (preview only) |
| Diagrams / whiteboards | Low, but growing | Google Drawings, draw.io, Excalidraw-style canvas | Low (later) |
| Email (.eml/.msg), e-books, CAD | Low | Preview only, if at all | Low |

Takeaway: **a universal previewer** covering PDF, images, video/audio, text, and read-only Office files is cheap and
covers most clicks. The editors then add value per type.

---

## 2. Competitor landscape (late 2026)

| Product | Docs | Sheets | Slides | PDF | AI layer | Notes for us |
|---|---|---|---|---|---|---|
| Google Workspace | Docs: real-time co-editing, suggesting mode, comments, smart chips, building blocks, tabs, pageless | Sheets: formulas, pivots, charts, connected sheets, tables | Slides | View and comment; light annotation | Gemini side panel in Docs/Sheets/Slides/Drive: "Help me write", summarise, refine, formula help, "Help me analyse", image generation, Q&A over Drive files | Our UX reference. Converts Office files to its own format, or edits Office files in "Office editing" mode |
| Microsoft 365 web | Word: highest .docx fidelity, track changes, co-authoring, Designer | Excel: full formula engine, Python in Excel, pivots, Copilot | PowerPoint: Designer, Copilot slide generation | Edge/Acrobat | Copilot: draft, rewrite, summarise, "chat with the document", formula and insight generation, deck from a document, agents | Fidelity benchmark for .docx/.xlsx/.pptx |
| Zoho Workplace (Writer, Sheet, Show) | Strong Office fidelity, mail merge, forms | Sheet: data cleaning, Zia insights | Show | Zoho PDF editor | Zia (and LLM integrations): write, rewrite, insights | Shows a smaller vendor can compete |
| ONLYOFFICE Docs | Full Office editors in the browser (canvas-rendered) | Yes | Yes | View, edit, forms | AI plugin (bring your own key) | **AGPL-3.0** with extra attribution terms. 9.4 removed the 20-connection limit. Separate heavy server |
| Collabora Online (LibreOffice-based) | Full Office suite through WOPI | Yes | Yes | Yes | Limited | **MPL-2.0**. CODE edition for development; supported builds are subscription. Heavy server |
| Notion | Block editor, databases, wiki | Databases rather than spreadsheets | — | Embed only | Notion AI: write, autofill database columns, Q&A over the workspace | Block-editor UX and AI-in-context reference |
| Adobe Acrobat web | — | — | — | View, annotate, fill and sign, organise pages, edit text, OCR, compress, convert | AI Assistant: summarise, Q&A with citations, generative summaries | PDF reference |
| Dropbox / Box | Office editing through Microsoft integration | Same | Same | Annotate and sign (Dropbox) | Dash / Box AI: Q&A over files, summarise | Shows drives integrate other vendors' editors rather than build them |

**AI features that are now table stakes** across Gemini, Copilot, Zia, Notion AI, and Acrobat AI:
1. Summarise this file (any type), with key points and action items.
2. Ask questions about this file (chat in a side panel, answers cite the source).
3. Write, rewrite, shorten, expand, change tone, fix grammar, and translate the selection.
4. Draft from a prompt (a blank document from an instruction or outline).
5. Sheets: explain or generate a formula, clean or categorise columns, "analyse this data", suggest a chart.
6. Slides: generate a deck from a prompt or document, and rewrite speaker notes.
7. PDF: summarise, Q&A with page citations, extract tables or fields.
8. Drive-level (later): semantic search, and "ask across my files".

---

## 3. Per-type analysis

Licence key: ✅ permissive (MIT / Apache-2.0 / BSD / ISC); ⚠️ weak copyleft (MPL-2.0: file-level, fine if we don't modify
the library's own files); ❌ strong copyleft (GPL / AGPL) or commercial-only.

Effort is in person-weeks for one experienced developer working with AI help: "MVP" means usable and safe, and
"competitive" means close to Google's feature set for that type (excluding real-time co-editing, covered in §4.6).

### 3.1 Rich-text documents (.docx, .odt, .rtf, also our native format)

**Must-have features:** headings and styles; bold, italic, underline, strike, and colours; fonts and sizes; lists
(including multi-level and checklists); tables (with merges and resizing); images (inline and resized); links;
page-view layout with margins, page size, and orientation; headers, footers, and page numbers; page breaks; find and
replace; undo and redo; word count; comments; suggesting mode / track changes; outline / table of contents; spell check;
version history; export to PDF and .docx; print; paste from Word or Google Docs without garbage; keyboard shortcuts;
autosave.

**Competitor AI:** help me write, rewrite / tone / shorten / expand on the selection, summarise, Q&A, translate, grammar
fix, generate a table or outline, continue writing, and proofread with inline suggestions.

**Open-source building blocks:**

| Library | Licence | Role | Verdict |
|---|---|---|---|
| **Tiptap core + extensions** (on ProseMirror) | ✅ MIT | Editor framework; huge extension ecosystem; React bindings; Yjs collaboration (`y-prosemirror`, MIT) | **Recommended.** Use only the MIT packages. Tiptap's own DOCX import/export, AI, comments, and version history are paid Pro/Platform features, so we build our own |
| ProseMirror | ✅ MIT | Underlying model, if we outgrow Tiptap | Used through Tiptap |
| Lexical (Meta) | ✅ MIT | Alternative framework | Good, but a smaller ecosystem for page layout and tables |
| BlockNote | ⚠️ MPL-2.0 core; ❌ the "XL" packages (including DOCX/PDF export) are GPL-3.0 or commercial | Notion-style block editor | Notion-like rather than page-based; the export we need is copyleft |
| Plate | ✅ MIT | Slate-based, has a paste-from-Word deserialiser | A viable alternative; weaker paging |
| SuperDoc | ❌ AGPL-3.0 or commercial | High-fidelity DOCX editor (OOXML-native) | Best fidelity found, but copyleft. Fallback only, or buy a licence |
| mammoth.js | ✅ BSD-2 | .docx → semantic HTML (import) | Good for structure, drops most visual styling |
| `docx` (dolanmiu) | ✅ MIT | Generate .docx from our model (export) | **Recommended** for export |
| JSZip + fast-xml-parser | ✅ MIT (JSZip is dual MIT/GPL, use under MIT) | Our own OOXML reader for better import than mammoth | Recommended for v2 import |
| docx-preview | ✅ Apache-2.0 | High-quality read-only .docx rendering | Good for the "preview" path before the editor loads, and for fidelity comparison |
| Typo.js / nspell + Hunspell dictionaries | ✅ MIT (check dictionary licences, often LGPL/MPL data) | Spell check beyond the browser's built-in one | Browser spell check is enough at first |

**Round-trip reality:** no permissive browser library round-trips .docx losslessly. Any editor with its own model
(ProseMirror, Lexical) loses OOXML features it doesn't model.
- Survive the round trip easily: paragraphs, headings, inline formatting, fonts and colours, lists, tables with merges,
  images, links, page breaks, headers and footers, page size and margins.
- Possible with work: comments, footnotes, simple track changes, table of contents, section breaks.
- Lost or simplified: fields, text boxes and shapes, SmartArt, embedded objects, complex numbering overrides, mixed
  section orientation, macros, and content controls.

Mitigations:
1. Every save is a new version, so the original upload is never lost (backend §4.2).
2. On open, detect unsupported parts (`w:ins`/`w:del`, `wps:`/`wpg:` shapes, `w:fldChar`, SmartArt parts) and show "This
   file uses features that will be simplified when saved. Save as a copy or keep the original."
3. Store a native JSON sidecar or format (`.cdoc` = ProseMirror JSON plus assets) for documents created in HarDisk,
   and use .docx only for import/export. Google Docs does the same.
4. Use a fixture corpus (real-world .docx files) with automated round-trip tests: compare docx-preview renders before and
   after.

**Effort:** MVP (Tiptap, page view, tables and images, mammoth import, `docx` export, PDF export through print CSS,
autosave to versions) **5–7 wk**. Competitive (own OOXML import, comments, suggesting mode, ToC, headers and footers,
footnotes, AI panel) **+8–10 wk**. Real-time co-editing **+4–6 wk**.

### 3.2 Spreadsheets (.xlsx, .xls, .csv, .ods)

**Must-have features:** a virtualised grid (100k+ rows); multiple sheets; a formula engine with the ~400 common Excel
functions, cross-sheet references, and named ranges; number, date, and currency formats; cell styles, borders, and
merges; freeze panes; sort and filter; conditional formatting; data validation and dropdowns; charts; find and replace;
copy and paste to and from Excel or Sheets; undo and redo; resizing, hiding, and grouping rows and columns; CSV
import/export; version history; comments. Pivot tables count toward "competitive", not MVP.

**Competitor AI:** generate or explain a formula from plain language, "help me analyse" (insights and charts), clean,
categorise, or extract a column (Gemini's AI function, Copilot's LLM-driven `=COPILOT()`, Notion autofill), summarise a
sheet, and create a table from a prompt.

**Open-source building blocks:**

| Library | Licence | Role | Verdict |
|---|---|---|---|
| **Univer** (Sheets, also Docs and Slides) | ✅ Apache-2.0 core; ❌ **Univer Pro** (commercial) for xlsx import/export, printing, pivots, some charts, and edit history | Full spreadsheet engine and UI (canvas), formula engine, plugins, collaboration-ready command model | **Recommended engine**. Pair it with our own ExcelJS ↔ Univer-JSON converter to stay off Pro |
| Fortune-sheet | ✅ MIT | Luckysheet successor, React, a Google Sheets-like UI | Simpler; a smaller formula set and weaker performance at scale. Second choice |
| Luckysheet | ✅ MIT | — | Archived; don't use |
| **ExcelJS** | ✅ MIT | Read/write .xlsx with styles, formulas, merges, validation, conditional formatting, images | **Recommended** for round-tripping files |
| SheetJS Community Edition | ✅ Apache-2.0 (install from the SheetJS CDN tarball, not the stale npm `xlsx`) | Broad format reading (.xls, .ods, .csv); styles need Pro | Use it for legacy .xls/.ods import only |
| Papa Parse | ✅ MIT | Streaming CSV | Recommended for CSV |
| HyperFormula | ❌ GPL-3.0 or commercial | Formula engine | Avoid; Univer has its own |
| Handsontable | ❌ commercial for commercial use | Grid | Avoid |
| AG Grid Community | ✅ MIT | Data grid, not a spreadsheet | Only for read-only CSV previews |
| ECharts | ✅ Apache-2.0 | Charts (Univer uses it) | Yes |

**Round-trip reality:** ExcelJS keeps values, formulas, styles, merges, column widths, freeze panes, validation, and
most conditional formatting. It loses or partly keeps charts, pivot tables, slicers, sparklines, macros (`.xlsm` VBA must
be preserved as an opaque binary or blocked), threaded comments, and external links. Use the same mitigations as for
Docs: a version per save, a warning on unsupported parts, and "save as copy". Formula results are recomputed by Univer;
we cache them on write so other apps show values without recalculating.

**Effort:** MVP (Univer core UI, ExcelJS converter for values, formulas, styles, and merges, CSV, autosave)
**6–8 wk**. Competitive (charts round-trip, conditional formatting, validation, filters, comments, AI formula and
analysis panel) **+8–10 wk**. Pivots and co-editing come later.

### 3.3 Presentations (.pptx, .odp)

**Must-have features:** slide sorter; layouts and themes; text boxes with rich text; shapes, images, and tables;
alignment guides and snapping; grouping; z-order; speaker notes; present mode (fullscreen, presenter view); transitions
(basic); export to PDF; save back as .pptx.

**Competitor AI:** generate a deck from a prompt or document, rewrite slide text, generate speaker notes, design
suggestions (PowerPoint Designer), image generation, and summarise a deck.

**Open-source building blocks** (this is the weakest area: no mature permissive web .pptx editor exists):

| Library | Licence | Role |
|---|---|---|
| PptxGenJS | ✅ MIT | Write .pptx from our model (export) |
| JSZip + our own parser | ✅ MIT | Read .pptx (DrawingML) into our slide model |
| Konva / react-konva or Fabric.js | ✅ MIT | Canvas editing surface (drag, resize, rotate, snapping) |
| PPTXjs, PptxViewJS, pptx-glimpse | MIT according to their listings (verify) | Viewers / experimental editors, small or stale projects. Use them as a parsing reference |
| Univer Slides | ✅ Apache-2.0 core | Early-stage; watch it |
| ONLYOFFICE / Collabora | ❌ AGPL / ⚠️ MPL, separate heavy server | The only route to near-Office .pptx fidelity soon |

**Round-trip:** DrawingML is huge (theme inheritance, placeholders, SmartArt, charts, animations). An in-house editor
will round-trip text, images, basic shapes, tables, and notes. Expect loss on SmartArt, charts, animations, and complex
masters.

**Effort:** viewer-quality rendering **3–4 wk**. Editor MVP **8–12 wk**. Competitive **20+ wk**. **Build this last.**
Ship a read-only viewer first (render to canvas or use a server-side conversion to PDF later).

### 3.4 PDF (view, annotate, fill, sign, organise; light edit)

**Must-have features:** fast rendering of large files (tiling, lazy pages); text selection and search; zoom; thumbnails;
outline/bookmarks; print and download; annotations (highlight, underline, strike, sticky note, free text, ink, shapes);
AcroForm filling; signatures (drawn, typed, or image); page organisation (reorder, rotate, delete, insert, merge,
split); redaction. Competitive extras: OCR for scans, editing existing text (hard), compression, and conversion to and
from Office formats.

**Competitor AI:** Acrobat AI Assistant (summary, Q&A with page citations, generative headings), Gemini and Copilot PDF
summaries, and table and field extraction.

**Open-source building blocks:**

| Library | Licence | Role | Verdict |
|---|---|---|---|
| **EmbedPDF** (PDFium compiled to WASM) | ✅ MIT (PDFium Apache-2.0/BSD) | Headless and React viewer: tiling, annotations, true redaction, forms, plugin system | **Recommended** as the main engine |
| PDF.js (Mozilla) | ✅ Apache-2.0 | Proven viewer, text layer, AcroForm, basic annotation editor | Fallback or alternative; also used for text extraction for AI |
| react-pdf (wojtekmaj) | ✅ MIT | React wrapper over PDF.js | Simple viewing only |
| **pdf-lib** | ✅ MIT | Page organisation, form filling, flattening, signatures, writing annotations | **Recommended** for write operations |
| Tesseract.js | ✅ Apache-2.0 | OCR in the browser | Later |
| PSPDFKit/Nutrient, Apryse, Foxit | ❌ commercial | Full PDF SDKs | Avoid (cost); reference for UX |

**Round-trip:** PDF annotations and forms are native PDF objects, so annotate, fill, sign, and organise all save back
losslessly into a valid PDF (incremental save). Editing existing text in place is not realistic with open-source tools.
Offer "add text box" and "convert to Docs" instead.

**Effort:** viewer, search, and annotations, saving as a new version **3–4 wk**. Forms, signatures, page organisation,
and redaction **+3–4 wk**. AI summary and Q&A **+1–2 wk** (on the shared AI layer).

### 3.5 Plain text, Markdown, and code

**Must-have features:** syntax highlighting (by extension); line numbers; find and replace with regex; multiple cursors;
code folding; word wrap; large-file handling (virtualised, read-only above a threshold such as 10 MB); Markdown split or
WYSIWYG view with GFM tables, task lists, and code blocks; Mermaid diagrams; JSON/YAML validation and formatting;
encoding and line-ending detection.

**Competitor AI:** explain code, generate or modify the selection, summarise logs, fix JSON, and the same writing tools
as Docs for Markdown.

**Open-source building blocks:** **CodeMirror 6** ✅ MIT (light, modular, good for mobile; **recommended**); Monaco ✅
MIT (VS Code feel, heavy at ~3 MB, no mobile support); Milkdown ✅ MIT or the Tiptap Markdown extension ✅ MIT for WYSIWYG
Markdown; remark/rehype ✅ MIT for rendering; Mermaid ✅ MIT; Prettier ✅ MIT for formatting.

**Round-trip:** lossless (it's text). Preserve the original encoding, BOM, and line endings.

**Effort:** **1–2 wk**, the cheapest editor. It is also the best vehicle for building the shared editor shell, the
save-version API, and the AI panel end to end.

### 3.6 Images

**Must-have features:** preview of jpg, png, webp, gif, svg, avif, and HEIC (via conversion); gallery navigation; zoom,
pan, fit; EXIF info. Editing: crop, rotate, flip, resize, brightness, contrast, saturation, filters, annotate (arrows,
text, shapes, blur/redact), export format and quality. Save as a new version or as a copy.

**Competitor AI:** Google Photos and Adobe Express ship magic eraser, background removal, upscaling, and generative
fill. Drives mostly offer auto-tags, OCR text extraction, and search by content. **Note: Groq serves text and vision
models, not image generation or editing.** Image AI is limited to describe, alt-text, and OCR unless a second provider
is added through the provider layer.

**Open-source building blocks:** Filerobot Image Editor ✅ MIT (complete React editor UI; **recommended**); Konva ✅ MIT /
Fabric.js ✅ MIT (for annotation layers); react-easy-crop ✅ MIT; heic2any ✅ MIT; TOAST UI Image Editor ✅ MIT (stale);
Pintura ❌ commercial.

**Round-trip:** re-encoding is lossy for JPEG. Keep the original as a version and strip or keep EXIF on purpose
(GPS privacy).

**Effort:** preview and gallery **1 wk**; editor **1–2 wk**.

### 3.7 Others worth covering

| Type | Approach | Licence | Effort |
|---|---|---|---|
| Video / audio | Native `<video>`/`<audio>` with HTTP range requests on the presigned URL (B2 supports range requests); thumbnails later | — | 0.5–1 wk |
| ZIP | List entries with zip.js ✅ BSD-3 using range reads; extract one entry | ✅ | 1 wk |
| Whiteboard / diagrams | Excalidraw ✅ MIT (`.excalidraw` JSON), draw.io embed ✅ Apache-2.0 (`.drawio`) | ✅ | 1–2 wk each |
| Legacy formats (.doc, .xls, .ppt) and high-fidelity conversion | Read-only through SheetJS for .xls. For .doc/.ppt, convert server-side to .docx or PDF using a LibreOffice/Collabora conversion container (MPL), run as a separate service | ⚠️ | 2 wk, optional |
| E-mail (.eml) | postal-mime ✅ MIT, preview only | ✅ | 0.5 wk |

---

## 4. Proposed architecture

### 4.1 What the backend already gives us (checked in `coude-disk-bakend`)

- **Storage:** the `ObjectStorageService` interface with `B2ObjectStorageService` (S3 API, SigV4, SSE-B2 encryption,
  private bucket per organization) and `LocalObjectStorageService` (dev, served by `LocalStorageController` at
  `/api/v1/dev-storage/{token}`). Operations: `presignPut`, multipart (`createMultipartUpload`, `presignUploadPart`,
  `completeMultipartUpload`), `head`, `presignGet`, `deleteObject`.
- **Bucket CORS** already allows `GET, PUT, HEAD` from the frontend origins and exposes `ETag`, so the browser can
  `fetch()` file bytes and `PUT` new bytes straight to B2. No proxying of file content through Spring is needed.
- **Download:** `GET /api/v1/files/{id}/download` → `DownloadResponse(url, expiresAt)`. The presigned GET has a 5-minute
  TTL, needs `VIEWER` on the drive, records recents, and writes the `FILE_DOWNLOADED` audit entry. `presignGet` always
  sets `Content-Disposition: attachment`. That still works with `fetch()`, but blocks `<img>`/`<video>`/`<iframe>` inline
  use. There is also `GET /shared/files/{id}/download` for shared-with-me.
- **Upload:** `POST /drives/{driveId}/uploads` → an `UploadSessionResponse` (SINGLE or MULTIPART) → PUT bytes →
  `POST /uploads/{id}/complete`. Init reserves drive quota and creates a pending `file_nodes` row. The object key is
  `<prefix>d/<driveId>/o/<uuid>`, a fresh UUID for every upload. Init needs `CONTRIBUTOR`. An upload always creates a
  **new node**: there is no "replace contents of an existing node" path today.
- **Data model:** `file_nodes` has `object_key`, `object_version_id`, `size_bytes`, `mime_type`, `category`, and an
  optimistic-lock `version` column. There is no version-history table.
- **Permissions:** `DrivePermission` is VIEWER < CONTRIBUTOR < EDITOR < MANAGER. Rename, move, and trash need `EDITOR`.
  `NodeShare` (shared-with-me) has **no role column**, so direct shares are view-only today. `ShareLink` is a public
  view/download link.
- **Cross-cutting pieces to reuse:** the `storage_operations` outbox (deferred deletes and purge), `AuditService`,
  `RateLimitFilter`, `BillingBlockFilter`, the `ContentAccess` delegation for Super Admins, and quota accounting on drives.
  The stack is Spring MVC (`spring-boot-starter-webmvc`), not WebFlux, so streaming uses `SseEmitter` or
  `StreamingResponseBody`.

### 4.2 Small backend additions (all in the existing app; no new service)

1. **Inline content URL.** Add a `disposition` parameter to `ObjectStorageService.presignGet` (`attachment` |
   `inline`), and add `GET /api/v1/files/{id}/content` → `{url, expiresAt, mimeType, sizeBytes, etag, nodeVersion}` with
   `inline` and the stored content type. It needs `VIEWER`, and is audited as `FILE_OPENED`, not a download. The same goes
   for the shared-with-me path. Implement it in `LocalObjectStorageService` as well.
2. **File versions** (Flyway `V15__file_versions_and_edit_sessions.sql`):
   `file_versions(id, organization_id, node_id, version_no, object_key, object_version_id, size_bytes, content_type,
   source ENUM(UPLOAD, EDITOR, RESTORE), created_by, created_at, label NULL)`. A backfill gives every existing file
   version 1.
   - `POST /files/{id}/versions` with `{sizeBytes, contentType, baseNodeVersion}` returns an upload session that targets
     the existing node. This reuses `UploadServiceImpl`: add `target_node_id` and a `mode` of NEW or REPLACE to
     `upload_sessions`. It reserves only the size delta against the drive quota, and uses a fresh UUID key, so the old
     object stays intact.
   - `POST /uploads/{id}/complete` (existing) then writes a `file_versions` row and points `file_nodes.object_key` at the
     new object. It returns **409 Conflict** if `file_nodes.version != baseNodeVersion`, so a stale tab can't overwrite a
     newer save. The client then offers "save as copy" or "reload".
   - `GET /files/{id}/versions`, `POST /files/{id}/versions/{vid}/restore` (creates a new version), and
     `GET /files/{id}/versions/{vid}/content`.
   - Retention: keep the last N versions or D days per organization. Older ones are deleted through the existing
     `storage_operations` outbox, and their bytes are released from quota. Versions count toward storage billing (say so
     in pricing).
   - Saves need `EDITOR`, not `CONTRIBUTOR`: changing someone else's file is an edit.
3. **Edit session / lock (single writer until real-time co-editing exists).**
   `edit_sessions(id, organization_id, node_id, user_id, lock_token_hash, client_id, acquired_at, heartbeat_at,
   expires_at)`.
   - `POST /files/{id}/edit-session` → `{lockToken, expiresAt}` or 409 with the holder's name ("Asha is editing; open
     read-only?").
   - `PUT /edit-sessions/{id}/heartbeat` (every 30 s, 2-minute lease) and `DELETE /edit-sessions/{id}`.
   - Saving a version requires a valid lock token. Expired leases are cleaned by the existing maintenance scheduler.
   - This becomes a "presence" endpoint once real-time co-editing arrives.
4. **Edit permission on shares (later).** Add `role VARCHAR(16) DEFAULT 'VIEWER'` to `node_shares` so users can share a
   file "can edit" without drive membership.
5. **AI proxy** (§4.4): `POST /api/v1/ai/run` (SSE stream), `GET /api/v1/ai/features`, and
   `GET /api/v1/organization/ai-usage`. Super Admin console: a per-org enable switch and limits.
6. **Config** (when implementation starts; never commit real values): add to `coude-disk-bakend/.env.example`

   ```
   # AI: "none" (default, AI features hidden) or "groq". Content of files is sent to the provider when a user runs an AI action.
   AI_PROVIDER=none
   GROQ_API_KEY=your-groq-api-key
   GROQ_BASE_URL=https://api.groq.com/openai/v1
   # Model ids change; pick from Groq's current model list at implementation time.
   AI_MODEL_FAST=
   AI_MODEL_SMART=
   AI_DEFAULT_MONTHLY_TOKENS_PER_ORG=2000000
   ```

   Leave `GROQ_API_KEY=` empty in the gitignored `.env` until the user supplies a key.

### 4.3 Frontend: editor shell plus one package per editor

The user wants one project per editor. Each editor is its own npm package (own `package.json`, README, source and
tests) in an npm workspace inside the consumer app, so it ships with the portal (one origin, one login, no extra
deployments) and shares one copy of React and Fluent UI. As built in D2 they lived under
`cloud-disk-frontend/editors/`; since the Docs app became its own project (2026-11-07) they live under
`cloud-disk-docs-frontend/editors/` rather than a separate top-level folder: a separate top-level workspace would need its
own `node_modules`, and then React and Fluent are installed twice.

```
cloud-disk-frontend/
  editors/editor-core/       shell UI, EditorModule contract, EditorBackend interface, autosave, edit session, versions (built, D2)
  editors/editor-preview/    read-only fallback: images, video, audio, PDF, text (built, D2)
  editors/editor-docs/       Tiptap + OOXML import/export (D3–D4)
  editors/editor-sheets/     Univer + ExcelJS converter
  editors/editor-pdf/        EmbedPDF + pdf-lib
  editors/editor-text/       CodeMirror 6 + Markdown
  editors/editor-images/     Filerobot
  editors/editor-slides/     (last)
  src/features/editors/      route /open/:fileId, module list, EditorBackend on top of RTK Query
```

The contract each editor implements (in `editor-core`):

```ts
interface EditorModule {
  id: 'docs' | 'sheets' | 'pdf' | 'text' | 'images' | 'slides' | 'preview';
  accepts(file: { name: string; mimeType?: string; sizeBytes: number }): 'edit' | 'view' | false;
  load(): Promise<{ default: React.ComponentType<EditorProps> }>;   // React.lazy target, so each editor is code-split
  aiFeatures: string[];                                            // feature ids from the backend registry
}
interface EditorProps {
  file: FileItem; bytes: ArrayBuffer; readOnly: boolean;
  onDirty(): void;
  save(blob: Blob, opts?: { asCopy?: boolean }): Promise<SaveResult>;   // version API + 409 handling inside core
  ai: AiClient;                                                         // streaming client for /api/v1/ai/run
}
```

- The **registry** picks the editor by extension and MIME type, and falls back to the universal **preview** module
  (image, video, audio, text, docx-preview, read-only sheet) or to download.
- The **shell** (shared by all editors) provides: title and rename, "Saved / Saving… / Offline", version history drawer,
  share button, open-with menu, "Editing by X" banner, AI side panel, and keyboard shortcuts. It is styled with Fluent UI
  v9 to match the portal.
- **State:** editor document state stays inside each editor library. Redux holds only file metadata and session state
  through RTK Query endpoints (`getFileContent`, `createVersion`, `acquireEditSession`, `listVersions`, `aiFeatures`).
- **Autosave:** debounce (2–5 s after the last change, plus on blur and on unload) → serialise → `save()`. For large
  binaries (xlsx, pdf) save on an explicit "Save" or every 30–60 s, so we don't create hundreds of versions. Instead,
  coalesce versions server-side (an editor save within 10 minutes by the same user replaces the previous editor version
  rather than adding one, as Google does).
- **Bundle size:** each editor is lazy-loaded; Univer, EmbedPDF's WASM, and Tiptap never load until the matching file is
  opened.

### 4.4 AI layer design (backend, provider-agnostic)

```
com.empedance.dlp.ai
  AiProvider                 interface: String id(); Stream<AiChunk> stream(AiRequest); AiResult complete(AiRequest)
  OpenAiCompatibleProvider   one implementation for any OpenAI-format API (Groq first; OpenAI, Together, Mistral,
                             local vLLM or Ollama later by config). java.net.http.HttpClient with SSE parsing; no SDK
  NoopAiProvider             AI_PROVIDER=none
  AiFeature (record)         id ("docs.rewrite"), docTypes, promptTemplateId + version, modelTier (FAST|SMART),
                             maxInputTokens, maxOutputTokens, temperature, output (TEXT|JSON|MARKDOWN)
  AiFeatureRegistry          features defined in code or YAML resources, with prompt templates under resources/ai/prompts/
  AiService                  checks permission (VIEWER on the node), org enabled, limits → builds messages from the
                             template + selection/context (trimmed to the token budget) → streams → records usage
  AiController               POST /api/v1/ai/run {featureId, nodeId, selection?, instruction?, context?} → SseEmitter
  ai_usage table             organization_id, user_id, feature_id, provider, model, input_tokens, output_tokens,
                             latency_ms, status, created_at (no prompt or content stored)
```

- **The key never reaches the browser.** The frontend sends the feature id, the node id, and the text it already holds
  (a selection or chunk). The server re-checks drive permission on `nodeId`.
- **Limits:** a per-org monthly token budget (Super Admin editable, default from env), a per-user requests-per-minute
  limit (reuse the `RateLimitFilter` pattern keyed by user), and per-feature input caps. Groq 429 responses are retried
  with backoff, then surfaced as "AI is busy, try again".
- **Streaming:** `SseEmitter` on a bounded executor, with `event: delta` / `event: done` / `event: error`. A client
  abort cancels the upstream request.
- **Long files** (summarise or Q&A on big PDFs or sheets): map-reduce over chunks first. Embeddings and semantic search
  are a later feature (they need an embeddings provider, which Groq does not offer, plus vector storage).
- **Privacy and compliance:** AI is off by default per organization, and an org owner turns it on (Super Admin can
  force it off). Show "content is sent to an AI provider" on first use. Audit `AI_RUN` without content. Never log
  prompts or completions.
- **Prompt safety:** user documents are untrusted input. Put document text in a delimited user-content block, never in
  the system prompt, and never let model output trigger actions without the user clicking Apply.
- **Frontend:** shared `AiPanel` (chat and quick actions) and selection toolbar actions in `editor-core`. Results are
  previewed as a diff or suggestion and applied with one click.

### 4.5 Security notes

- Presigned URLs stay short-lived (5 minutes) and are fetched just in time. Editors hold bytes in memory, not URLs.
- Opening a file is audited (`FILE_OPENED`), and so is every saved version (`FILE_VERSION_CREATED`).
- PDF, SVG, and HTML content must never execute in our origin. Render SVG as `<img>` and PDF through PDFium or PDF.js.
  Sanitise Markdown output with DOMPurify (Apache-2.0/MPL dual).
- Macro-enabled files (.xlsm, .docm) open read-only with a warning. Never execute VBA.
- `BillingBlockFilter` already blocks writes for suspended organizations; editor saves go through the same path.

### 4.6 Real-time co-editing (later phase, not in the first editors)

Yjs ✅ MIT is the standard (`y-prosemirror` for Docs; Univer has its own collaboration model). Yjs needs a WebSocket
relay. Options:
- (a) Hocuspocus ✅ MIT, a small Node service, which adds a runtime to the stack.
- (b) A minimal Yjs relay in Spring (`spring-boot-starter-websocket`, relaying and persisting update blobs, with
  `y-crdt`/`yrs` bindings for server-side merges).

Recommendation: keep single-writer locks (§4.2.3) for the first editors and decide on (a) or (b) when Docs is done.

### 4.7 The "just embed OnlyOffice or Collabora" option

This option gives near-Office fidelity for docx, xlsx, and pptx at once, through WOPI or the OnlyOffice API, with save
callbacks into our version API. Trade-offs:
- A heavy extra server (4–8 GB RAM per node).
- Licensing:
  - OnlyOffice is AGPL-3.0 with attribution terms. Running it unmodified is OK, but any change to it must be published,
    and logo and trademark rules apply.
  - Collabora is MPL-2.0. A supported production build is a paid subscription.
- It isn't "our" editor, so its UX and AI can't match a Google-style product we control.

Keep it as a **fallback for .pptx and for legacy-format conversion**, not the main path.

---

## 5. Ranked shortlist

Ranked by user value × feasibility with permissive licences × reuse for later editors.

| Rank | Editor | Value | Licence risk | Round-trip risk | Effort (MVP → competitive) | Why this rank |
|---|---|---|---|---|---|---|
| 0 | **Foundation**: editor shell, universal preview, `/content` + versions + lock APIs, AI proxy | Very high (every click opens something) | None | None | 2–3 wk | Needed by every editor. Built together with whichever editor goes first |
| 1 | **Docs** (Tiptap + own OOXML import/export) | Very high, flagship "Google Docs" experience, best fit for AI | Low (MIT stack; avoid Tiptap Pro, BlockNote XL, SuperDoc) | Medium | 5–7 → 13–17 wk | Most-requested editor, where AI shows the most value; defines the shell and AI UX for the rest |
| 2 | **Sheets** (Univer core + ExcelJS) | Very high | Low if we avoid Univer Pro (own converter) | Medium–high (charts, pivots) | 6–8 → 14–18 wk | Second half of the "Google Docs + Sheets" goal |
| 3 | **PDF** (EmbedPDF + pdf-lib) | Very high (most-opened type) | Low | Low (annotations are native) | 3–4 → 7–9 wk | Cheapest high-value editor; strong AI story (summary, Q&A) |
| 4 | **Text / Markdown / Code** (CodeMirror 6) | Medium–high | None | None | 1–2 wk | Quickest win; the ideal pilot if we want the foundation proven fast |
| 5 | **Images** (Filerobot) | Medium | None | Low (keep original) | 1 → 2–3 wk | Easy; AI limited with Groq |
| 6 | **Slides** (own model + PptxGenJS, or OnlyOffice fallback) | Medium | Medium (no permissive editor; fallback is AGPL/MPL) | High | 8–12 → 20+ wk | Hardest, least mature open source; viewer first |

### Recommendation

**Start with the Docs editor**, building the foundation (rank 0) as part of it: the inline content URL, file versions
with conflict detection, the edit lock, the editor shell and registry, and the Groq-backed AI proxy with the
provider-agnostic interface. Docs is the product's headline ("like Google Docs"), the type where AI features show the
most value, and building it first settles every shared piece (shell, autosave, versions, AI panel) that Sheets and PDF
then reuse.

**Alternative, if a faster first demo matters more:** start with Text/Markdown/Code (1–2 weeks including the
foundation), then Docs. It proves the whole open → edit → save-version → AI loop with almost no format risk.

**Chosen (2026-11-06): Docs.** Its competitive feature set, MVP scope, AI features, fidelity targets, and build plan
are in [editor-docs-feature-set.md](editor-docs-feature-set.md). Coding starts after that scope is approved.

---

## Sources (checked 2026-11-05)

- Univer licence (Apache-2.0 core; Pro covers xlsx import/export, pivots, printing):
  [dream-num/univer](https://github.com/dream-num/univer),
  [opensourcealternatives.to/item/univer](https://www.opensourcealternatives.to/item/univer)
- Tiptap MIT core; DOCX conversion and AI are paid:
  [Tiptap DOCX import/export](https://tiptap.dev/docs/conversion/import-export/docx),
  [Tiptap OSS commitment](https://tiptap.dev/open-source-to-platform),
  [Pro comparison](https://tiptap.dev/docs/resources/changelog/pro-compare)
- EmbedPDF (MIT, PDFium WASM, annotations and redaction):
  [embedpdf/embed-pdf-viewer](https://github.com/embedpdf/embed-pdf-viewer),
  [embedpdf.com React viewer](https://www.embedpdf.com/react-pdf-viewer)
- SuperDoc (AGPL-3.0 or commercial): [superdoc-dev/superdoc](https://github.com/superdoc-dev/superdoc),
  [npm @harbour-enterprises/superdoc](https://npmjs.com/package/@harbour-enterprises/superdoc)
- PPTX in the browser: [PptxGenJS](https://github.com/gitbrent/PptxGenJS),
  [pptx-glimpse](https://github.com/hirokisakabe/pptx-glimpse), [sadmann7/pptx](https://github.com/sadmann7/pptx),
  [PPTXjs listing](https://awesome.ecosyste.ms/projects/github.com%2Fmeshesha%2FPPTXjs)
- ONLYOFFICE 9.4 licence and connection-limit change:
  [it-connect.tech](https://www.it-connect.tech/onlyoffice-docs-9-4-drops-the-20-connection-limit-and-updates-its-open-source-license/),
  [ONLYOFFICE/DocumentServer](https://www.Github.com/ONLYOFFICE/DocumentServer)
- Gemini vs Copilot in Workspace and 365: [heise.de](https://heise.de/-11208867),
  [cloudfuze.com](https://www.cloudfuze.com/google-workspace-vs-microsoft-365/),
  [learn.g2.com](https://learn.g2.com/gemini-vs-copilot?hsLang=en)
- Groq OpenAI-compatible API and rate limits (third-party; confirm on console.groq.com):
  [docs.api7.ai Groq](https://docs.api7.ai/ai-gateway/providers/groq),
  [toolhalla.ai free AI APIs 2026](https://toolhalla.ai/blog/best-free-ai-apis-2026)
- Other licences (CodeMirror, Monaco, PDF.js, pdf-lib, ExcelJS, SheetJS CE, mammoth, docx, Filerobot, Yjs, Hocuspocus,
  Collabora MPL-2.0) are from the projects' own repositories as known at writing. Re-verify each LICENSE file before
  adoption.
