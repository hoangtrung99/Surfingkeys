# AGENTS.md

Checklist for working on this Surfingkeys codebase.

## Before editing
- Read the surrounding file and existing patterns first; mirror naming and style.
- Prefer reusing existing utilities in `src/content_scripts/common/` over reimplementing logic (see "Avoid duplicating utils" below).
- Verify how modules import from `./utils.js` before adding exports; many helpers are already exported.
- On ANY fix or feature, the moment two defensible behaviors compete and you cannot have both, STOP and ask which one — before writing the code. Name each option as the behavior a user would notice and what it gives up, not as an implementation. This is not about big changes: the choice is usually small and buried (which side to err on, what to do with the awkward case, whether to be strict or forgiving), which is exactly why it slips through as a decision nobody made. Do not settle it yourself and write the comment that justifies it: a plausible rationale in the diff is what stops the user noticing there was a choice at all, and they are the one who lives with it.

## Common utils to reuse (do not reinvent)
- `getTextRect(node, offset[, endNode, endOffset])` — builds a range and returns its client rects **without touching the page selection**. Useful for positioning overlays near text.
- `createElementWithContent(tag, content, attrs)` — create DOM elements with class/content.
- `getTextNodePos`, `getVisibleElements`, `filterInvisibleElements`, `setSanitizedContent`, etc.

### Gotchas
- `getTextRect(...)` returns a **`DOMRectList`, not a real Array** — `.reduce()`, `.filter()` etc. will throw "is not a function". Wrap with `Array.from(getTextRect(...))` before calling array methods.
- `getTextNodePos(node, offset)` mutates `document.getSelection()` — avoid it when the page's current selection must be preserved; use a standalone `Range`/`getTextRect` instead.
- A `runtime.on(...)` handler that answers must answer SYNCHRONOUSLY: runtime.js never returns true from its message listener, so the channel closes when the handler returns. A background that waits for that answer uses the callback form of `chrome.tabs.sendMessage` and checks `chrome.runtime.lastError`, since `chrome` in Firefox has no promises.

## Patterns that work
- To keep a floating UI element from overlapping selected text, compute the text range's bounding rect, place the overlay below it (fallback: above), and clamp within the viewport.
- Define shared content-stylesheet rules in `src/content_scripts/content.css` (injected into every page via the manifest) instead of injecting `<style>` at runtime; keep only dynamic values inline.
- A comment explaining WHY must be anchored to the code under it: state the invariant first ("the reply destination is captured per request and must not be hoisted"), then what breaking it costs. Keep that consequence — it is what stops a future edit from looking like harmless cleanup — but describe the wrong design as a BEHAVIOR ("read the destination at delivery time"), never as a named thing the file does not contain ("a single shared slot", `clientInLLMRequest`): a reader greps the name, finds nothing, and stops trusting the comment.

## Mapping conventions
- `mapkey('<Space>x', ...)` normal mode; `vmapkey(...)` visual mode; `imapkey(...)` insert mode; `cmapkey(...)` command mode.
- Give each mapping a `#N` category prefix in the hint text (e.g. `'#8Open omnibar for word translation'`).

## Commit messages
- Keep them short: a conventional-commit subject (`docs(palette): …`, `feat(palette): …`) plus a body that says what changed and the one reason it matters, then stop. This holds for `feat`/`fix` too — the long multi-paragraph bodies in the existing history are NOT the pattern to copy, and reasoning a future reader needs while looking at the code belongs in a comment there, where they will actually find it.

## Verification
- After editing any JS file, run `node --check <file>` to confirm it parses.
- If a behavior depends on new/changed config (e.g. `settings.startToShowEmoji`), make sure it's defined in `runtime.js` `conf`.