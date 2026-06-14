# Sub-Skill: Backend Architecture

> Governs all code inside `backend/`. Read this before touching `backend/api/extract.js`, `backend/api/sync.js`, or any `backend/shared/` module.

---

## Serverless Function Design

### Stateless by Contract

- Each function invocation is independent. No shared in-memory state between requests.
- Database connections are established per-request (or use connection pooling provided by the platform).
- Configuration comes exclusively from environment variables — never hardcoded.

### Required Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `LLM_API_KEY` | Server-side LLM authentication | `sk-...` |
| `LLM_PROVIDER` | Which LLM provider to call | `openai` or `google` |
| `LLM_MODEL` | Specific model identifier | `gpt-4o` or `gemini-pro` |
| `ALLOWED_ORIGIN` | CORS allowlist for the extension | `chrome-extension://abcdef123` |
| `API_AUTH_TOKEN` | Bearer token required by `/api/extract` and `/api/sync` | Shared secret checked against `Authorization` header |
| `DATABASE_URL` | L2 cache database connection | (provider-specific) |

### Request/Response Contract

**Inbound to `extract.js`:**
```json
{
  "skill": "generate_structured_notes | extract_math_and_logic | simulate_dry_run_trace",
  "transcript": "full transcript text...",
  "params": {}
}
```

**Outbound on success:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Outbound on failure:**
```json
{
  "success": false,
  "error": "Human-readable error description"
}
```

### CORS Configuration

- `Access-Control-Allow-Origin`: Set to `process.env.ALLOWED_ORIGIN` only — never `*`.
- `Access-Control-Allow-Methods`: `POST, OPTIONS`.
- `Access-Control-Allow-Headers`: `Content-Type, Authorization`.
- Return proper `204` response for `OPTIONS` preflight.

---

## Skill Registry

Every LLM skill is a named operation with a prompt template and a schema validator. Update this table when adding new skills.

| Skill Name | Prompt Template Function | Schema Validator | Data Contract |
|------------|------------------------|------------------|--------------|
| `generate_structured_notes` | `getPromptForSkill("generate_structured_notes", ...)` | `validateStructuredNotes(data)` | `03-skills.mdc` → Skill 1 |
| `extract_math_and_logic` | `getPromptForSkill("extract_math_and_logic", ...)` | `validateMathLogic(data)` | `03-skills.mdc` → Skill 2 |
| `simulate_dry_run_trace` | `getPromptForSkill("simulate_dry_run_trace", ...)` | `validateDryRunTrace(data)` | `03-skills.mdc` → Skill 3 |

### Adding a New Skill

1. Define the output schema in `03-skills.mdc` under a new `### Skill N:` section.
2. Add a validation function in `backend/shared/schemas.js`.
3. Add a prompt template case in `backend/shared/prompt-templates.js`.
4. Add the skill name to the `VALID_SKILLS` allowlist in `shared/http.js` and a strategy entry in `shared/skills.js`.
5. Update this table.

---

## `backend/shared/skills.js` — Strategy Registry

Each skill is registered as a strategy object:

```
{
  skillName,
  buildPrompt(transcript, params) → { system, user },
  validateOutput(data) → { valid, errors },
  validateParams(params) → { ok, error? }   // optional, used by dry-run tracer
}
```

`extract.js` resolves the strategy via `getSkillStrategy(skillName)` and executes the shared LLM + schema validation pipeline. This keeps the handler closed for modification while remaining open for new skills.

---

### Pattern

Each validator receives parsed JSON and returns a result object:

```
function validateStructuredNotes(data) → { valid: boolean, errors: string[] }
```

### Validation Rules

- Check that every required top-level key exists.
- Check that arrays are actually arrays and have at least one element.
- Check that nested objects have their required keys.
- Do NOT validate value content (the LLM controls that) — only validate structural shape.
- Return all errors at once, not just the first one.

---

## `backend/shared/prompt-templates.js` — LLM Prompts

### Pattern

```
function getPromptForSkill(skillName, transcript, params) → { system: string, user: string }
```

### Prompt Construction Rules

- The `system` prompt defines the role, output format (JSON only), and the exact schema shape expected.
- The `user` prompt contains the transcript and any user parameters.
- Every system prompt must include: "Respond with valid JSON only. No markdown, no explanation, no wrapping."
- Every system prompt must include the exact JSON schema shape as an example.
- For `simulate_dry_run_trace`, the `params.input` value must be included in the user prompt.

### Prompt Hygiene

- Never interpolate user input into the system prompt — only into the user prompt.
- Escape any special characters in the transcript before interpolation.
- Cap transcript length at 80,000 characters. Truncate with a note if longer.

---

## Two-Tier Caching (Backend Side)

### `sync.js` Responsibilities

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/sync?videoId=X&skill=Y` | Check L2 database for cached result |
| `POST` | `/api/sync` body `{ videoId, skill, data }` | Write result to L2 database |

### Cache Key (L2)

Composite key: `videoId` + `skill` (and optionally `inputHash` for dry run tracer).

### TTL Policy

- Cache entries older than 7 days are treated as misses.
- The `createdAt` timestamp is stored alongside the data.
- `sync.js GET` checks `createdAt` before returning a hit.

### Write-Through from `extract.js`

After a successful LLM call in `extract.js`, the result is written to L2 internally (calling the sync write logic directly, not via HTTP). This avoids an extra network hop.

---

## Error Handling

### LLM Call Failures

1. If the LLM returns non-JSON, attempt to extract JSON from the response (look for `{...}` boundaries).
2. If extraction fails, retry once with the same prompt.
3. If the retry also fails, return `{ success: false, error: "LLM returned invalid response" }`.

### Schema Validation Failures

1. If the LLM returns valid JSON but it doesn't match the schema, retry once.
2. On second failure, return `{ success: false, error: "Schema validation failed", details: errors[] }`.

### Rate Limiting

- Implement basic per-IP rate limiting (e.g., 10 requests per minute).
- Return `429 Too Many Requests` with a `Retry-After` header.

### Input Validation

- Reject requests where `skill` is not in the `VALID_SKILLS` allowlist → `400`.
- Reject requests where `transcript` is empty or missing → `400`.
- Reject requests where body size exceeds 100 KB → `413`.
