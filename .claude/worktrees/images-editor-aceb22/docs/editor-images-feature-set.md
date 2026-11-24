# Images editor — feature set (before coding)

Status: scope written 2026-11-09, before the build, and built the same day (see the milestone log in `implementation-plan.md`); after the Docs and Sheets editors were confirmed working. Images is
rank 5 in [document-editors-research.md](document-editors-research.md) §5 (research §3.6 covers the market and the
libraries). It is built the way Docs ([editor-docs-feature-set.md](editor-docs-feature-set.md)) and Sheets
([editor-sheets-feature-set.md](editor-sheets-feature-set.md)) were: its own frontend project on the same backend, storage,
versions, edit lock and AI layer.

Benchmarks: Google Photos editor (adjust, filters, crop, Magic Editor) and Adobe Express (quick actions, generative
edits). Tiers: **MVP** (required to ship), **v1.1** (parity for single photos), **Later**.

---

## 1. Decisions

Defaults taken without a separate approval round, because the user asked for Images "the same way" as Docs and Sheets.

| # | Decision | Default | Why |
|---|---|---|---|
| I1 | App | **Own project `cloud-disk-images-frontend`, port 5179** (own subdomain in production). Routes `/` (home: recent, all photos, search) and `/i/:fileId` | Same pattern as Docs (5177) and Sheets (5178); the portal opens images there in a new tab |
| I2 | Editing engine | **Our own non-destructive pipeline in TypeScript** (pure functions over RGBA pixel arrays), with canvas used only to decode, show and encode. **Not Filerobot**, which the research suggested | Filerobot has no exposure, highlights/shadows, sharpness, HSL or curves; it brings its own styled-components UI instead of Fluent; and its React 19 support is unproven. Edit-by-prompt, before/after and versioning would have to be built around it anyway. Pure functions can be unit-tested without a browser canvas |
| I3 | Non-destructive edits | The editor keeps the opened image plus a list of settings (geometry, adjustments, look). Every save renders from the original pixels, so saving twice does not add JPEG loss on top of JPEG loss | Same result as Google Photos; undo is exact |
| I4 | Saving | **Explicit Save** (no autosave: a slider drag is not a version). "Save" stores a new version of the same file; "Save as copy" creates "name (edited).ext" next to it. The original upload stays in version history (the server never merges the first upload away), so it can be restored | Requirement: keep the original recoverable. One person's saves within 10 minutes still replace each other (existing server rule), but never the original upload |
| I5 | Formats | **Edit and save in place:** JPEG, PNG, WebP. **Open, edit, save as a copy only:** GIF (first frame; saved as PNG, because the browser cannot write GIF and saving in place would drop the animation), HEIC/HEIF (converted in the browser with heic2any; saved as JPEG), AVIF and BMP (saved as PNG/JPEG). SVG is not opened (it is code, not pixels) | Browsers can encode JPEG, PNG and usually WebP, nothing else |
| I6 | Metadata | Saving re-encodes the image, which **removes EXIF data, including GPS location**; orientation is applied to the pixels first, so photos keep the right way up. The editor says so on the first save | Privacy by default (research §3.6) |
| I7 | Who can edit | Drive **EDITOR** or above; everyone else, and shared-with-me users, can look and download an edited copy but not save | Same as Docs D5 / Sheets S5 |
| I8 | AI | Same switch, block and audit as Docs: **off per organization until the owner turns it on**; Super Admin can block it. Image edits have their own monthly count per organization (they are not tokens) | Nothing new to configure for owners |
| I9 | AI provider | **Cloudflare Workers AI, model FLUX.2 [klein] 4B**, behind a new provider-neutral `ImageEditProvider` in the backend. Text AI stays on Groq | §4 |

---

## 2. Feature set

### 2.1 Open and save

| Feature | Tier | Notes |
|---|---|---|
| Double-click or Open on an image in the portal (.jpg, .jpeg, .png, .webp, .gif, .heic, .heif, .avif, .bmp) opens it in the Images app in a new tab | MVP | `/i/:fileId` |
| Images home: recent images, all photos (the portal's Photos view), search by name | MVP | Same library the portal shows |
| Fit to window, actual size, 200 % | MVP | Free zoom and pan with the wheel are v1.1 |
| Save (new version), Save as copy, Download edited image (JPEG quality 92 %, PNG lossless, WebP 92 %) | MVP | I4, I5 |
| Edit lock ("X is editing; opened read-only", "Edit here instead"), conflict bar on a stale save, version history with open and restore | MVP | editor-core, as in Docs and Sheets |
| Warn before leaving with unsaved edits | MVP | |
| Gallery navigation (previous/next image of the folder), EXIF panel | v1.1 | |
| Export with a chosen format and quality, strip-or-keep EXIF | v1.1 | |

### 2.2 Editing tools

| Tool | Tier | Details |
|---|---|---|
| Rotate 90° left/right, flip horizontal/vertical | MVP | |
| Crop: free, original ratio, 1:1, 4:5, 3:2, 4:3, 16:9, 9:16; drag the box and its corners; reset | MVP | Applied after rotation |
| Straighten (fine rotation ±45°) | v1.1 | |
| Resize: width/height in pixels with locked ratio, or 25/50/75 % | MVP | High-quality downscale (area average), bilinear upscale |
| Adjust: exposure, brightness, contrast, highlights, shadows, saturation, vibrance, warmth, tint, sharpness | MVP | Each −100…+100 (sharpness 0…100) |
| Looks (LUT-style filter presets) with strength 0–100 %: Vivid, Warm, Cool, Mono, Noir, Sepia, Fade, Vintage, Sunset, Teal & orange, Film | MVP | Each look is a set of per-channel curves plus saturation and toning, applied as lookup tables |
| HSL: hue, saturation and lightness for 8 colour ranges (red, orange, yellow, green, aqua, blue, purple, magenta) | MVP | Smooth weighting between neighbouring ranges |
| Curves: RGB master curve and red, green, blue curves with draggable points | MVP | Monotone cubic interpolation (no overshoot) |
| Undo and redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z / Ctrl+Y), reset all | MVP | Up to 100 steps; a slider drag is one step |
| Before/after: hold-to-see "Before" button and a split view with a draggable divider | MVP | |
| Annotate (text, arrows, shapes), blur/redact brush | v1.1 | |
| Vignette, grain, local (brush) adjustments | Later | |
| Auto-enhance (automatic levels) | v1.1 | |

### 2.3 Quality bar

| Area | Target |
|---|---|
| Responsiveness | Sliders update a preview (long side ≤ 1600 px) within about 100 ms for a 12-megapixel photo; the full-size image is rendered only when saving |
| Size limits | Up to 50 megapixels and 16,384 px per side (browser canvas limits); larger images open view-only with a notice |
| Bundle | The editor code loads only when an image opens; heic2any loads only for HEIC files |
| Accessibility | Every tool is reachable by keyboard; sliders have labels and values; Fluent UI light and dark |
| Security | Image bytes are decoded by the browser only; nothing is executed; SVG is not opened |

---

## 3. Edit by prompt (AI)

The user types an instruction ("remove the background", "make it look like sunset", "add snow"), or picks one of the
suggestions, and gets back an edited image shown next to the current one, with **Accept** (it becomes the image being
edited; undo works) and **Discard**. Nothing changes without Accept, and nothing is saved until Save.

Flow: the browser renders the current image (with all edits) as a JPEG up to 1024 px on the long side and sends it with
the instruction and the file id to `POST /api/v1/ai/images/edit`. The server checks read access to the file, the
organization switch and block, the per-user rate, the organization's monthly image-edit count, and the input size;
then the provider edits the image and the server returns it (base64 PNG/JPEG). The result keeps the aspect ratio;
accepting it scales it back to the size the image had before, so the saved image keeps its dimensions (detail is
limited to what the model produced).

Rules (as for text AI): the image is sent only for the run the user started; only counts are stored (never images or
prompts) in `ai_usage` (feature `images.edit`, provider, model, latency, status) and the audit log; the provider key never
reaches the browser; per-organization monthly limit (`AI_IMAGE_MONTHLY_EDITS_PER_ORG`, default 200), the existing
per-user per-minute limit, at most a few edits at once (`AI_IMAGE_MAX_CONCURRENT`), and a maximum upload size
(`AI_IMAGE_MAX_INPUT_BYTES`, default 4 MB). Clear errors: "AI image editing is not set up" when no key or account is set
(the panel then explains it instead of failing), "AI is off/blocked", "Monthly limit reached", "The AI service declined
this edit" (provider safety filter), "The AI service is busy".

Later: background removal to transparency with a dedicated segmentation model, masked edits (paint the area to change),
alt text and descriptions through the text provider.

---

## 4. Choosing the image-editing model

Need: edits an existing image from a text instruction (not only text-to-image), callable over HTTP from Java, and the
most free usage for development. Checked 2026-11-09 against the providers' own pages where possible.

| Provider | Model that edits from a prompt | Free usage | Paid | Verdict |
|---|---|---|---|---|
| **Cloudflare Workers AI** | FLUX.2 [klein] 4B (`@cf/black-forest-labs/flux-2-klein-4b`): prompt + up to 4 reference images; also klein 9B and FLUX.2 [dev] | **10,000 Neurons every day**, on the free Workers plan, no card. klein 4B costs 5.37 Neurons per 512×512 input tile and 26.05 per output tile: a 512 px input and a 1024×768 output is about 84 Neurons, so **roughly 110–120 edits a day free** | $0.011 per 1,000 Neurons (about $0.001 per edit) | **Chosen**: the only option with a recurring free allowance for a real edit model, and cheap after it |
| Google Gemini (AI Studio API) | Gemini 3.1 Flash Image / Flash-Lite Image / 3 Pro Image ("Nano Banana") — the best edit quality | **None for image models in the API**: the pricing page lists the free tier as "Not available" for every image model (free only in the Gemini app and the AI Studio UI) | about $0.034–0.067 per 1K image | Best quality; a good paid upgrade later (one more `ImageEditProvider`) |
| Hugging Face Inference Providers | FLUX.1 Kontext, Qwen-Image-Edit through partner providers | Was $0.10 a month for free accounts; reports from October 2026 say it was removed (PRO: $2 a month) | Provider rates | Too little free use |
| Together AI | FLUX.1 Kontext [pro]/[max] | Free endpoint only for FLUX.1 [schnell], which cannot edit | about $0.04 per image | No free editing |
| fal | FLUX Kontext, Qwen-Image-Edit, Gemini image | One-off sign-up credits at most | $0.02–0.04 per image | No recurring free use |
| Replicate | FLUX Kontext, many edit models | Small trial credit at most | Per second or per image | No recurring free use |
| Stability AI | Search-and-replace, remove background, inpaint | 25 credits once ($0.25) | about $0.03–0.05 per edit | No recurring free use |

**Choice: Cloudflare Workers AI, FLUX.2 [klein] 4B.** Limits to know (from Cloudflare's documentation): the request is
multipart form data; each input image must be smaller than 512×512 (the provider shrinks the image to fit before sending,
so the model sees at most 512 px); output 256–1920 px per side (we ask for the input's aspect ratio, up to 1024 px);
4 fixed steps; the result comes back as base64. Cloudflare runs a safety filter and refuses some outputs (error 3030),
which users see as "The AI service declined this edit". It regenerates the picture rather than editing pixels in
place, so fine detail and faces can change; "remove the background" gives a plain background, not transparency.

Setup: create a free Cloudflare account → Workers AI → copy the **Account ID**; My Profile → API Tokens → Create Token
→ template "Workers AI" (permission Account · Workers AI · Read/Edit). Put both in `coude-disk-bakend/.env` as
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` and set `AI_IMAGE_PROVIDER=cloudflare`.

Swapping later: `ImageEditProvider` has one method (`edit(image, prompt, size) → image`); Gemini or fal would be one more
class and one more value of `AI_IMAGE_PROVIDER`. Nothing in the editor or the endpoint names Cloudflare.

---

## 5. Acceptance criteria (MVP done when)

1. Double-click or Open on a JPEG, PNG, WebP, GIF, HEIC, AVIF or BMP in the portal opens it in the Images app on port
   5179; EDITOR+ users can save JPEG/PNG/WebP in place, everyone can save as a copy where they may add files.
2. Rotate, flip, crop (free and every preset), resize, every adjustment, every look with strength, HSL and curves change
   the preview, undo/redo walk back and forth exactly, and the before/after view shows the opened image.
3. Save stores a new version in the existing storage (local or B2), counted toward the drive; version history shows the
   original upload, which opens and restores. Save as copy creates a new file in the same folder and opens it.
4. A second tab gets "X is editing"; a stale save gets the conflict bar; no edits are lost.
5. Edit by prompt runs through `POST /api/v1/ai/images/edit`, shows the result to accept or discard, respects the
   organization switch, block, monthly image limit, rate limit and size limit, and explains when no provider is set up.
   The provider key never reaches the browser. Tests use a fake provider and never call Cloudflare.
6. Tests: pixel pipeline (geometry, adjustments, looks, HSL, curves, resize, sharpen), history, crop maths, formats, the
   editor with a fake codec, home and AI panel (frontend); provider request/response handling against a local fake
   server and the endpoint's checks (backend). Builds and tests pass in every project touched; the flow is checked in a
   browser.
7. README.md, `docs/implementation-plan.md` (milestone log), `.env.example` files (5179 origin, image AI keys) are
   updated.

---

## 6. Build plan

| Step | Content |
|---|---|
| I-1 | Backend: `ImageEditProvider` (none, Cloudflare), `POST /api/v1/ai/images/edit` with checks and usage, image fields in `GET /api/v1/ai/status`, 5179 in CORS defaults and `.env.example`; tests with a fake provider and a local fake Cloudflare server |
| I-2 | `cloud-disk-images-frontend`: host code copied from Sheets (session, API, editor backend), Images home, image page; `editor-core` copy with an explicit-save hook |
| I-3 | `editor-images`: pipeline, codec, canvas view, tools panel, crop overlay, curves, history, compare, save/copy/download |
| I-4 | AI panel (edit by prompt) |
| I-5 | Portal: images open in the Images app; sign-in `next` accepts the Images address |
| I-6 | Browser check against a test backend; documentation |
