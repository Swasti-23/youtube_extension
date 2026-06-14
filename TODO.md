# YouTube Deep-Dive Extractor — Task Tracker

> Derived from `ROADMAP.md`. Every task has context explaining *what* and *why*.
> Mark items `[x]` as you complete them. Add new tasks as they're discovered.
> 
> **Current Phase:** Phase 3 — Backend Serverless Proxy Layer

---

## Phase 0 — Project Scaffolding & Manifest V3 Shell

> **Why this phase exists:** Nothing can be built until the extension loads in Chrome. This phase creates the directory structure mandated by `02-tech.mdc`, configures Manifest V3 permissions, and proves the empty shell works end-to-end.

- [x] **Create directory tree**
  Create `extension/sidepanel/` and `backend/api/`. These are the only two nested directories mandated by the tech rules. No other directories should exist yet.

- [x] **Write `extension/manifest.json`**
  Manifest V3 declaration. Must include:
  - `manifest_version: 3`
  - `permissions: ["sidePanel", "activeTab", "storage", "tabs", "scripting"]`
  - `side_panel.default_path: "sidepanel/sidepanel.html"`
  - `background.service_worker: "background.js"`
  - `content_scripts` matching `*://*.youtube.com/*`
  No `"<all_urls>"` in host_permissions — scope to YouTube only.

- [x] **Write `extension/background.js`**
  Bare service worker with a `chrome.runtime.onInstalled` listener that logs `"[YT Deep-Dive] Service worker registered"`. Nothing else yet — the message router comes in Phase 1.

- [x] **Write `extension/content.js`**
  Bare content script with a `console.log("[YT Deep-Dive] Content script injected")`. Confirms the script is running on YouTube pages. No DOM manipulation yet.

- [x] **Write `extension/sidepanel/sidepanel.html`**
  Minimal HTML shell. Must reference `sidepanel.css` and `sidepanel.js`. Use a clean semantic structure: `<header>`, `<main>`, `<footer>`. The `<main>` element will become the mount point for all feature content.

- [x] **Write `extension/sidepanel/sidepanel.css`**
  CSS reset (box-sizing, margin/padding zero), `:root` custom properties for all design tokens (colors, spacing, radii, fonts). No component styles yet — just the foundation.

- [x] **Write `extension/sidepanel/sidepanel.js`**
  Add a `DOMContentLoaded` listener that logs `"[YT Deep-Dive] Sidepanel ready"`. This proves the JS file loaded and the panel is functional.

- [x] **Write `backend/api/extract.js`**
  Placeholder serverless function. Exports a handler that returns `{ status: 501, body: { success: false, error: "Not implemented" } }`. This creates the file at the correct path so it's ready for Phase 3.

- [x] **Write `backend/api/sync.js`**
  Same placeholder pattern as `extract.js` — returns `501 Not Implemented`.

- [x] **Write `.gitignore`**
  Ignore: `node_modules/`, `.env`, `.env.local`, `dist/`, `.DS_Store`, `*.log`.

- [x] **Initial git commit**
  Stage all files. Commit message: `"Phase 0: project scaffold with MV3 manifest and directory structure"`.

### Phase 0 — Verification

- [x] Extension loads in `chrome://extensions` (Load Unpacked) with zero errors and zero warnings
- [x] YouTube page shows content script log in DevTools console
- [x] Clicking extension icon opens the side panel with the HTML shell
- [x] Service worker shows "registered" in extension detail view
- [x] `git log` confirms the initial commit

---

## Phase 1 — Message Backbone & Cross-Context Communication

> **Why this phase exists:** Every feature (transcript extraction, LLM calls, timestamp seeking) requires messages to flow between content script ↔ background ↔ sidepanel. Building this bus now means features just add action cases — they never reinvent messaging.

- [x] **Define message protocol shape**
  Standard shape for every message: `{ action: string, payload: object, tabId?: number }`. Standard response: `{ success: boolean, data?: object, error?: string }`. Document in a comment block at the top of `background.js`.

- [x] **Implement central message router in `background.js`**
  Add `chrome.runtime.onMessage` listener with a `switch` on `message.action`. Initial actions: `"PING"` returns `{ status: "PONG" }`. Use `sendResponse` with `return true` for async handlers.

- [x] **Add `RELAY_TO_TAB` action in `background.js`**
  Receives `{ tabId, payload }`. Forwards payload to the specified tab via `chrome.tabs.sendMessage(tabId, payload)`. Returns the tab's response.

- [x] **Add `RELAY_TO_SIDEPANEL` action in `background.js`**
  Forwards payload via `chrome.runtime.sendMessage`. The sidepanel (which listens on `chrome.runtime.onMessage`) picks it up.

- [x] **Implement message listener in `content.js`**
  Add `chrome.runtime.onMessage` listener. For now, log received messages. Respond with `{ success: true }` for any recognized action.

- [x] **Implement `sendToBackground` helper in `content.js`**
  Promise-based wrapper: `sendToBackground(action, payload) → Promise<response>`. Checks `chrome.runtime.lastError` and rejects on error.

- [x] **Implement message listener in `sidepanel.js`**
  Add `chrome.runtime.onMessage` listener. Log received messages. This is how background relays data to the panel.

- [x] **Implement `sendToBackground` helper in `sidepanel.js`**
  Same Promise-based wrapper pattern as content.js.

- [x] **Add error handling for `chrome.runtime.lastError`**
  In every `sendMessage` callback/Promise, check `chrome.runtime.lastError`. If set, log the error and reject the Promise.

### Phase 1 — Verification

- [x] Sidepanel sends `PING`, receives `PONG` in console
- [x] Sidepanel sends `RELAY_TO_TAB`, content script logs the payload
- [x] Content script sends `RELAY_TO_SIDEPANEL`, sidepanel logs the payload
- [x] Malformed message logs an error, does not crash the service worker
- [x] Message flows work after navigating between YouTube videos (no extension reload needed)

---

## Phase 2 — Transcript Extraction Pipeline

> **Why this phase exists:** Every feature depends on the video transcript. This phase builds the content script's ability to scrape it from YouTube's DOM, pass it through the message bus, and display it in the sidepanel.

- [x] **Write `extractTranscript()` in `content.js`**
  Scrapes YouTube's transcript. Strategy:
  1. Try to find transcript data in `ytInitialPlayerResponse` (fast, no DOM click).
  2. Fallback: click "Show transcript" button, wait for DOM population via `MutationObserver`.
  3. Parse segments into `{ timestamp: "MM:SS", text: "string" }[]`.
  4. Return the array. On failure, return `{ error: "TRANSCRIPT_UNAVAILABLE" }`.

- [x] **Add `GET_TRANSCRIPT` action in `background.js`**
  Queries the active tab, sends `"GET_TRANSCRIPT"` to its content script, and returns the transcript data to the caller (sidepanel).

- [x] **Request transcript on sidepanel open**
  In `sidepanel.js`, on `DOMContentLoaded`: query active tab ID → send `GET_TRANSCRIPT` → on success, render timestamped lines → on failure, show "Transcript unavailable" + retry button.

- [x] **Add transcript container to `sidepanel.html`**
  A `<div id="transcript-container">` inside `<main>`. This is where raw transcript lines will render during Phase 2 (replaced by feature tabs in Phase 5).

- [x] **Style the raw transcript view in `sidepanel.css`**
  Timestamp in monospace, text in regular font. Each line is a flex row. Scrollable container.

- [x] **Handle edge cases**
  Video has no transcript → clear message. User navigates mid-extraction → abort and retry. Transcript language selector → take the first available language.

- [x] **Sanitize all transcript text before DOM insertion**
  Use `textContent` only. No `innerHTML` anywhere. This is a hard rule from the security constraints.

### Phase 2 — Verification

- [x] Sidepanel on a video with transcript → shows timestamped text within 3 seconds
- [x] Sidepanel on a video without transcript → "Transcript unavailable" + retry button
- [x] Navigate to new video, re-open sidepanel → new transcript loads
- [x] Zero `innerHTML` matches in code search
- [x] Transcript matches YouTube's native transcript panel word-for-word

---

## Phase 3 — Backend Serverless Proxy Layer

> **Why this phase exists:** The PRD mandates zero client-side API keys. This phase builds the secure backend that receives transcript + skill name, calls the LLM, validates the response against the schemas in `03-skills.mdc`, and returns structured JSON.

- [x] **Initialize `backend/package.json`**
  Add dependencies: LLM SDK (e.g., `openai` or `@google/generative-ai`), a lightweight schema validator. Set `"type": "module"` for ES module support.

- [x] **Create `backend/.env.example`**
  Document all required env vars: `LLM_API_KEY`, `LLM_MODEL`, `LLM_PROVIDER`, `ALLOWED_ORIGIN`, `DATABASE_URL`. Never commit actual `.env` (already in `.gitignore`).

- [x] **Implement `backend/shared/schemas.js`**
  Three validation functions — one per skill. Each checks structural shape (required keys, correct types, arrays are arrays). Returns `{ valid: boolean, errors: string[] }`. Does NOT validate content quality.

- [x] **Implement `backend/shared/prompt-templates.js`**
  Exports `getPromptForSkill(skillName, transcript, params)` → `{ system, user }`. System prompt defines role + JSON-only output + exact schema shape. User prompt contains transcript. Transcript capped at 80K chars.

- [x] **Implement `backend/api/extract.js`**
  Full serverless handler:
  1. Parse body → validate `skill` is in allowlist → validate `transcript` exists.
  2. Build prompt via `getPromptForSkill()`.
  3. Call LLM provider (key from env).
  4. Parse response as JSON → validate against schema.
  5. On valid: return `{ success: true, data }`.
  6. On invalid: retry once → on second failure: return `{ success: false, error }`.

- [x] **Add CORS headers to `extract.js`**
  `Access-Control-Allow-Origin` set to `process.env.ALLOWED_ORIGIN` only. Handle `OPTIONS` preflight with `204`.

- [x] **Add basic rate limiting or auth token check**
  Prevent abuse. Simple per-IP rate limit (10 req/min) or a shared secret token in the `Authorization` header.

- [x] **Enhance `backend/api/sync.js` stub**
  Accept cache-write requests (body: `{ videoId, skill, data }`). Return `501` for GET until Phase 4 implements the database.

### Phase 3 — Verification

- [ ] `curl POST /api/extract` with `generate_structured_notes` → valid Skill 1 JSON returned
- [ ] Same for `extract_math_and_logic` and `simulate_dry_run_trace`
- [ ] Unknown skill → `400` error
- [ ] Missing auth → `401` error
- [ ] `LLM_API_KEY` never appears in any response
- [ ] CORS blocks non-extension origins

---

## Phase 4 — Two-Tier Caching System

> **Why this phase exists:** LLM calls are slow (~5-10s) and expensive. This phase implements L1 cache (`chrome.storage.local`) + L2 cache (backend database) so repeat visits to the same video are instant.

- [ ] **Design cache key format**
  Pattern: `"yt_<videoId>_<skillName>"`. For dry run tracer: `"yt_<videoId>_simulate_dry_run_trace_<inputHash>"`. Keys must be deterministic and collision-free.

- [ ] **Add `CACHE_GET` action in `background.js`**
  Receives `{ videoId, skill }`. Builds cache key. Calls `chrome.storage.local.get(key)`. Checks TTL (7 days). Returns `{ hit: boolean, data: object | null }`.

- [ ] **Add `CACHE_SET` action in `background.js`**
  Receives `{ videoId, skill, data }`. Writes `{ [key]: { data, cachedAt: Date.now() } }` to `chrome.storage.local`.

- [ ] **Implement `fetchWithCache()` in `sidepanel.js`**
  The central data pipeline every feature uses:
  1. L1 check (`CACHE_GET`) → if hit, return immediately.
  2. L2 check (`GET /api/sync?videoId=X&skill=Y`) → if hit, backfill L1, return.
  3. LLM call (`POST /api/extract`) → on success, write to L1 and L2, return.
  This function is the **only** way features access data. Direct `fetch()` calls are forbidden.

- [ ] **Implement `sync.js` fully**
  `GET /api/sync?videoId=X&skill=Y` → query database for cached result. Check `createdAt` for TTL.
  `POST /api/sync` body `{ videoId, skill, data }` → write to database.

- [ ] **Wire `extract.js` to write to L2 after successful LLM call**
  After the LLM returns valid data, call the sync write logic internally (not via HTTP) to persist to the database.

- [ ] **Add TTL expiry logic**
  Both L1 and L2 cache entries older than 7 days are treated as misses. Compare `cachedAt`/`createdAt` against `Date.now()`.

### Phase 4 — Verification

- [ ] First visit → LLM called (visible in DevTools network tab)
- [ ] Second visit → no LLM call, data from L1 cache (instant)
- [ ] Clear `chrome.storage.local` → data from L2 (no LLM call)
- [ ] Clear both → LLM called, both caches repopulated
- [ ] 7-day-old entry treated as cache miss
- [ ] `chrome.storage.local.getBytesInUse` < 4 MB after 20 cached videos

---

## Phase 5 — Feature: Structural Smart Summary

> **Why this phase exists:** First real user-facing feature. Turns the raw transcript into structured, readable notes using the `generate_structured_notes` LLM skill. Establishes the tab navigation pattern that all other features will follow.

- [ ] **Add tab navigation to `sidepanel.html`**
  Three tabs: Smart Summary | Math & Logic | Dry Run. Tab bar at the top. Content area below. Only one tab active at a time.

- [ ] **Implement tab switching in `sidepanel.js`**
  Click handler on each tab button. Calls `destroy()` on outgoing feature, `init()` on incoming feature. Active tab gets `.active` class.

- [ ] **Implement Smart Summary feature lifecycle**
  `init(container)`: show loading skeleton (3 card-shaped placeholders).
  `render(data)`: build DOM for core_concepts, problem_solving_rationale, key_takeaways.
  `destroy()`: clear container, remove event listeners.

- [ ] **Build core_concepts renderer**
  Each concept → a card with: `[timestamp]` badge (as `.timestamp-badge`), concept title as heading, bullet points as a list. All via `createElement` + `textContent`.

- [ ] **Build problem_solving_rationale renderer**
  Highlighted block with two sections: "Problem Statement" and "Why This Approach". Visually distinct from concept cards.

- [ ] **Build key_takeaways renderer**
  List of takeaway items at the bottom of the summary. Can be chips/tags or a simple ordered list.

- [ ] **Finalize `generate_structured_notes` prompt template**
  In `backend/shared/prompt-templates.js`: system prompt with role definition, JSON-only instruction, and exact schema example. User prompt with transcript text.

- [ ] **Add retry button for backend failures**
  If `fetchWithCache` fails, call `showRetry(container, message, retryCallback)` from the shared retry component.

### Phase 5 — Verification

- [ ] CS/math video → structured notes render within 8 seconds
- [ ] Core concepts show timestamp badges, titles, bullet points
- [ ] Problem-solving rationale renders as a distinct block
- [ ] Key takeaways render as a list/chip row
- [ ] Loading skeleton appears during fetch
- [ ] Network failure → retry button → clicking it re-attempts successfully
- [ ] Second visit → cached, renders in < 200ms

---

## Phase 6 — Feature: Math & Logic Deep-Dive Extractor

> **Why this phase exists:** Technical videos contain math formulas and algorithmic logic that are hard to capture from watching. This feature extracts them and renders LaTeX (via KaTeX, bundled locally per MV3 rules) and pseudocode blocks.

- [ ] **Bundle KaTeX locally**
  Download `katex.min.js` and `katex.min.css` (plus font files) into `extension/sidepanel/lib/`. MV3 forbids CDN loading — everything must be local.

- [ ] **Reference KaTeX from `sidepanel.html`**
  `<link>` tag for `lib/katex.min.css`. `<script>` tag for `lib/katex.min.js`. Both loaded before `sidepanel.js`.

- [ ] **Implement Math & Logic feature lifecycle**
  `init(container)`: show skeleton blocks (2 tall rectangles).
  `render(data)`: build math blocks and/or logic blocks based on `has_math`/`has_logic` flags.
  `destroy()`: clear container.

- [ ] **Build math_blocks renderer**
  If `has_math === true`: iterate `math_blocks[]`. For each: description label above, `katex.render(latex_expression, div)` below. Wrap `katex.render` in try/catch — fallback to raw LaTeX in `<code>` on parse error.
  If `has_math === false`: show "No mathematical expressions detected in this video."

- [ ] **Build logic_blocks renderer**
  If `has_logic === true`: iterate `logic_blocks[]`. For each: `block_title` as heading, `pseudocode` in `<pre><code>` with `textContent` (never innerHTML).
  If `has_logic === false`: show "No logic/pseudocode blocks detected in this video."

- [ ] **Finalize `extract_math_and_logic` prompt template**
  System prompt must explicitly request `$$...$$` delimited LaTeX and clean pseudocode. Include the exact Skill 2 schema in the system prompt.

### Phase 6 — Verification

- [ ] Neural network video → renders typeset math (e.g., sigma function formula)
- [ ] Sorting video → renders pseudocode blocks
- [ ] Non-technical video → "not detected" messages
- [ ] KaTeX works fully offline (disconnect network after extension loads)
- [ ] Malformed LaTeX → falls back to raw text, no crash
- [ ] Zero network requests to CDNs from KaTeX

---

## Phase 7 — Feature: Interactive Dry Run Tracer

> **Why this phase exists:** Passive watching doesn't build execution intuition. This feature lets users input an array, the LLM simulates step-by-step execution of the algorithm from the video, and renders an interactive trace table with step-by-step highlighting.

- [ ] **Build input form in Dry Run tab**
  Text input with placeholder `"e.g. 3, 1, 4, 1, 5"`. "Run Trace" button (disabled until valid). Validation: max 8 comma-separated elements, each ≤ 15 characters. Inline error message on constraint violation.

- [ ] **Implement input validation**
  Parse comma-separated input. Check element count (≤ 8) and per-element length (≤ 15 chars). Enable "Run Trace" button only when valid. Show specific error: "Maximum 8 elements allowed" or "Element exceeds 15 character limit".

- [ ] **Implement Dry Run feature lifecycle**
  `init(container)`: show input form + skeleton table below.
  `render(data)`: build trace table + step navigation controls.
  `destroy()`: clear container, reset `currentStep` to 0.

- [ ] **Build trace table renderer**
  `input_received` → label above table.
  `variable_tracking_headers[]` → `<thead>` row.
  `trace_steps[][]` → `<tbody>` rows.
  `final_state_summary` → summary block below table.
  Table uses `table-layout: fixed` for the 400px sidepanel width.

- [ ] **Build step-by-step highlight controls**
  "Next Step" / "Prev Step" buttons below the table. `currentStep` state tracks highlighted row. Active row gets `.dry-run__row--active` class. Counter: "Step 3 of 7". Wrap at boundaries (step 1 ← prev = step 1, last → next = last).

- [ ] **Implement input-aware cache key**
  Cache key: `"yt_<videoId>_simulate_dry_run_trace_<inputHash>"`. Hash the user's input string to create a unique cache entry per input combination.

- [ ] **Finalize `simulate_dry_run_trace` prompt template**
  System prompt with the exact Skill 3 schema. User prompt must include both the transcript AND the `params.input` array. Instruct the LLM to simulate execution step by step.

### Phase 7 — Verification

- [ ] Input `"3, 1, 4, 1, 5"` on sorting video → valid trace table renders
- [ ] 9+ elements → validation error, button disabled
- [ ] Element > 15 chars → validation error
- [ ] "Next Step" / "Prev Step" → correct row highlighted, wraps at boundaries
- [ ] Step counter shows "Step N of M"
- [ ] Same input on same video → cached on second run
- [ ] Final state summary renders below table

---

## Phase 8 — Feature: Interactive Timeline Sync

> **Why this phase exists:** Timestamp badges rendered in Smart Summary (and potentially other features) should be clickable. Clicking `[04:12]` should seek the YouTube player to 4:12. This connects the sidepanel insights back to the video.

- [ ] **Add `SEEK_TO_TIMESTAMP` handler in `content.js`**
  Receives `{ seconds: number }`. Finds `document.querySelector("video")`. Sets `video.currentTime = seconds`. Calls `video.play()` if paused. Returns `{ success: true/false }`.

- [ ] **Add `SEEK_TO_TIMESTAMP` action in `background.js`**
  Relays the seek request from sidepanel to the active tab's content script.

- [ ] **Write `parseTimestampToSeconds()` in `sidepanel.js`**
  Converts `"MM:SS"` → seconds (e.g., `"04:12"` → `252`). Also handles `"HH:MM:SS"` format.

- [ ] **Attach click handlers to timestamp badges**
  After any feature's `render()` completes, scan the container for all `.timestamp-badge` elements. Attach click listener → `sendToBackground("SEEK_TO_TIMESTAMP", { seconds })`. Show toast "Jumped to MM:SS" on success.

- [ ] **Style clickable timestamps**
  `cursor: pointer`, subtle background, monospace font, hover underline, active color pulse.

- [ ] **Handle edge case: video element not found**
  If `document.querySelector("video")` returns null (PiP, mini-player), return `{ success: false, error: "Video player not found" }`. Sidepanel shows a brief toast notification.

### Phase 8 — Verification

- [ ] Clicking `[04:12]` → video seeks to 4:12
- [ ] Video resumes playing after seek (if it was playing)
- [ ] Timestamps work after navigating to a different video
- [ ] Hover shows pointer cursor + visual feedback
- [ ] Video element unavailable → toast notification in sidepanel

---

## Phase 9 — Error Handling, UX Polish & XSS Hardening

> **Why this phase exists:** Features are built but not battle-tested. This phase audits every code path for XSS safety, adds polished error/loading states, and handles every edge case before we ship.

- [ ] **XSS audit: search `extension/` for `innerHTML`**
  Must return zero matches. Also check for `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function(`.

- [ ] **XSS audit: verify KaTeX input safety**
  Confirm `katex.render()` only receives the `latex_expression` field, never raw HTML. Confirm try/catch with safe fallback.

- [ ] **XSS audit: verify pseudocode safety**
  Confirm all `<pre><code>` blocks use `textContent`, not `innerHTML`.

- [ ] **Build reusable `showRetry()` function**
  `showRetry(container, message, retryCallback)`. Clears container, shows error icon + message + "Try Again" button. Button invokes the retry callback.

- [ ] **Build CSS-only loading skeletons**
  Skeleton pulse animation. One skeleton shape per feature (cards for summary, blocks for math, rows for table). `min-height` to prevent layout shift.

- [ ] **Build toast notification system**
  Appears at bottom of sidepanel. Auto-dismiss after 3 seconds. Max one visible. For transient feedback ("Jumped to 04:12", "Seek failed").

- [ ] **Handle non-YouTube tab**
  If active tab isn't `youtube.com`, show "Navigate to a YouTube video to get started" with an appropriate visual.

- [ ] **Handle YouTube Shorts and Live streams**
  Detect `/shorts/` in URL → show "Not supported for Shorts".
  Detect live badge → show "Not supported for live streams".

- [ ] **Handle service worker termination (MV3 lifecycle)**
  If `chrome.runtime.lastError` indicates the worker is gone, the next message will wake it. No user-visible error needed — just retry the message.

- [ ] **Backend input sanitization**
  Reject transcript > 100 KB → `413`. Strip HTML tags from transcript before LLM. Validate `skill` against allowlist.

### Phase 9 — Verification

- [ ] `rg "innerHTML" extension/` → zero matches
- [ ] Network disconnect → retry component → reconnect + retry succeeds
- [ ] Every tab shows loading skeleton matching final layout
- [ ] Non-YouTube tab → guidance message
- [ ] YouTube Shorts → "Not supported"
- [ ] Backend rejects 200 KB payload → `413`
- [ ] Full happy-path walkthrough of all 4 features → zero console errors

---

## Phase 10 — Production Readiness & Deployment

> **Why this phase exists:** The extension works locally. This phase prepares it for real users: Chrome Web Store compliance, backend deployment, performance verification, and documentation.

- [ ] **Permissions audit**
  Review every permission in `manifest.json`. Remove any that aren't actively used. Verify `host_permissions` is scoped to YouTube + backend domain only.

- [ ] **Performance budget verification**
  - Sidepanel shell render < 200ms
  - Cached feature render < 300ms
  - Uncached (LLM round-trip) < 10s
  - Extension package < 2 MB

- [ ] **Create extension icons**
  16x16, 48x48, 128x128 PNG icons. Place in `extension/icons/`. Reference in `manifest.json` `"icons"` field.

- [ ] **Deploy backend to serverless platform**
  Choose Vercel or Cloudflare Workers. Deploy `backend/`. Set env vars: `LLM_API_KEY`, `LLM_MODEL`, `ALLOWED_ORIGIN`, `DATABASE_URL`. Verify production endpoint responds.

- [ ] **Update extension to use production backend URL**
  Replace local dev URL with the deployed production URL. Use a config constant, not a hardcoded string in fetch calls.

- [ ] **Write `README.md`**
  Project overview. Local development setup (extension + backend). Architecture diagram (text-based). Environment variables reference. A new developer should be able to set up the project by following it.

- [ ] **Final end-to-end test**
  Load extension → open YouTube → open sidepanel → Smart Summary → Math & Logic → Dry Run → Timeline Sync → verify caching → verify error states.

- [ ] **Git commit per phase**
  Ensure the repo has a clean commit history with one descriptive commit per phase.

### Phase 10 — Verification

- [ ] Extension loads with zero errors and zero warnings in `chrome://extensions`
- [ ] All 4 features work end-to-end on a live YouTube video
- [ ] Cached responses load in < 300ms
- [ ] Extension package < 2 MB
- [ ] Backend deployed and responding on production URL
- [ ] `README.md` complete — new developer can onboard from it
- [ ] Clean git history: one commit per phase
