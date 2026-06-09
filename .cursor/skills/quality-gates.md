# Sub-Skill: Quality Gates

> Read this before marking any phase as complete, and during Phase 9 (Hardening). Every checklist here is a hard gate — the phase is not done until every applicable item passes.

---

## Per-Phase Completion Gate

Before closing any phase, verify:

- [ ] All micro-tasks in `ROADMAP.md` for that phase are checked off.
- [ ] All "Definition of Done" items in `ROADMAP.md` for that phase pass.
- [ ] No new `innerHTML` usage introduced (run XSS audit below).
- [ ] No hardcoded API keys or secrets in any file.
- [ ] All `async` functions have explicit `try/catch` wrappers.
- [ ] `TODO.md` is updated — completed items marked, any new discovered tasks added.
- [ ] Relevant skill files are updated if architectural patterns changed.

---

## XSS Audit Procedure

Run this audit after every phase that touches `extension/` code.

### Step 1: Forbidden Pattern Search

Search the entire `extension/` directory for these patterns. **Zero matches is the only passing result.**

| Pattern | Risk |
|---------|------|
| `innerHTML` | Direct HTML injection from untrusted data |
| `outerHTML` | Same as innerHTML |
| `insertAdjacentHTML` | Same as innerHTML |
| `document.write` | Global document overwrite |
| `eval(` | Arbitrary code execution |
| `new Function(` | Arbitrary code execution |
| `setTimeout(string` | String-based eval via timer |
| `setInterval(string` | String-based eval via timer |

### Step 2: KaTeX Input Audit

If KaTeX is in use, verify:
- `katex.render()` only receives the `latex_expression` field from the validated schema.
- No raw LLM response text is passed to KaTeX without extracting the specific field first.
- `katex.render()` is wrapped in `try/catch` with a safe fallback.

### Step 3: textContent Verification

For every place where LLM-generated text is displayed:
- Verify it uses `element.textContent = value`, not any HTML injection method.
- Verify pseudocode uses `<pre><code>` with `textContent`.

---

## Error Handling Audit

### Extension Side

| Scenario | Expected Behavior |
|----------|-------------------|
| Backend returns HTTP 500 | Retry component shown with "Try Again" button |
| Backend returns HTTP 429 | Retry component with "Too many requests, try again later" |
| Backend returns invalid JSON | Retry component with "Unexpected response" |
| `chrome.runtime.lastError` set | Error logged, Promise rejected, caller handles gracefully |
| Network disconnected mid-fetch | Retry component shown |
| YouTube video has no transcript | "Transcript unavailable" message with explanation |
| YouTube Shorts / Live stream | "Not supported for this video type" message |
| Non-YouTube tab active | "Navigate to a YouTube video to get started" prompt |
| Service worker terminated (MV3) | Next message wakes it; no user-visible error |
| `chrome.storage.local` quota exceeded | Evict oldest entries, retry write |

### Backend Side

| Scenario | Expected Behavior |
|----------|-------------------|
| Unknown `skill` value | `400` with `{ success: false, error: "Unknown skill: X" }` |
| Missing `transcript` field | `400` with `{ success: false, error: "transcript is required" }` |
| Request body > 100 KB | `413` with `{ success: false, error: "Payload too large" }` |
| LLM returns non-JSON | Extract JSON substring, or retry once, then `500` |
| LLM response fails schema validation | Retry once, then `500` with validation errors |
| LLM API key invalid/expired | `500` with `{ success: false, error: "LLM service unavailable" }` — never expose the key |
| Rate limit exceeded | `429` with `Retry-After` header |
| CORS origin mismatch | Request blocked by browser (no response body needed) |

---

## Performance Budgets

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Side panel shell render | < 200ms | Chrome DevTools Performance tab |
| Cached feature render (L1 hit) | < 300ms | Timestamp diff: tab click → last DOM mutation |
| Uncached feature render (LLM) | < 10s | Network waterfall in DevTools |
| Extension package size | < 2 MB | `du -sh extension/` |
| `chrome.storage.local` usage after 20 videos | < 4 MB | `chrome.storage.local.getBytesInUse()` |
| KaTeX render per expression | < 100ms | Console timing around `katex.render()` |

---

## Edge Case Coverage

These must be manually tested before Phase 9 is marked complete.

### YouTube-Specific

- [ ] Standard video with transcript → all features work
- [ ] Video without transcript → "Transcript unavailable" shown
- [ ] YouTube Shorts URL (`/shorts/`) → "Not supported" shown
- [ ] YouTube Live stream → "Not supported" shown
- [ ] Navigating between videos (SPA transition) → sidepanel updates to new video
- [ ] Opening sidepanel on a non-YouTube tab → guidance message shown
- [ ] Video with non-English transcript → passed to LLM, result rendered

### Caching

- [ ] First visit → LLM called, both L1 and L2 populated
- [ ] Second visit (same session) → L1 hit, no network request
- [ ] After clearing `chrome.storage.local` → L2 hit, L1 backfilled
- [ ] After clearing both caches → LLM called again
- [ ] Entry older than 7 days → treated as miss
- [ ] Dry run tracer with different inputs on same video → separate cache entries

### Network

- [ ] Backend unreachable → retry component with "Try Again"
- [ ] Slow network (>5s) → loading skeleton stays visible
- [ ] Network restored after failure → "Try Again" succeeds

### Interaction

- [ ] Clicking timestamp badge → video seeks to correct time
- [ ] Rapid tab switching → no orphaned render calls or duplicate content
- [ ] Dry run input validation → 9+ elements rejected, >15 char element rejected
- [ ] Dry run "Next Step"/"Prev Step" → correct row highlighted, wraps at boundaries

---

## Pre-Commit Checklist (For Every Commit)

- [ ] No `console.log` left in production code (use only during active debugging)
- [ ] No `TODO` or `FIXME` comments without a corresponding entry in `TODO.md`
- [ ] No hardcoded URLs — backend URL comes from a config constant
- [ ] All new `async` functions have `try/catch`
- [ ] XSS audit passes (zero forbidden patterns)
- [ ] Skill files updated if any architectural pattern changed
