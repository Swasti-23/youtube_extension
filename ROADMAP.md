# YouTube Deep-Dive Extractor — Engineering Roadmap

> **Governing documents:** `.cursor/rules/01-prd.mdc`, `02-tech.mdc`, `03-skills.mdc`
> **Mandate:** Manifest V3 · Zero client-side API keys · Two-tier caching · XSS-safe rendering

---

## Phase 0 — Project Scaffolding & Manifest V3 Shell

**Goal:** Create every directory and placeholder file mandated by `02-tech.mdc`, configure `manifest.json` with the correct Manifest V3 permissions, and prove the empty extension loads in Chrome without errors.

### Files Created

| File | Purpose |
|------|---------|
| `extension/manifest.json` | Manifest V3 declaration — permissions, service worker, side panel, content script |
| `extension/background.js` | Empty service worker (will become the message router) |
| `extension/content.js` | Empty content script targeting `youtube.com` |
| `extension/sidepanel/sidepanel.html` | Minimal HTML shell for the side panel |
| `extension/sidepanel/sidepanel.css` | Base reset + layout variables |
| `extension/sidepanel/sidepanel.js` | Empty entry point |
| `backend/api/extract.js` | Placeholder serverless function (returns `501 Not Implemented`) |
| `backend/api/sync.js` | Placeholder serverless function (returns `501 Not Implemented`) |
| `.gitignore` | Ignore `node_modules/`, `.env`, and build artifacts |

### Micro-Task Checklist

- [ ] Create directory tree: `extension/sidepanel/`, `backend/api/`
- [ ] Write `manifest.json` with:
  - `manifest_version: 3`
  - `permissions: ["sidePanel", "activeTab", "storage", "tabs", "scripting"]`
  - `side_panel.default_path: "sidepanel/sidepanel.html"`
  - `background.service_worker: "background.js"`
  - `content_scripts` array matching `*://*.youtube.com/*`
- [ ] Create `background.js` with a bare `chrome.runtime.onInstalled` listener that logs readiness
- [ ] Create `content.js` with a bare `console.log` confirming injection on YouTube
- [ ] Create `sidepanel.html` loading `sidepanel.css` + `sidepanel.js`
- [ ] Create `sidepanel.css` with CSS reset, `:root` custom properties for spacing/colors
- [ ] Create `sidepanel.js` with a `DOMContentLoaded` listener logging readiness
- [ ] Create `backend/api/extract.js` exporting a handler that returns `{ status: 501 }`
- [ ] Create `backend/api/sync.js` exporting a handler that returns `{ status: 501 }`
- [ ] Write `.gitignore`
- [ ] Initial git commit

### Chrome APIs & Key Variables

| API / Variable | Usage |
|----------------|-------|
| `chrome.runtime.onInstalled` | Confirm service worker registration |
| `chrome.sidePanel` | Declared in manifest; panel opens via browser action |
| `manifest.content_scripts[].matches` | `["*://*.youtube.com/*"]` |
| `manifest.permissions` | `sidePanel`, `activeTab`, `storage`, `tabs`, `scripting` |

### Definition of Done

- [ ] `chrome://extensions` → Load Unpacked → extension loads with **zero errors** and **zero warnings**
- [ ] Navigating to any YouTube video shows `content.js` log in the page console
- [ ] Clicking the extension icon opens the side panel with the HTML shell visible
- [ ] Service worker shows "registered" in `chrome://extensions` detail view
- [ ] `git log` shows the initial commit with all files tracked

---

## Phase 1 — Message Backbone & Cross-Context Communication

**Goal:** Establish reliable, type-safe message passing between all three extension contexts (content script ↔ service worker ↔ side panel) so every future feature can send and receive messages without writing new plumbing.

### Files Modified

| File | Changes |
|------|---------|
| `extension/background.js` | Central message router with action-based dispatch |
| `extension/content.js` | Sends/receives messages to background |
| `extension/sidepanel/sidepanel.js` | Sends/receives messages to background |

### Micro-Task Checklist

- [ ] Define a message protocol object shape: `{ action: string, payload: any, tabId?: number }`
- [ ] In `background.js`, implement `chrome.runtime.onMessage` listener with a `switch` on `action`
- [ ] Add action: `"PING"` → responds `{ status: "PONG" }` (health-check route)
- [ ] Add action: `"RELAY_TO_TAB"` → forwards `payload` to the specified `tabId` via `chrome.tabs.sendMessage`
- [ ] Add action: `"RELAY_TO_SIDEPANEL"` → forwards via `chrome.runtime.sendMessage` (sidepanel listens globally)
- [ ] In `content.js`, implement `chrome.runtime.onMessage` listener for messages from background
- [ ] In `content.js`, expose a helper: `sendToBackground(action, payload)` wrapping `chrome.runtime.sendMessage`
- [ ] In `sidepanel.js`, implement `chrome.runtime.onMessage` listener for messages from background
- [ ] In `sidepanel.js`, expose a helper: `sendToBackground(action, payload)` wrapping `chrome.runtime.sendMessage`
- [ ] Add error handling: if `chrome.runtime.lastError` is set, log it and reject the promise

### Chrome APIs & Key Variables

| API / Variable | Usage |
|----------------|-------|
| `chrome.runtime.sendMessage` | Sidepanel/content → background |
| `chrome.runtime.onMessage` | Background listens for all messages |
| `chrome.tabs.sendMessage` | Background → specific content script tab |
| `chrome.tabs.query` | Resolve active tab ID for routing |
| `chrome.runtime.lastError` | Error detection on every message callback |
| `action` (string) | Dispatch key: `"PING"`, `"RELAY_TO_TAB"`, `"RELAY_TO_SIDEPANEL"` |

### Definition of Done

- [ ] Sidepanel sends `PING` → receives `PONG` (visible in sidepanel console)
- [ ] Sidepanel sends `RELAY_TO_TAB` → content script receives the payload and logs it
- [ ] Content script sends `RELAY_TO_SIDEPANEL` → sidepanel receives and logs it
- [ ] Intentionally sending a malformed message logs a clean error, does not crash the service worker
- [ ] All message flows work after navigating between YouTube videos without extension reload

---

## Phase 2 — Transcript Extraction Pipeline

**Goal:** When the user opens the side panel on a YouTube video, automatically extract the video's transcript text (with timestamps) from the page DOM and deliver it to the sidepanel for display.

### Files Modified

| File | Changes |
|------|---------|
| `extension/content.js` | Transcript scraping logic from YouTube's DOM |
| `extension/background.js` | New action: `"GET_TRANSCRIPT"` route |
| `extension/sidepanel/sidepanel.js` | Request transcript on panel open, render raw text |
| `extension/sidepanel/sidepanel.html` | Add transcript container element |
| `extension/sidepanel/sidepanel.css` | Style the raw transcript view |

### Micro-Task Checklist

- [ ] In `content.js`, write `extractTranscript()`:
  - Click YouTube's "Show transcript" button programmatically (or scrape from `ytInitialPlayerResponse`)
  - Wait for transcript panel DOM to populate
  - Parse each `<yt-formatted-string>` segment into `{ timestamp: "MM:SS", text: "string" }` objects
  - Return the array via message response
- [ ] In `background.js`, add `"GET_TRANSCRIPT"` action → `chrome.tabs.sendMessage` to the active tab, returns result to caller
- [ ] In `sidepanel.js`, on `DOMContentLoaded`:
  - Query active tab ID via `chrome.tabs.query({ active: true, currentWindow: true })`
  - Send `"GET_TRANSCRIPT"` to background
  - On success: render timestamped lines in the transcript container
  - On failure: show "Transcript unavailable" with a retry button
- [ ] Handle edge cases: video has no transcript, user navigates mid-extraction, transcript language selector
- [ ] Sanitize all text content before DOM insertion (no raw `innerHTML`)

### Chrome APIs & Key Variables

| API / Variable | Usage |
|----------------|-------|
| `chrome.tabs.query` | Get active YouTube tab ID |
| `chrome.tabs.sendMessage` | Background asks content script for transcript |
| `document.querySelector` / `querySelectorAll` | DOM scraping in content script |
| `MutationObserver` | Wait for transcript panel to load in YouTube DOM |
| `transcript[]` | Array of `{ timestamp: string, text: string }` — the raw data pipeline |

### Definition of Done

- [ ] Opening sidepanel on a YouTube video with a transcript shows timestamped text within 3 seconds
- [ ] Opening sidepanel on a video without a transcript shows "Transcript unavailable" + retry button
- [ ] Navigating to a new YouTube video and re-opening sidepanel fetches the new transcript
- [ ] No `innerHTML` used — verified via code search
- [ ] Transcript text is identical to what YouTube's native transcript panel shows

---

## Phase 3 — Backend Serverless Proxy Layer

**Goal:** Stand up the serverless backend that receives transcript + skill name from the extension, calls the LLM provider with the correct prompt template, validates the response against `03-skills.mdc` schemas, and returns structured JSON. **Zero API keys exposed to the client.**

### Files Created / Modified

| File | Changes |
|------|---------|
| `backend/api/extract.js` | Full implementation — receives `{ skill, transcript, params }`, calls LLM, validates, responds |
| `backend/api/sync.js` | Stub enhanced — accepts cache-write requests (used in Phase 4) |
| `backend/shared/schemas.js` | **New** — JSON schema validators for all three skills |
| `backend/shared/prompt-templates.js` | **New** — Prompt templates for `generate_structured_notes`, `extract_math_and_logic`, `simulate_dry_run_trace` |
| `backend/package.json` | **New** — Dependencies and serverless config |
| `backend/.env.example` | **New** — Documents required env vars (`LLM_API_KEY`, `LLM_MODEL`, `LLM_PROVIDER`) |

### Micro-Task Checklist

- [ ] Initialize `backend/package.json` with required dependencies (LLM SDK, schema validator)
- [ ] Create `backend/.env.example` listing: `LLM_API_KEY`, `LLM_MODEL`, `LLM_PROVIDER`, `ALLOWED_ORIGIN`
- [ ] Implement `backend/shared/schemas.js`:
  - Export three validation functions: `validateStructuredNotes(data)`, `validateMathLogic(data)`, `validateDryRunTrace(data)`
  - Each validates against the exact shapes defined in `03-skills.mdc`
  - Return `{ valid: boolean, errors: string[] }`
- [ ] Implement `backend/shared/prompt-templates.js`:
  - Export `getPromptForSkill(skillName, transcript, params)` → returns the system + user prompt pair
  - Each prompt explicitly instructs JSON-only output matching the target schema
- [ ] Implement `backend/api/extract.js`:
  - Parse incoming request body: `{ skill: string, transcript: string, params?: object }`
  - Validate `skill` is one of the three known skills
  - Call `getPromptForSkill()` to build the prompt
  - Send to LLM provider (via server-side API key from env)
  - Parse LLM response as JSON
  - Validate with the corresponding schema validator
  - On valid: return `{ success: true, data: <parsed> }`
  - On invalid: retry once, then return `{ success: false, error: "Schema validation failed" }`
- [ ] Add CORS headers: `Access-Control-Allow-Origin` set to extension origin only
- [ ] Add request-level rate limiting or basic auth token check

### Chrome APIs & Key Variables

| API / Variable | Usage |
|----------------|-------|
| `process.env.LLM_API_KEY` | Server-side only — never sent to client |
| `process.env.LLM_PROVIDER` | Selects OpenAI / Google / other |
| `process.env.ALLOWED_ORIGIN` | CORS lock to `chrome-extension://<id>` |
| `req.body.skill` | One of: `generate_structured_notes`, `extract_math_and_logic`, `simulate_dry_run_trace` |
| `req.body.transcript` | Raw transcript text from the extension |
| `req.body.params` | Optional — e.g., `{ input: "3,1,4,1,5" }` for dry run tracer |

### Definition of Done

- [ ] `curl -X POST /api/extract -d '{"skill":"generate_structured_notes","transcript":"sample text"}'` returns valid JSON matching Skill 1 schema
- [ ] Same test for `extract_math_and_logic` and `simulate_dry_run_trace`
- [ ] Sending an unknown `skill` value returns `400` with descriptive error
- [ ] Sending a request without the auth token returns `401`
- [ ] `LLM_API_KEY` never appears in any response body or client-accessible log
- [ ] CORS blocks requests from origins other than the extension

---

## Phase 4 — Two-Tier Caching System

**Goal:** Implement the L1 (`chrome.storage.local`) + L2 (backend database) caching layer so that repeated visits to the same video don't re-invoke the LLM.

### Files Modified

| File | Changes |
|------|---------|
| `extension/sidepanel/sidepanel.js` | Cache-aware fetch logic — check L1 before calling backend |
| `extension/background.js` | New actions: `"CACHE_GET"`, `"CACHE_SET"` wrapping `chrome.storage.local` |
| `backend/api/extract.js` | After LLM call, persist result to L2 database |
| `backend/api/sync.js` | Full implementation — `GET` checks L2, `POST` writes to L2 |

### Micro-Task Checklist

- [ ] Design cache key format: `"yt_<videoId>_<skillName>"` (deterministic, collision-free)
- [ ] In `background.js`, add `"CACHE_GET"` action:
  - Receives `{ videoId, skill }`
  - Builds key, calls `chrome.storage.local.get(key)`
  - Returns `{ hit: boolean, data: object | null }`
- [ ] In `background.js`, add `"CACHE_SET"` action:
  - Receives `{ videoId, skill, data }`
  - Calls `chrome.storage.local.set({ [key]: { data, cachedAt: Date.now() } })`
- [ ] In `sidepanel.js`, implement `fetchWithCache(videoId, skill, params)`:
  - **Step 1:** Send `"CACHE_GET"` — if hit, return cached data immediately
  - **Step 2:** On L1 miss, call `backend/api/sync.js?videoId=X&skill=Y` (L2 lookup)
  - **Step 3:** On L2 hit, write to L1 (backfill), return data
  - **Step 4:** On L2 miss, call `backend/api/extract.js` (LLM invocation)
  - **Step 5:** On LLM success, write to both L1 and L2, return data
- [ ] In `backend/api/sync.js`, implement:
  - `GET /api/sync?videoId=X&skill=Y` → query database, return `{ hit, data }`
  - `POST /api/sync` with body `{ videoId, skill, data }` → write to database
- [ ] In `backend/api/extract.js`, after successful LLM call → also call L2 write internally
- [ ] Add TTL-based expiry check: ignore cache entries older than 7 days

### Chrome APIs & Key Variables

| API / Variable | Usage |
|----------------|-------|
| `chrome.storage.local.get` | L1 cache read |
| `chrome.storage.local.set` | L1 cache write |
| `chrome.storage.local.getBytesInUse` | Monitor storage quota (5 MB limit) |
| Cache key: `"yt_<videoId>_<skill>"` | Deterministic composite key |
| `cachedAt` (timestamp) | TTL expiry comparison |
| L2 database table/collection | `{ videoId, skill, data, createdAt }` |

### Definition of Done

- [ ] First visit to a video → LLM is called (network request visible in DevTools)
- [ ] Second visit to the same video → no LLM call; data loads from L1 cache instantly
- [ ] Clear `chrome.storage.local` → next visit loads from L2 (backend DB) without calling LLM
- [ ] Clear both caches → LLM is called again; both L1 and L2 are repopulated
- [ ] Cached entry older than 7 days is ignored and treated as a miss
- [ ] `chrome.storage.local.getBytesInUse` stays under 4 MB after 20 cached videos

---

## Phase 5 — Feature: Structural Smart Summary

**Goal:** First real user-facing feature. The sidepanel renders structured notes (core concepts, problem-solving rationale, key takeaways) from the LLM output, with timestamp badges that will later become clickable.

### Files Modified

| File | Changes |
|------|---------|
| `extension/sidepanel/sidepanel.js` | Smart Summary tab/section — triggers `generate_structured_notes` skill |
| `extension/sidepanel/sidepanel.html` | Tab navigation UI, summary container elements |
| `extension/sidepanel/sidepanel.css` | Styles for concept cards, bullet lists, takeaway chips |
| `backend/shared/prompt-templates.js` | Finalize the `generate_structured_notes` prompt template |

### Micro-Task Checklist

- [ ] Add tab/section navigation to `sidepanel.html` (Smart Summary | Math & Logic | Dry Run)
- [ ] Implement tab switching in `sidepanel.js` — show/hide content sections
- [ ] On "Smart Summary" tab activation:
  - Extract `videoId` from active tab URL
  - Call `fetchWithCache(videoId, "generate_structured_notes")`
  - Show loading skeleton during fetch
- [ ] Build DOM renderer for Skill 1 schema:
  - `core_concepts[]` → card per concept with `[timestamp]` badge + title + bullet list
  - `problem_solving_rationale` → highlighted block with problem statement and approach
  - `key_takeaways[]` → chip/tag list at the bottom
- [ ] All DOM creation uses `document.createElement` + `textContent` — no `innerHTML`
- [ ] Finalize the prompt template: instruct JSON output, include transcript, constrain response to schema shape
- [ ] Implement retry button on failure

### Chrome APIs & Key Variables

| API / Variable | Usage |
|----------------|-------|
| `chrome.tabs.query` | Get active tab to extract video ID from URL |
| `URL` / `URLSearchParams` | Parse `v=<videoId>` from YouTube URL |
| `fetchWithCache()` | Cache-aware pipeline from Phase 4 |
| Skill 1 schema fields | `core_concepts`, `problem_solving_rationale`, `key_takeaways` |
| `document.createElement` | XSS-safe DOM construction |

### Definition of Done

- [ ] Opening sidepanel on a CS/math YouTube video renders structured notes within 8 seconds
- [ ] Core concepts show timestamp badges, titles, and bullet points
- [ ] Problem-solving rationale renders as a distinct visual block
- [ ] Key takeaways render as a list or chip row
- [ ] Loading skeleton appears during fetch, disappears on render
- [ ] Network failure shows retry button; clicking it re-attempts
- [ ] Second open on same video loads from cache (sub-200ms render)

---

## Phase 6 — Feature: Math & Logic Deep-Dive Extractor

**Goal:** Detect and render LaTeX math expressions and pseudocode blocks extracted by the LLM from the video transcript.

### Files Created / Modified

| File | Changes |
|------|---------|
| `extension/sidepanel/sidepanel.js` | Math & Logic tab — triggers `extract_math_and_logic` skill, renders output |
| `extension/sidepanel/sidepanel.html` | Add KaTeX CSS/JS references (bundled locally per MV3), math/logic container |
| `extension/sidepanel/sidepanel.css` | Styles for math blocks, pseudocode blocks |
| `extension/sidepanel/lib/katex.min.js` | **New** — Locally bundled KaTeX library (MV3: no CDN) |
| `extension/sidepanel/lib/katex.min.css` | **New** — KaTeX stylesheet |
| `backend/shared/prompt-templates.js` | Finalize the `extract_math_and_logic` prompt template |

### Micro-Task Checklist

- [ ] Download KaTeX library and bundle into `extension/sidepanel/lib/` (no CDN — MV3 rule)
- [ ] Reference `katex.min.js` and `katex.min.css` from `sidepanel.html`
- [ ] On "Math & Logic" tab activation:
  - Call `fetchWithCache(videoId, "extract_math_and_logic")`
  - Show loading skeleton
- [ ] Build DOM renderer for Skill 2 schema:
  - If `has_math === true`: iterate `math_blocks[]`, render each `latex_expression` via `katex.render()` into a dedicated `<div>`; show `description` as a label above it
  - If `has_math === false`: show "No mathematical expressions detected"
  - If `has_logic === true`: iterate `logic_blocks[]`, render `pseudocode` in a `<pre><code>` block with `block_title` as heading
  - If `has_logic === false`: show "No logic/pseudocode blocks detected"
- [ ] Wrap `katex.render()` in try/catch — on parse failure, fall back to raw LaTeX string in a `<code>` block
- [ ] Finalize the prompt template: explicitly request `$$..$$` delimited LaTeX and clean pseudocode

### Chrome APIs & Key Variables

| API / Variable | Usage |
|----------------|-------|
| `katex.render(expression, element)` | LaTeX → rendered math DOM |
| `fetchWithCache()` | Cache-aware pipeline |
| Skill 2 schema fields | `has_math`, `math_blocks[]`, `has_logic`, `logic_blocks[]` |
| `<pre><code>` | Pseudocode rendering target |

### Definition of Done

- [ ] Video about neural networks → renders `$$f(x) = \sigma(W^T x + b)$$` as beautiful typeset math
- [ ] Video about sorting → renders pseudocode blocks with clear formatting
- [ ] Video with no math/logic → shows appropriate "not detected" messages
- [ ] KaTeX renders entirely offline (disconnect network after extension load to verify)
- [ ] Malformed LaTeX from LLM falls back to raw text, does not crash
- [ ] All KaTeX assets load from local `lib/` — no network requests to CDNs

---

## Phase 7 — Feature: Interactive Dry Run Tracer

**Goal:** Users input an array (max 8 elements, max 15 chars each), the LLM simulates step-by-step execution of the algorithm discussed in the video, and the sidepanel renders an interactive variable-state trace table.

### Files Modified

| File | Changes |
|------|---------|
| `extension/sidepanel/sidepanel.js` | Dry Run tab — input form, validation, triggers `simulate_dry_run_trace`, renders table |
| `extension/sidepanel/sidepanel.html` | Input form container, trace table container |
| `extension/sidepanel/sidepanel.css` | Styles for input form, trace table, step highlighting |
| `backend/shared/prompt-templates.js` | Finalize the `simulate_dry_run_trace` prompt template |

### Micro-Task Checklist

- [ ] Build input form in the Dry Run tab:
  - Text input field with placeholder: `"e.g. 3, 1, 4, 1, 5"`
  - "Run Trace" button (disabled until valid input)
  - Validation: max 8 comma-separated elements, each element max 15 characters
  - Show inline validation error on constraint violation
- [ ] On "Run Trace" click:
  - Call `fetchWithCache(videoId, "simulate_dry_run_trace", { input: userInput })`
  - Show loading skeleton
- [ ] Build DOM renderer for Skill 3 schema:
  - `input_received` → display as a label above the table
  - `variable_tracking_headers[]` → `<thead>` row
  - `trace_steps[][]` → `<tbody>` rows
  - `final_state_summary` → summary block below the table
- [ ] Add step-by-step highlight interaction:
  - "Next Step" / "Prev Step" buttons
  - Current step row gets a highlight class
  - Step counter: "Step 3 of 7"
- [ ] Cache key for dry run includes the input hash: `"yt_<videoId>_simulate_dry_run_trace_<inputHash>"`

### Chrome APIs & Key Variables

| API / Variable | Usage |
|----------------|-------|
| `fetchWithCache()` | Cache-aware pipeline (with input-specific cache key) |
| Skill 3 schema fields | `input_received`, `variable_tracking_headers`, `trace_steps`, `final_state_summary` |
| Input constraints | Max 8 elements, max 15 chars per element |
| `currentStep` (integer state) | Tracks which row is highlighted in the trace table |

### Definition of Done

- [ ] Entering `"3, 1, 4, 1, 5"` on a sorting algorithm video produces a valid step-by-step trace table
- [ ] Entering 9+ elements shows validation error, button stays disabled
- [ ] Entering an element longer than 15 chars shows validation error
- [ ] "Next Step" / "Prev Step" buttons highlight rows correctly, wrapping at boundaries
- [ ] Step counter updates: "Step N of M"
- [ ] Same input on same video loads from cache on second run
- [ ] Final state summary renders below the table

---

## Phase 8 — Feature: Interactive Timeline Sync

**Goal:** Every timestamp badge rendered in Phase 5 (and any future phase) becomes a clickable link that seeks the YouTube player to that exact time.

### Files Modified

| File | Changes |
|------|---------|
| `extension/content.js` | New action: `"SEEK_TO_TIMESTAMP"` — programmatically seeks the `<video>` element |
| `extension/background.js` | New action: `"SEEK_TO_TIMESTAMP"` — relays from sidepanel to content tab |
| `extension/sidepanel/sidepanel.js` | Attach click handlers to all `[timestamp]` badges, send seek messages |
| `extension/sidepanel/sidepanel.css` | Hover/active styles for clickable timestamps |

### Micro-Task Checklist

- [ ] In `content.js`, add handler for `"SEEK_TO_TIMESTAMP"` action:
  - Receives `{ seconds: number }`
  - Finds the YouTube `<video>` element via `document.querySelector("video")`
  - Sets `video.currentTime = seconds`
  - Optionally calls `video.play()` if paused
  - Returns `{ success: true }` or `{ success: false, error: "..." }`
- [ ] In `background.js`, add `"SEEK_TO_TIMESTAMP"` action → relay to the originating tab's content script
- [ ] In `sidepanel.js`, write `parseTimestampToSeconds(timestamp)`:
  - Converts `"MM:SS"` or `"HH:MM:SS"` strings to total seconds
- [ ] In `sidepanel.js`, after rendering any feature's output:
  - Query all `.timestamp-badge` elements
  - Attach `click` listener → `sendToBackground("SEEK_TO_TIMESTAMP", { seconds })`
- [ ] Style timestamp badges: `cursor: pointer`, hover underline, active color pulse
- [ ] Handle edge case: video element not found (YouTube mini-player, PiP mode)

### Chrome APIs & Key Variables

| API / Variable | Usage |
|----------------|-------|
| `chrome.tabs.sendMessage` | Background → content script for seek command |
| `document.querySelector("video")` | Access the YouTube player's `<video>` element |
| `HTMLVideoElement.currentTime` | Seek to specific timestamp (in seconds) |
| `HTMLVideoElement.play()` | Resume playback after seek |
| `parseTimestampToSeconds()` | `"04:12"` → `252` |

### Definition of Done

- [ ] Clicking `[04:12]` in the Smart Summary jumps the YouTube video to 4 minutes 12 seconds
- [ ] Video resumes playing after seek (if it was playing before)
- [ ] Timestamps work after navigating to a different video without reloading the extension
- [ ] Hovering a timestamp shows pointer cursor and visual feedback
- [ ] If the video element is unavailable, a brief toast/notification appears in the sidepanel

---

## Phase 9 — Error Handling, UX Polish & XSS Hardening

**Goal:** Audit every user-facing path for graceful degradation, ensure zero XSS vectors from LLM output, and polish the visual experience.

### Files Modified

| File | Changes |
|------|---------|
| `extension/sidepanel/sidepanel.js` | Global error boundary, retry logic unification, loading states |
| `extension/sidepanel/sidepanel.html` | Toast/notification container, error state templates |
| `extension/sidepanel/sidepanel.css` | Error states, loading skeletons, toast animations, responsive polish |
| `extension/content.js` | Defensive checks for YouTube DOM mutations |
| `backend/api/extract.js` | Structured error responses, input sanitization |

### Micro-Task Checklist

- [ ] **XSS Audit:**
  - Search entire `extension/` for any `innerHTML` usage — replace all with `textContent` or `createElement`
  - Verify KaTeX receives only the `latex_expression` field, never raw HTML
  - Verify pseudocode blocks use `textContent` inside `<pre><code>`
- [ ] **Retry Component:**
  - Build a reusable `showRetry(container, message, retryCallback)` function
  - On any backend fetch failure, display: error icon + message + "Try Again" button
  - "Try Again" button re-invokes the original fetch
- [ ] **Loading Skeletons:**
  - Build CSS-only skeleton pulse animations for each feature section
  - Show skeletons immediately on tab switch, hide on data render
- [ ] **Toast Notifications:**
  - Lightweight toast system for transient messages ("Jumped to 04:12", "Cache cleared", "Seek failed")
  - Auto-dismiss after 3 seconds
- [ ] **Edge Case Handling:**
  - Non-YouTube tab active → show "Navigate to a YouTube video" prompt
  - YouTube Shorts / Live streams → show "Not supported" message
  - Transcript in non-English language → pass through (LLM handles multilingual)
  - Service worker goes idle (MV3 lifecycle) → reconnect on next message
- [ ] **Backend Input Sanitization:**
  - Reject transcript payloads larger than 100 KB
  - Strip any HTML tags from transcript before passing to LLM
  - Validate `skill` against an allowlist

### Chrome APIs & Key Variables

| API / Variable | Usage |
|----------------|-------|
| `chrome.runtime.lastError` | Detect message passing failures |
| `chrome.tabs.onUpdated` | Detect navigation to new YouTube video |
| `chrome.tabs.onActivated` | Detect tab switch away from YouTube |
| Service worker lifecycle | `chrome.runtime.onSuspend` / wake-on-message handling |

### Definition of Done

- [ ] `rg "innerHTML" extension/` returns **zero** matches
- [ ] Disconnecting network mid-fetch shows retry component; reconnecting + clicking retry succeeds
- [ ] Every tab shows a loading skeleton that matches the final layout shape
- [ ] Opening sidepanel on a non-YouTube tab shows appropriate guidance message
- [ ] Opening sidepanel on YouTube Shorts shows "Not supported" message
- [ ] Backend rejects a 200 KB transcript payload with a `413` status
- [ ] No console errors during a full happy-path walkthrough of all four features

---

## Phase 10 — Production Readiness & Deployment

**Goal:** Final pass for Chrome Web Store compliance, performance budgets, and deployment of the serverless backend.

### Files Created / Modified

| File | Changes |
|------|---------|
| `extension/manifest.json` | Final permissions audit — remove any unused permissions |
| `backend/vercel.json` or `wrangler.toml` | **New** — Serverless deployment configuration |
| `README.md` | **New** — Setup instructions, architecture diagram, local dev guide |
| `extension/icons/` | **New** — Extension icons (16, 48, 128px) |

### Micro-Task Checklist

- [ ] **Permissions Audit:**
  - Review `manifest.json` permissions — remove anything not actively used
  - Verify `host_permissions` is scoped to YouTube and the backend domain only
  - Ensure `"storage"` permission is present for `chrome.storage.local`
- [ ] **Performance Budget:**
  - Side panel initial render < 200ms (no feature data, just shell)
  - Cached feature render < 300ms
  - Uncached feature render (LLM round-trip) < 10s with visible loading state
  - Total extension package size < 2 MB (including KaTeX)
- [ ] **Extension Icons:**
  - Create/source 16x16, 48x48, 128x128 PNG icons
  - Reference in `manifest.json` under `"icons"`
- [ ] **Backend Deployment:**
  - Deploy `backend/` to chosen serverless platform (Vercel / Cloudflare Workers)
  - Set environment variables: `LLM_API_KEY`, `LLM_MODEL`, `ALLOWED_ORIGIN`
  - Verify production endpoint responds correctly
- [ ] **Update extension to point to production backend URL**
- [ ] **Write `README.md`:**
  - Project overview
  - Local development setup (extension + backend)
  - Architecture diagram (text-based)
  - Environment variables reference
- [ ] **Final end-to-end test:** Load extension → open YouTube → open sidepanel → test all 4 features → verify caching → verify timestamp sync

### Definition of Done

- [ ] Extension passes `chrome://extensions` with zero errors and zero warnings
- [ ] All four features work end-to-end on a live YouTube video
- [ ] Cached responses load in under 300ms
- [ ] Extension package is under 2 MB
- [ ] Backend is deployed and responding on the production URL
- [ ] `README.md` is complete and a new developer could set up the project by following it
- [ ] Git repository has clean commit history with one commit per phase

---

## Quick Reference — Phase Dependency Graph

```
Phase 0  (Scaffold)
   ↓
Phase 1  (Messages)
   ↓
Phase 2  (Transcript) ──→ Phase 3  (Backend Proxy)
                               ↓
                          Phase 4  (Caching)
                               ↓
              ┌────────────────┼────────────────┐
              ↓                ↓                ↓
         Phase 5          Phase 6          Phase 7
      (Smart Summary)  (Math & Logic)   (Dry Run Tracer)
              └────────────────┼────────────────┘
                               ↓
                          Phase 8  (Timeline Sync)
                               ↓
                          Phase 9  (Polish & Hardening)
                               ↓
                          Phase 10 (Production)
```

> Phases 5, 6, and 7 are independent of each other and can be built in any order or in parallel. All other phases are sequential.
