// pieces/task-manager.ts
// TaskManagerPiece — in-memory task management with per-session ownership
// and global visibility. Each task belongs to a session (main, actor-alice, etc.)
// but task_list returns ALL tasks across all sessions.

import type {
  Piece,
  PluginContext,
  EventBus,
  CapabilityHandler,
} from "@jarvis/core";

// ─── Types ──────────────────────────────────────────────────

type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";
type TaskPriority = "low" | "medium" | "high" | "critical";

interface Task {
  id: string;
  sessionId: string;
  subject: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  metadata: Record<string, unknown>;
}

interface TaskSummary {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  blocked: number;
}

// ─── Piece ──────────────────────────────────────────────────

export class TaskManagerPiece implements Piece {
  readonly id = "task-manager";
  readonly name = "Task Manager";

  private bus!: EventBus;
  private ctx: PluginContext;

  private tasks = new Map<string, Task>();
  private idCounter = 0;
  private addedToHud = false;

  constructor(ctx: PluginContext) {
    this.ctx = ctx;
  }

  async start(bus: EventBus): Promise<void> {
    this.bus = bus;
    this.registerCapabilities();
  }

  async stop(): Promise<void> {
    if (this.addedToHud) {
      this.bus.publish({
        channel: "hud.update",
        source: this.id,
        action: "remove",
        pieceId: this.id,
      });
      this.addedToHud = false;
    }
  }

  // ─── System context ─────────────────────────────────────────

  systemContext(sessionId?: string): string {
    const allTasks = [...this.tasks.values()];
    if (allTasks.length === 0) return "";

    const summary = this.summarize(allTasks);
    const lines: string[] = [
      `<tasks-status>`,
      `Total: ${summary.total} | ✅ ${summary.completed} | 🔧 ${summary.in_progress} | ⬚ ${summary.pending} | 🚫 ${summary.blocked}`,
    ];

    // Show non-completed tasks
    const active = allTasks.filter(t => t.status !== "completed");
    if (active.length > 0) {
      lines.push("");
      for (const t of active) {
        const icon = statusIcon(t.status);
        const owner = t.sessionId === "main" ? "" : ` [${t.sessionId}]`;
        const blockers = t.blockedBy.length > 0 ? ` (blocked by: ${t.blockedBy.join(", ")})` : "";
        lines.push(`${icon} ${t.id}: ${t.subject}${owner}${blockers}`);
      }
    }

    lines.push("</tasks-status>");
    return lines.join("\n");
  }

  // ─── State helpers ──────────────────────────────────────────

  private nextId(): string {
    this.idCounter += 1;
    return `t-${this.idCounter}`;
  }

  private now(): string {
    return new Date().toISOString();
  }

  private summarize(tasks: Task[]): TaskSummary {
    const summary: TaskSummary = { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0 };
    for (const t of tasks) {
      summary.total++;
      summary[t.status]++;
    }
    return summary;
  }

  /** When a task completes, unblock tasks that depended on it */
  private resolveBlockers(completedId: string): string[] {
    const unblocked: string[] = [];
    for (const task of this.tasks.values()) {
      if (task.blockedBy.includes(completedId)) {
        task.blockedBy = task.blockedBy.filter(id => id !== completedId);
        // If no more blockers and was blocked, move to pending
        if (task.blockedBy.length === 0 && task.status === "blocked") {
          task.status = "pending";
          task.updatedAt = this.now();
          unblocked.push(task.id);
        }
      }
    }
    return unblocked;
  }

  /** Recompute blocked status based on current blockedBy lists */
  private recomputeBlocked(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.blockedBy.length > 0) {
      // Only auto-block if all blockers are still incomplete
      const anyIncomplete = task.blockedBy.some(bId => {
        const blocker = this.tasks.get(bId);
        return blocker && blocker.status !== "completed";
      });
      if (anyIncomplete && task.status === "pending") {
        task.status = "blocked";
        task.updatedAt = this.now();
      }
    }
  }

  private publishToHud(): void {
    const allTasks = [...this.tasks.values()];
    const summary = this.summarize(allTasks);

    const data = {
      tasks: allTasks.map(t => ({ ...t })),
      summary,
    };

    const action = this.addedToHud ? "update" : "add";
    this.addedToHud = true;

    this.bus.publish({
      channel: "hud.update",
      source: this.id,
      action,
      pieceId: this.id,
      piece: {
        pieceId: this.id,
        type: "panel",
        name: this.name,
        status: "running",
        data: data as unknown as Record<string, unknown>,
        position: { x: 50, y: 50 },
        size: { width: 500, height: 400 },
        ephemeral: true,
        renderer: { plugin: "jarvis-plugin-tasks", file: "TaskRenderer" },
      },
      data: data as unknown as Record<string, unknown>,
      status: "running",
      visible: true,
    });
  }

  // ─── Capabilities ───────────────────────────────────────────

  private registerCapabilities(): void {
    const reg = this.ctx.capabilityRegistry;

    // ── task_create ──────────────────────────────────────────
    reg.register({
      name: "task_create",
      description:
        "Create a new task. Returns the created task. Use for multi-step work to track progress. " +
        "The task is owned by the calling session but visible to all sessions.",
      input_schema: {
        type: "object",
        properties: {
          subject: {
            type: "string",
            description: "Short title of the task.",
          },
          description: {
            type: "string",
            description: "Optional detailed description.",
          },
          status: {
            type: "string",
            enum: ["pending", "in_progress"],
            description: "Initial status. Defaults to 'pending'.",
          },
          priority: {
            type: "string",
            enum: ["low", "medium", "high", "critical"],
            description: "Priority level. Defaults to 'medium'.",
          },
          blockedBy: {
            type: "array",
            items: { type: "string" },
            description: "IDs of tasks that must complete before this one can start.",
          },
        },
        required: ["subject"],
      },
      handler: (async (input: Record<string, unknown>) => {
        const sessionId = String(input.__sessionId ?? "main");
        const subject = String(input.subject ?? "").trim();
        if (!subject) return { success: false, error: "subject is required" };

        const id = this.nextId();
        const blockedBy = Array.isArray(input.blockedBy)
          ? (input.blockedBy as string[]).filter(bId => this.tasks.has(bId))
          : [];

        const status: TaskStatus = blockedBy.length > 0
          ? "blocked"
          : (input.status === "in_progress" ? "in_progress" : "pending");

        const task: Task = {
          id,
          sessionId,
          subject,
          description: input.description ? String(input.description) : undefined,
          status,
          priority: validPriority(input.priority) ?? "medium",
          blockedBy,
          createdAt: this.now(),
          updatedAt: this.now(),
          metadata: {},
        };

        this.tasks.set(id, task);
        this.publishToHud();

        return { success: true, task: { ...task } };
      }) as CapabilityHandler,
    });

    // ── task_update ──────────────────────────────────────────
    reg.register({
      name: "task_update",
      description:
        "Update a task's status, subject, description, priority, or blockers. " +
        "When a task is marked 'completed', tasks blocked by it are automatically unblocked.",
      input_schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Task ID (e.g. 't-1').",
          },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "blocked"],
            description: "New status.",
          },
          subject: {
            type: "string",
            description: "New subject.",
          },
          description: {
            type: "string",
            description: "New description.",
          },
          priority: {
            type: "string",
            enum: ["low", "medium", "high", "critical"],
            description: "New priority.",
          },
          addBlockedBy: {
            type: "array",
            items: { type: "string" },
            description: "Task IDs to add as blockers.",
          },
          removeBlockedBy: {
            type: "array",
            items: { type: "string" },
            description: "Task IDs to remove from blockers.",
          },
        },
        required: ["id"],
      },
      handler: (async (input: Record<string, unknown>) => {
        const id = String(input.id);
        const task = this.tasks.get(id);
        if (!task) return { success: false, error: `Task ${id} not found` };

        if (input.subject) task.subject = String(input.subject).trim();
        if (input.description !== undefined) task.description = String(input.description);
        if (validPriority(input.priority)) task.priority = validPriority(input.priority)!;

        // Blocker mutations
        if (Array.isArray(input.addBlockedBy)) {
          for (const bId of input.addBlockedBy as string[]) {
            if (this.tasks.has(bId) && !task.blockedBy.includes(bId)) {
              task.blockedBy.push(bId);
            }
          }
        }
        if (Array.isArray(input.removeBlockedBy)) {
          task.blockedBy = task.blockedBy.filter(bId => !(input.removeBlockedBy as string[]).includes(bId));
        }

        // Status transition
        let unblocked: string[] = [];
        if (input.status && input.status !== task.status) {
          const newStatus = String(input.status) as TaskStatus;
          task.status = newStatus;
          if (newStatus === "completed") {
            task.completedAt = this.now();
            unblocked = this.resolveBlockers(id);
          }
        }

        // Recompute blocked if blockers changed
        this.recomputeBlocked(id);

        task.updatedAt = this.now();
        this.publishToHud();

        return {
          success: true,
          task: { ...task },
          ...(unblocked.length > 0 ? { unblocked } : {}),
        };
      }) as CapabilityHandler,
    });

    // ── task_list ────────────────────────────────────────────
    reg.register({
      name: "task_list",
      description:
        "List ALL tasks across all sessions. Returns tasks and a summary. " +
        "Optionally filter by status or session.",
      input_schema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "blocked"],
            description: "Filter by status.",
          },
          sessionId: {
            type: "string",
            description: "Filter by owning session (e.g. 'main', 'actor-alice').",
          },
        },
      },
      handler: (async (input: Record<string, unknown>) => {
        let tasks = [...this.tasks.values()];

        if (input.status) {
          tasks = tasks.filter(t => t.status === String(input.status));
        }
        if (input.sessionId) {
          tasks = tasks.filter(t => t.sessionId === String(input.sessionId));
        }

        return {
          success: true,
          tasks: tasks.map(t => ({ ...t })),
          summary: this.summarize(tasks),
        };
      }) as CapabilityHandler,
    });

    // ── task_get ─────────────────────────────────────────────
    reg.register({
      name: "task_get",
      description: "Get full details of a specific task by ID.",
      input_schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Task ID (e.g. 't-1').",
          },
        },
        required: ["id"],
      },
      handler: (async (input: Record<string, unknown>) => {
        const id = String(input.id);
        const task = this.tasks.get(id);
        if (!task) return { success: false, error: `Task ${id} not found` };
        return { success: true, task: { ...task } };
      }) as CapabilityHandler,
    });

    // ── task_delete ──────────────────────────────────────────
    reg.register({
      name: "task_delete",
      description: "Delete a task by ID. Also removes it from other tasks' blockedBy lists.",
      input_schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Task ID to delete.",
          },
        },
        required: ["id"],
      },
      handler: (async (input: Record<string, unknown>) => {
        const id = String(input.id);
        if (!this.tasks.has(id)) return { success: false, error: `Task ${id} not found` };

        this.tasks.delete(id);
        // Clean up references in other tasks
        const unblocked = this.resolveBlockers(id);
        this.publishToHud();

        return {
          success: true,
          deleted: id,
          ...(unblocked.length > 0 ? { unblocked } : {}),
        };
      }) as CapabilityHandler,
    });

    // ── task_clear ───────────────────────────────────────────
    reg.register({
      name: "task_clear",
      description:
        "Clear tasks. By default clears only 'completed' tasks. " +
        "Pass all=true to clear everything.",
      input_schema: {
        type: "object",
        properties: {
          all: {
            type: "boolean",
            description: "If true, clear ALL tasks. Otherwise only completed.",
          },
        },
      },
      handler: (async (input: Record<string, unknown>) => {
        const clearAll = input.all === true;
        let removed = 0;

        if (clearAll) {
          removed = this.tasks.size;
          this.tasks.clear();
        } else {
          for (const [id, task] of this.tasks) {
            if (task.status === "completed") {
              this.tasks.delete(id);
              removed++;
            }
          }
        }

        this.publishToHud();
        return { success: true, removed, remaining: this.tasks.size };
      }) as CapabilityHandler,
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────

function statusIcon(status: TaskStatus): string {
  switch (status) {
    case "pending": return "⬚";
    case "in_progress": return "🔧";
    case "completed": return "✅";
    case "blocked": return "🚫";
  }
}

const VALID_PRIORITIES = new Set(["low", "medium", "high", "critical"]);

function validPriority(val: unknown): TaskPriority | null {
  if (typeof val === "string" && VALID_PRIORITIES.has(val)) return val as TaskPriority;
  return null;
}
