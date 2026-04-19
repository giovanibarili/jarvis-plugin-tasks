# Tasks Plugin

You have task management tools to track progress on multi-step work.

## Tools

- `task_create(subject, description?, status?, priority?, blockedBy?)` — Create a task. Owned by your session, visible to all.
- `task_update(id, status?, subject?, description?, priority?, addBlockedBy?, removeBlockedBy?)` — Update a task. Completing a task auto-unblocks dependents.
- `task_list(status?, sessionId?)` — List ALL tasks across all sessions. Optional filters.
- `task_get(id)` — Get full details of a task.
- `task_delete(id)` — Delete a task. Cleans up blocker references.
- `task_clear(all?)` — Clear completed tasks (default) or all tasks.

## Behavior

- **Use proactively** for work with 3+ steps. Create tasks before starting, update as you go.
- **Mark in_progress** before beginning work on a task. Only one task in_progress at a time.
- **Mark completed** after verifying the task is done.
- **Use blockedBy** for dependencies — the system auto-resolves when blockers complete.
- **Don't use tasks** for trivial single-step requests or pure Q&A.
- Tasks are **in-memory only** — they don't survive restarts. Use for session-scoped tracking.
- The HUD panel shows a live progress view with filtering and progress bar.
