# Sub-Skill: UI Patterns

> Governs all code inside `extension/sidepanel/`. Read this before touching `sidepanel.html`, `sidepanel.css`, or `sidepanel.js`.

---

## XSS-Safe Rendering — The #1 Rule

**Never use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or `document.write` anywhere in the sidepanel.**

### Allowed DOM Creation Methods

| Method | Use For |
|--------|---------|
| `document.createElement(tag)` | Creating any DOM element |
| `element.textContent = value` | Setting text safely (auto-escapes HTML) |
| `element.appendChild(child)` | Assembling DOM trees |
| `element.classList.add(cls)` | Styling via CSS classes |
| `element.setAttribute(attr, val)` | Setting non-dangerous attributes |
| `katex.render(latex, element)` | LaTeX rendering (KaTeX handles its own sanitization) |

### Forbidden Patterns

```javascript
// NEVER do this — XSS vector
container.innerHTML = llmResponse.html;

// NEVER do this — same risk
element.insertAdjacentHTML("beforeend", data);

// ALWAYS do this instead
const p = document.createElement("p");
p.textContent = llmResponse.text;
container.appendChild(p);
```

---

## Component Lifecycle

Every feature renderer in the sidepanel follows the same three-phase lifecycle. This enables the tab system to mount/unmount features without special-casing.

### The Three Phases

1. **`init(container)`** — Receive the parent DOM node. Create skeleton/loading state. Return nothing.
2. **`render(data)`** — Receive validated skill data. Build and append DOM nodes into the container. Replace loading state.
3. **`destroy()`** — Remove all child nodes from the container. Clear any event listeners or timers. Reset state.

### Applying to Features

| Feature | init | render | destroy |
|---------|------|--------|---------|
| Smart Summary | Show skeleton cards | Build concept cards + rationale + takeaways | Clear container |
| Math & Logic | Show skeleton blocks | Render KaTeX + pseudocode blocks | Clear container |
| Dry Run Tracer | Show input form + skeleton table | Build trace table + step controls | Clear container, reset step counter |
| Timeline Sync | (integrated into other features) | Attach click handlers to timestamp badges | Remove click handlers |

---

## Tab Navigation System

### Structure

```
┌──────────────────────────────────────────────┐
│  [Smart Summary]  [Math & Logic]  [Dry Run]  │
├──────────────────────────────────────────────┤
│                                              │
│         Active Tab Content Area              │
│                                              │
└──────────────────────────────────────────────┘
```

### Behavior

- Only one tab is active at a time.
- Switching tabs calls `destroy()` on the outgoing feature and `init()` + data fetch on the incoming feature.
- The active tab button gets an `.active` CSS class.
- Tab state is ephemeral — not persisted across panel closes.

### Data Fetching on Tab Activation

```
Tab clicked
  → destroy() current feature
  → init(container) new feature (shows skeleton)
  → fetchWithCache(videoId, skillName)
      → on success: render(data)
      → on failure: showRetry(container, message, retryCallback)
```

---

## Loading Skeletons

Every feature must show a skeleton immediately on tab activation, before any data arrives.

### CSS-Only Pattern

```css
.skeleton {
  background: linear-gradient(90deg, var(--skeleton-base) 25%, var(--skeleton-shine) 50%, var(--skeleton-base) 75%);
  background-size: 200% 100%;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
  border-radius: var(--radius-sm);
}

@keyframes skeleton-pulse {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

- Skeleton shapes must approximate the final rendered layout (cards for summaries, blocks for math, rows for tables).
- Use `min-height` on skeleton elements to prevent layout shift when real content replaces them.

---

## Retry Component

A single reusable function for all error states:

```
showRetry(container, message, retryCallback)
```

### Behavior

1. Clears the container.
2. Creates an error icon (CSS-only, no image).
3. Creates a message paragraph with `textContent = message`.
4. Creates a "Try Again" button.
5. Button click clears the container and invokes `retryCallback()`.

### Visual Design

- Centered vertically and horizontally in the container.
- Muted color palette — not alarming, but clearly an error state.
- Button uses the primary action color.

---

## Toast Notifications

Transient messages for non-blocking feedback (e.g., "Jumped to 04:12", "Copied to clipboard").

### Behavior

- Appears at the bottom of the sidepanel.
- Auto-dismisses after 3 seconds.
- Max one toast visible at a time (new toast replaces old).
- Purely informational — no action buttons.

---

## CSS Architecture

### Custom Properties (`:root`)

Define all design tokens as CSS custom properties in `sidepanel.css`:

```css
:root {
  --color-bg: #ffffff;
  --color-surface: #f8f9fa;
  --color-text: #1a1a2e;
  --color-text-muted: #6b7280;
  --color-primary: #3b82f6;
  --color-error: #ef4444;
  --color-border: #e5e7eb;

  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;

  --radius-sm: 4px;
  --radius-md: 8px;

  --font-mono: "SF Mono", "Fira Code", "Consolas", monospace;

  --skeleton-base: #e5e7eb;
  --skeleton-shine: #f3f4f6;
}
```

### Naming Convention

Use BEM-lite: `.feature-name__element--modifier`

```css
.smart-summary__card { }
.smart-summary__card--highlighted { }
.smart-summary__timestamp { }
.dry-run__table { }
.dry-run__row--active { }
```

### Sidepanel Width Constraint

The Chrome side panel is ~400px wide. Design all components for this constraint:

- No horizontal scrolling.
- Tables use `table-layout: fixed` with `word-wrap: break-word`.
- Cards are full-width with internal padding.
- Math blocks may need horizontal scroll for long expressions — wrap in `overflow-x: auto`.

---

## Timestamp Badges

Timestamps rendered by any feature use a consistent badge component:

### DOM Structure
```html
<span class="timestamp-badge" data-seconds="252">04:12</span>
```

### Behavior
- `cursor: pointer` on hover.
- Click sends `SEEK_TO_TIMESTAMP` via the message bus.
- Visual: inline pill with monospace font, subtle background color, hover underline.

### Integration
After any feature's `render(data)` completes, a shared function scans the container for all `.timestamp-badge` elements and attaches click handlers. This keeps timestamp logic out of individual feature renderers.
