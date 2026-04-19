# jarvis-plugin-tasks

In-memory task management with progress tracking for [JARVIS](https://github.com/giovanibarili/jarvis-app).

Track multi-step work with dependencies, priorities, and automatic blocker resolution — all visible in a live HUD panel with tree view, progress bar, and filter chips.

## Features

- **Per-session ownership, global visibility** — tasks belong to a session (main, actor-alice, etc.) but `task_list` returns everything across all sessions
- **Dependency management** — `blockedBy` links between tasks; completing a blocker auto-unblocks dependents
- **Tree view HUD** — active (in_progress) tasks render as roots, pending tasks indent below as children, blocked tasks show resolved blocker names
- **Progress bar** — real-time completion percentage with filter chips by status
- **Session tags** — when tasks come from multiple sessions, each row shows its owner ("jarvis" for main, "🤖 alice" for actors)
- **System context injection** — the AI sees a `<tasks-status>` summary every turn, keeping it aware of progress without explicit queries

## Requirements

- **JARVIS** ≥ 0.2.0 (`@jarvis/core` ≥ 0.2.0)

## Installation

```
plugin_install github.com/giovanibarili/jarvis-plugin-tasks
```

Or ask JARVIS:

```
"Install the tasks plugin from github.com/giovanibarili/jarvis-plugin-tasks"
```

## Tools

| Tool | Description |
|------|-------------|
| `task_create` | Create a task with subject, description, status, priority, and blockedBy |
| `task_update` | Update status, subject, description, priority, or blockers. Completing a task auto-unblocks dependents |
| `task_list` | List all tasks across all sessions. Filter by status or sessionId |
| `task_get` | Get full details of a specific task by ID |
| `task_delete` | Delete a task and clean up blocker references |
| `task_clear` | Clear completed tasks (default) or all tasks |

## Plugin Structure

```
jarvis-plugin-tasks/
├── plugin.json              ← manifest
├── package.json             ← npm metadata
├── context.md               ← system prompt instructions (injected every turn)
├── functional-test.md       ← 26 BDD scenarios
├── pieces/
│   ├── index.ts             ← entry point
│   └── task-manager.ts      ← TaskManagerPiece (capabilities, state, HUD, system context)
└── renderers/
    └── TaskRenderer.tsx      ← HUD panel (tree view, progress bar, filter chips)
```

## How It Works

Tasks live in memory for the duration of the session. They don't persist across restarts — this is by design for lightweight, session-scoped tracking.

The AI uses tasks proactively when working on multi-step plans. It creates tasks before starting, marks them `in_progress` one at a time, and completes them as work finishes. The HUD panel updates in real-time via the EventBus.

Dependencies are expressed via `blockedBy` arrays. When a blocking task completes, all dependents are automatically moved from `blocked` to `pending`. Deleting a blocker also unblocks its dependents.

## Creating the Repo, Committing, and Pushing

If you're developing this plugin locally and want to publish it:

```bash
# 1. Navigate to the plugin directory
cd ~/.jarvis/plugins/jarvis-plugin-tasks

# 2. Initialize git (if not already)
git init

# 3. Create .gitignore
echo "node_modules/" > .gitignore

# 4. Stage all files
git add -A

# 5. Commit
git commit -m "Initial: task manager plugin — in-memory, per-session with global visibility"

# 6. Create the repo on GitHub (requires gh CLI)
gh repo create giovanibarili/jarvis-plugin-tasks --public --source=. --push

# 7. For subsequent changes, the normal flow:
git add -A
git commit -m "your message"
git push origin main
```

After pushing, anyone can install with:

```
plugin_install github.com/giovanibarili/jarvis-plugin-tasks
```

## License

MIT
