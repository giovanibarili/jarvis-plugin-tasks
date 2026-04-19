# Functional Tests — jarvis-plugin-tasks

## Scenario 1: Plugin loads and registers tools

**Given** the plugin is enabled
**When** I list available tools
**Then** I see `task_create`, `task_update`, `task_list`, `task_get`, `task_delete`, `task_clear`

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
  - blockedBy is empty
  - createdAt and updatedAt are set

---

## Scenario 3: Create a task with in_progress status

**When** I call `task_create` with subject "Implement API" and status "in_progress"
**Then** the returned task has status "in_progress"

---

## Scenario 4: Create a task with blockers — auto-blocked

**Given** task t-1 exists with status "pending"
**When** I call `task_create` with subject "Write tests" and blockedBy ["t-1"]
**Then** the new task has status "blocked"
**And** blockedBy contains "t-1"

---

## Scenario 5: Create a task with invalid blockers — ignored

**When** I call `task_create` with subject "Deploy" and blockedBy ["t-999"]
**Then** the new task has status "pending" (not blocked)
**And** blockedBy is empty (invalid ID filtered out)

---

## Scenario 6: task_list returns all tasks across sessions

**Given** tasks exist from different sessions
**When** I call `task_list` with no filters
**Then** ALL tasks are returned regardless of owning session
**And** summary totals match

---

## Scenario 7: task_list filters by status

**Given** tasks exist with mixed statuses
**When** I call `task_list` with status "pending"
**Then** only pending tasks are returned

---

## Scenario 8: task_get returns full details

**Given** task t-1 exists
**When** I call `task_get` with id "t-1"
**Then** success is true and full task object is returned

---

## Scenario 9: task_get with invalid ID

**When** I call `task_get` with id "t-999"
**Then** success is false with error message

---

## Scenario 10: task_update changes status

**Given** task t-1 exists with status "pending"
**When** I call `task_update` with id "t-1" and status "in_progress"
**Then** the task status is "in_progress"
**And** updatedAt is refreshed

---

## Scenario 11: Completing a task unblocks dependents

**Given** task t-1 is "in_progress"
**And** task t-2 is "blocked" with blockedBy ["t-1"]
**When** I call `task_update` with id "t-1" and status "completed"
**Then** t-1 has status "completed" and completedAt is set
**And** t-2 is now "pending" (auto-unblocked)
**And** the response includes unblocked: ["t-2"]

---

## Scenario 12: task_update modifies subject and priority

**Given** task t-1 exists
**When** I call `task_update` with id "t-1", subject "New name", priority "critical"
**Then** subject is "New name" and priority is "critical"

---

## Scenario 13: task_update addBlockedBy and removeBlockedBy

**Given** task t-1 and t-2 exist
**And** t-2 has blockedBy ["t-1"]
**When** I call `task_update` on t-2 with removeBlockedBy ["t-1"]
**Then** t-2 blockedBy is empty

---

## Scenario 14: task_delete removes task and cleans references

**Given** task t-1 exists
**And** task t-2 has blockedBy ["t-1"]
**When** I call `task_delete` with id "t-1"
**Then** t-1 no longer exists
**And** t-2 blockedBy no longer contains "t-1"
**And** t-2 is unblocked (status becomes "pending")

---

## Scenario 15: task_delete with invalid ID

**When** I call `task_delete` with id "t-999"
**Then** success is false with error message

---

## Scenario 16: task_clear removes only completed tasks

**Given** tasks exist: t-1 (completed), t-2 (pending), t-3 (completed)
**When** I call `task_clear` with no parameters
**Then** t-1 and t-3 are removed
**And** t-2 still exists
**And** response shows removed: 2, remaining: 1

---

## Scenario 17: task_clear with all=true removes everything

**Given** tasks exist
**When** I call `task_clear` with all=true
**Then** all tasks are removed
**And** remaining is 0

---

## Scenario 18: System context includes active tasks

**Given** tasks exist with mixed statuses
**When** I inspect systemContext()
**Then** it includes `<tasks-status>` block
**And** shows summary line with counts
**And** lists non-completed tasks with icons and IDs

---

## Scenario 19: System context is empty when no tasks

**Given** no tasks exist
**When** I inspect systemContext()
**Then** it returns empty string

---

## Scenario 20: HUD panel shows after first task

**Given** no tasks exist (HUD panel not visible)
**When** I create a task
**Then** a HUD panel appears with the TaskRenderer
**And** it shows the progress bar and task list

---

## Scenario 21: Create task with empty subject fails

**When** I call `task_create` with subject ""
**Then** success is false with error "subject is required"
