# Sub-Skill: Extension Architecture

> Governs all code inside `extension/`. Read this before touching `manifest.json`, `background.js`, `content.js`, or any MV3 configuration.

---

## Manifest V3 Rules

### Permissions — Principle of Least Privilege

Only request what is actively used. Current approved set:

| Permission | Justification |
|------------|--------------|
| `sidePanel` | Required for `chrome.sidePanel` API |
| `activeTab` | Access to the current tab's URL and content on user gesture |
| `storage` | Required for `chrome.storage.local` (L1 cache) |
| `tabs` | Query active tab, send messages to specific tabs |
| `scripting` | Programmatic script injection if needed |

Never add `"<all_urls>"` to `host_permissions`. Scope to `*://*.youtube.com/*` and the backend domain only.

### Content Security Policy

- No `eval()`, no `new Function()`, no inline scripts.
- All JavaScript runs from locally packaged `.js` files.
- All CSS runs from locally packaged `.css` files.
- Third-party libraries (e.g., KaTeX) must be downloaded and placed in `extension/sidepanel/lib/`.

---

## Service Worker (`background.js`) — The Message Router

### Architecture Pattern

`background.js` is a **pure dispatcher**. It contains:

1. A `chrome.runtime.onMessage` listener with a `switch(action)` block.
2. Cache helpers that wrap `chrome.storage.local`.
3. No business logic, no DOM access, no UI state.

### Action Registry

Every message action must be registered here. Update this table when adding new actions.

| Action | Direction | Handler Summary |
|--------|-----------|----------------|
| `PING` | Any → Background | Returns `{ status: "PONG" }` |
| `RELAY_TO_TAB` | Sidepanel → Background → Content | Forwards payload to `tabId` via `chrome.tabs.sendMessage` |
| `RELAY_TO_SIDEPANEL` | Content → Background → Sidepanel | Forwards payload via `chrome.runtime.sendMessage` |
| `GET_TRANSCRIPT` | Sidepanel → Background → Content | Asks content script to extract and return transcript |
| `CACHE_GET` | Sidepanel → Background | Returns cached data from `chrome.storage.local` |
| `CACHE_SET` | Sidepanel → Background | Writes data to `chrome.storage.local` |
| `SEEK_TO_TIMESTAMP` | Sidepanel → Background → Content | Tells content script to seek `<video>` element |

### Service Worker Lifecycle (MV3)

- The service worker can be terminated by Chrome after ~30 seconds of inactivity.
- Never store transient state in global variables — it will be lost on restart.
- All persistent state goes into `chrome.storage.local`.
- If `chrome.runtime.lastError` is set after a message send, the worker may have restarted — handle gracefully.

---

## Content Script (`content.js`) — The Page Bridge

### Isolation Rules

- Content script runs in YouTube's page context but in an isolated world.
- It must **never** import from sidepanel or background files.
- It communicates exclusively via `chrome.runtime.sendMessage` (outbound) and `chrome.runtime.onMessage` (inbound).

### Exposed Capabilities (Interface Segregation)

The content script exposes exactly two capabilities via message handlers:

1. **`extractTranscript()`** — Scrapes the YouTube transcript DOM and returns `{ timestamp, text }[]`.
2. **`seekToTimestamp(seconds)`** — Sets `document.querySelector("video").currentTime = seconds`.

No other internal functions should be accessible from outside.

### DOM Scraping Pattern

```
1. Check if transcript data exists in `ytInitialPlayerResponse` (faster, no DOM click needed).
2. If not, programmatically click the "Show transcript" button.
3. Wait for transcript segment elements to appear (use MutationObserver with a timeout).
4. Parse each segment into { timestamp: "MM:SS", text: "..." }.
5. Return the array.
6. On failure (timeout, no button, no segments), return { error: "TRANSCRIPT_UNAVAILABLE" }.
```

### YouTube SPA Navigation

YouTube uses client-side navigation (History API). A page "change" doesn't reload the content script. Handle this:

- Listen for `yt-navigate-finish` events on `document`.
- When detected, clear any cached transcript data and re-evaluate readiness.

---

## Message Protocol

Every message in the system follows this shape:

```
{
  action: string,     // Dispatch key (e.g., "GET_TRANSCRIPT")
  payload: object,    // Action-specific data
  tabId?: number      // Target tab ID (for tab-directed messages)
}
```

Every response follows this shape:

```
{
  success: boolean,
  data?: object,      // Present when success === true
  error?: string      // Present when success === false
}
```

### Error Handling in Messages

- Every `chrome.runtime.sendMessage` call must check `chrome.runtime.lastError` in the callback.
- Wrap message sending in a Promise-based helper: `sendToBackground(action, payload) → Promise<response>`.
- If the response has `success === false`, the caller decides whether to retry or show an error UI.
