# YouTube Deep-Dive Extractor — Master Skill

> This is the root skill. It defines the global engineering constraints every sub-skill and every line of code in this project must obey. Read this first, then follow the sub-skill referenced for the domain you're working in.

---

## Governing Documents

| Document | Path | Scope |
|----------|------|-------|
| PRD | `.cursor/rules/01-prd.mdc` | Product vision, 4 features, technical constraints |
| Tech Rules | `.cursor/rules/02-tech.mdc` | Directory schema, MV3 security, code style |
| Data Contracts | `.cursor/rules/03-skills.mdc` | JSON schemas for all 3 LLM skills |
| Roadmap | `ROADMAP.md` | Phase-wise engineering plan (Phases 0–10) |
| Task List | `TODO.md` | Granular, context-rich task tracker |

---

## Global Constraints (Apply to ALL code)

### 1. SOLID Principles — Enforced at Every Layer

- **Single Responsibility:** Every function does one thing. Every file owns one domain. If a function name needs "and" in it, split it.
- **Open/Closed:** The message router (`background.js`) dispatches by action string. New features add new action cases — they never modify the dispatch mechanism itself. The `fetchWithCache` pipeline is closed for modification but open for new skill names.
- **Liskov Substitution:** All skill renderers in the sidepanel conform to the same lifecycle: `init(container)` → `render(data)` → `destroy()`. Any renderer can be swapped without breaking the tab system.
- **Interface Segregation:** Content script exposes only `extractTranscript()` and `seekToTimestamp()` to background — it never exposes DOM internals. Backend exposes only `/api/extract` and `/api/sync` — no internal helpers leak into the API surface.
- **Dependency Inversion:** Sidepanel features depend on the `fetchWithCache` abstraction, never on raw `fetch()` or `chrome.storage.local` directly. Backend handlers depend on `getPromptForSkill()` and `validateSchema()` abstractions, never on a specific LLM SDK import.

### 2. Clean Directory — Zero Clutter

- Follow the directory schema in `02-tech.mdc` exactly. No extra top-level folders.
- Shared backend utilities live in `backend/shared/` — never duplicate logic across `extract.js` and `sync.js`.
- Extension-side shared utilities (message helpers, cache helpers) live as clearly named functions inside the files that own them (`background.js` for chrome API wrappers, `sidepanel.js` for UI orchestration).
- Never create utility files unless three or more consumers need the same function. Premature abstraction is clutter.

### 3. Decoupled Components

- **Content script** knows nothing about the sidepanel or the backend. It responds to message actions and returns data.
- **Background service worker** is a pure router. It holds zero business logic — only message dispatch, cache get/set, and relay.
- **Sidepanel** owns all UI state and rendering. It communicates exclusively through the message bus (via background) and the `fetchWithCache` pipeline.
- **Backend functions** are stateless. Each request is self-contained. No shared in-memory state between invocations.

### 4. Async/Error Contract

- Every async operation uses `async/await` inside an explicit `try/catch`.
- Caught errors are never silently swallowed. They either: (a) return a structured error to the caller, or (b) trigger a user-visible retry component.
- Never use `.then()/.catch()` chains. Always `await`.

### 5. Security Invariants

- Zero `innerHTML` anywhere in `extension/`. Use `document.createElement` + `textContent` exclusively.
- Zero direct LLM API calls from `extension/`. All LLM traffic routes through `backend/api/`.
- Zero hardcoded API keys in any file. Backend reads from `process.env` only.

---

## Sub-Skill Index

Read the relevant sub-skill before writing code in that domain.

| Sub-Skill | Path | When to Read |
|-----------|------|-------------|
| Extension Architecture | `.cursor/skills/extension-architecture.md` | Working on `extension/manifest.json`, `background.js`, `content.js`, or any MV3 concern |
| Backend Architecture | `.cursor/skills/backend-architecture.md` | Working on `backend/api/`, `backend/shared/`, serverless config, or LLM integration |
| UI Patterns | `.cursor/skills/ui-patterns.md` | Working on `extension/sidepanel/` — HTML, CSS, JS, rendering, tabs, components |
| Quality Gates | `.cursor/skills/quality-gates.md` | Before completing any phase, or when doing error handling / hardening / testing |

---

## Self-Sync Protocol

These skills are living documents. They must be updated as the project evolves:

- **When a new action is added to `background.js`:** Update the action registry table in `extension-architecture.md`.
- **When a new LLM skill or schema is added:** Update the skill registry in `backend-architecture.md` and `03-skills.mdc`.
- **When a new UI component pattern is introduced:** Update the renderer lifecycle section in `ui-patterns.md`.
- **When a phase is completed:** Mark it done in `TODO.md` and verify the quality gate in `quality-gates.md`.
- **When a new constraint or rule is discovered:** Add it to this file under Global Constraints.

> If you write code that changes an architectural pattern, update the corresponding skill in the same commit. Skills and code must never drift.
