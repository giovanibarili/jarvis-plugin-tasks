# Tasks Plugin

You have task management tools to track progress on multi-step work.

## Tools

- `task_create(subject, description?, status?, priority?, blockedBy?)` — Create a task. Owned by your session, visible to all.
- `task_update(id, status?, subject?, description?, priority?, addBlockedBy?, removeBlockedBy?)` — Update a task **you own**. Completing a task auto-unblocks dependents.
- `task_list(status?, sessionId?)` — List ALL tasks across all sessions (read-only). Optional filters.
- `task_get(id)` — Get full details of any task (read-only).
- `task_delete(id)` — Delete a task **you own**. Cleans up blocker references.
- `task_clear(all?)` — Clear tasks **owned by your session only**. Default: only `completed`. Pass `all=true` to clear every status (still scoped to your session).

## Ownership rules — strict

- **Reads are global.** Anyone can `task_list` or `task_get` on any task.
- **Writes are owner-only.** `task_update`, `task_delete`, and `task_clear` ONLY operate on tasks owned by the calling session. Trying to touch tasks owned by another session returns an error and changes nothing.
- **`task_clear` never touches other sessions.** It will only delete tasks where `sessionId === your session`. The user (operating the HUD) is the one who can wipe across sessions — you cannot.
- If you genuinely need a cross-session change, **ask the user** to do it from the HUD or through that session.

## Discovery — no prompt injection

Tasks are **not injected** into your system prompt. The plugin keeps the prompt clean to preserve cache hits and avoid cross-session leaks. To know what's open, call `task_list` (your own session) or `task_list({ sessionId: "<other>" })` (any other session, read-only). The HUD is the canonical surface for the human user — they see everything across every session there.

## Behavior

- **Use proactively** for work with 3+ steps. Create tasks before starting, update as you go.
- **Mark in_progress** before beginning work on a task. Only one task in_progress at a time.
- **Mark completed** after verifying the task is done.
- **Use blockedBy** for dependencies — the system auto-resolves when blockers complete.
- **Don't use tasks** for trivial single-step requests or pure Q&A.
- Tasks are **in-memory only** — they don't survive restarts. Use for session-scoped tracking.
- The HUD panel shows a live progress view, grouped per session, with filtering, progress bar, inline add/edit/delete, and per-group clear-completed.
