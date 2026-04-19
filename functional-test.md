# Functional Tests — jarvis-plugin-tasks

> **Convention:** Every scenario starts with `task_clear(all=true)` to ensure a clean slate.
> IDs are not hardcoded — always capture the returned `task.id` and reference it in subsequent calls.
> HUD scenarios include a screenshot step for visual validation.

---

## Scenario 1: Plugin loads and registers tools

**Given** the plugin is enabled
**When** I list available tools filtered by `task_`
**Then** I see exactly 6 tools: `task_create`, `task_update`, `task_list`, `task_get`, `task_delete`, `task_clear`

---

## Scenario 2: Create a task with defaults

**Given** no tasks exist
**When** I call `task_create` with subject "Design database schema"
**Then** success is true
**And** the returned task has:
  - id matching pattern `t-N`
  - status "pending"
  - priority "medium"
  - sessionId is the calling session
  - blockedBy is empty array
  - createdAt and updatedAt are set (ISO timestamps)

---

## Scenario 3: Create a task with in_progress status

**Given** no tasks exist
**When** I call `task_create` with subject "Implement API" and status "in_progress"
**Then** the returned task has status "in_progress"

---

## Scenario 4: Create a task with blockers — auto-blocked

**Given** no tasks exist
**And** I create task A (subject: "Prerequisite") — capture its id
**When** I call `task_create` with subject "Write tests" and blockedBy [A.id]
**Then** the new task has status "blocked"
**And** blockedBy contains A.id

---

## Scenario 5: Create a task with invalid blockers — ignored

**Given** no tasks exist
**When** I call `task_create` with subject "Deploy" and blockedBy ["t-999"]
**Then** the new task has status "pending" (not blocked)
**And** blockedBy is empty (invalid ID filtered out)

---

## Scenario 6: task_list returns all tasks

**Given** no tasks exist
**And** I create 3 tasks with different subjects
**When** I call `task_list` with no filters
**Then** all 3 tasks are returned
**And** summary.total equals 3

---

## Scenario 7: task_list filters by status

**Given** no tasks exist
**And** I create task A with status "in_progress"
**And** I create task B (default pending)
**When** I call `task_list` with status "pending"
**Then** only task B is returned
**And** summary.pending equals 1

---

## Scenario 8: task_get returns full details

**Given** no tasks exist
**And** I create task A — capture its id
**When** I call `task_get` with A.id
**Then** success is true and full task object matches what was created

---

## Scenario 9: task_get with invalid ID

**When** I call `task_get` with id "t-999"
**Then** success is false with an error message containing "not found"

---

## Scenario 10: task_update changes status

**Given** no tasks exist
**And** I create task A (default pending) — capture its id and updatedAt
**When** I call `task_update` with A.id and status "in_progress"
**Then** the returned task has status "in_progress"
**And** updatedAt is different from the original (refreshed)

---

## Scenario 11: Completing a task unblocks dependents

**Given** no tasks exist
**And** I create task A with status "in_progress" — capture A.id
**And** I create task B with blockedBy [A.id] — B should be "blocked"
**When** I call `task_update` with A.id and status "completed"
**Then** A has status "completed" and completedAt is set
**And** the response includes unblocked containing B.id
**And** calling `task_get` on B.id shows status "pending" (auto-unblocked)

---

## Scenario 12: task_update modifies subject and priority

**Given** no tasks exist
**And** I create task A — capture its id
**When** I call `task_update` with A.id, subject "New name", priority "critical"
**Then** subject is "New name" and priority is "critical"

---

## Scenario 13: task_update addBlockedBy and removeBlockedBy

**Given** no tasks exist
**And** I create task A and task B — capture both ids
**When** I call `task_update` on B with addBlockedBy [A.id]
**Then** B.blockedBy contains A.id
**When** I call `task_update` on B with removeBlockedBy [A.id]
**Then** B.blockedBy is empty

---

## Scenario 14: task_delete removes task and cleans references

**Given** no tasks exist
**And** I create task A — capture A.id
**And** I create task B with blockedBy [A.id] — B is "blocked"
**When** I call `task_delete` with A.id
**Then** A no longer exists (task_get returns success: false)
**And** calling `task_get` on B shows blockedBy empty and status "pending"

---

## Scenario 15: task_delete with invalid ID

**When** I call `task_delete` with id "t-999"
**Then** success is false with error message

---

## Scenario 16: task_clear removes only completed tasks

**Given** no tasks exist
**And** I create task A, update to "completed"
**And** I create task B (stays pending)
**And** I create task C, update to "completed"
**When** I call `task_clear` with no parameters
**Then** response shows removed: 2, remaining: 1
**And** task_list returns only B

---

## Scenario 17: task_clear with all=true removes everything

**Given** tasks exist from previous scenarios
**When** I call `task_clear` with all=true
**Then** all tasks are removed
**And** remaining is 0

---

## Scenario 18: System context includes active tasks

**Given** no tasks exist
**And** I create task A with status "in_progress" (subject: "Build API")
**And** I create task B (subject: "Write docs", default pending)
**When** I inspect systemContext() via `jarvis_eval`
**Then** it includes `<tasks-status>` block
**And** shows summary line with counts (total 2, 1 in_progress, 1 pending)
**And** lists both tasks with icons and IDs

---

## Scenario 19: System context is empty when no tasks

**Given** no tasks exist
**When** I inspect systemContext() via `jarvis_eval`
**Then** it returns empty string

---

## Scenario 20: HUD panel shows after first task (visual)

**Given** no tasks exist
**When** I create a task with subject "First task"
**And** I take a screenshot
**Then** the HUD shows a Tasks panel with:
  - A progress bar (0% — 0/1 completed)
  - The task "First task" with pending icon (⬚)
  - Filter chips visible ("All 1")

---

## Scenario 21: Create task with empty subject fails

**When** I call `task_create` with subject ""
**Then** success is false with error "subject is required"

---

## Scenario 22: HUD panel shows task description (visual)

**Given** no tasks exist
**When** I create a task with subject "Test task" and description "Detailed description here"
**And** I take a screenshot
**Then** the HUD panel shows "Test task" as title
**And** below it, a grey line with "Detailed description here"

---

## Scenario 23: HUD panel tree view — active task as root (visual)

**Given** no tasks exist
**When** I create task A with subject "Active work" and status "in_progress"
**And** I create task B with subject "Next step" (pending)
**And** I create task C with subject "Final step" (pending)
**And** I take a screenshot
**Then** the HUD panel shows:
  - A as root row with purple left border (active indicator)
  - B and C indented below with tree connectors (├── and └──)

---

## Scenario 24: HUD panel shows blocked-by with resolved names (visual)

**Given** no tasks exist
**When** I create task A with subject "Auth flow" and status "in_progress" — capture A.id
**And** I create task B with subject "Deploy" and blockedBy [A.id]
**And** I take a screenshot
**Then** the HUD panel shows task B with:
  - 🚫 icon (blocked)
  - Red italic text "blocked by: Auth flow" (resolved name, not task ID)

---

## Scenario 25: HUD panel session tags — single owner hidden (visual)

**Given** no tasks exist
**When** I create two tasks from the main session
**And** I take a screenshot
**Then** no session tags appear on any task row (all from same session = tags hidden)

---

## Scenario 26: HUD panel session tags — multiple owners shown (visual)

**Given** tasks exist from the main session (from scenario 25 or fresh)
**When** an actor creates a task via `actor_dispatch` (e.g., actor "tester" creates a task)
**And** I take a screenshot
**Then** each task shows a session tag:
  - "jarvis" for tasks from main session
  - "🤖 tester" for tasks from the actor session
