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

  private unsubRemove?: () => void;

  async start(bus: EventBus): Promise<void> {
    this.bus = bus;
    this.registerCapabilities();
    this.registerRoutes();

    // When the panel is closed (removed from HUD), reset addedToHud so the
    // next publishToHud uses "add" (upsert) to re-create the component.
    this.unsubRemove = this.bus.subscribe("hud.update", (msg: any) => {
      if (msg.action === "remove" && msg.pieceId === this.id && msg.source !== this.id) {
        this.addedToHud = false;
      }
    });
  }

  async stop(): Promise<void> {
    this.unsubRemove?.();
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

  /**
   * The task manager intentionally injects NOTHING into the system prompt.
   *
   * Why:
   *   - Every create/update/delete would invalidate the BP1 cache, defeating
   *     prompt-caching gains.
   *   - Tasks are inherently per-session state; mixing them into a global
   *     prompt fragment leaks across sessions and confuses the LLM about
   *     what it can actually act on (writes are owner-only).
   *
   * The LLM discovers tasks on demand via `task_list` / `task_get`. The HUD
   * is the canonical surface for the human user.
   */
  systemContext(_sessionId?: string): string {
    return "";
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
      // Auto-block if any blocker is still incomplete
      const anyIncomplete = task.blockedBy.some(bId => {
        const blocker = this.tasks.get(bId);
        return blocker && blocker.status !== "completed";
      });
      if (anyIncomplete && (task.status === "pending" || task.status === "blocked")) {
        task.status = "blocked";
        task.updatedAt = this.now();
      }
    } else if (task.status === "blocked") {
      // No blockers left — unblock
      task.status = "pending";
      task.updatedAt = this.now();
    }
  }

  private publishToHud(): void {
    const allTasks = [...this.tasks.values()];
    const summary = this.summarize(allTasks);

    const data = {
      tasks: allTasks.map(t => ({ ...t })),
      summary,
    };

    // Always use "add" — ensures the panel re-appears after the user closes it.
    // HudState treats "add" on an existing pieceId as an upsert.
    this.addedToHud = true;

    this.bus.publish({
      channel: "hud.update",
      source: this.id,
      action: "add",
      pieceId: this.id,
      piece: {
        pieceId: this.id,
        type: "panel",
        name: this.name,
        status: "running",
        data: data as unknown as Record<string, unknown>,
        // Anchored panel — layout persists across restarts. Same pattern as
        // actor-pool. Do NOT set ephemeral:true here, which would make it
        // behave as a transient popup detached from the world map.
        position: { x: 1240, y: 350 },
        size: { width: 540, height: 480 },
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

        const callerSession = String(input.__sessionId ?? "main");
        if (task.sessionId !== callerSession) {
          return {
            success: false,
            error: `Task ${id} belongs to session "${task.sessionId}" — only its owner can update it.`,
          };
        }

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
      description:
        "Delete a task by ID. OWNERS ONLY — a session can only delete tasks it owns. " +
        "Also removes the deleted ID from other tasks' blockedBy lists.",
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
        const callerSession = String(input.__sessionId ?? "main");

        const task = this.tasks.get(id);
        if (!task) return { success: false, error: `Task ${id} not found` };

        if (task.sessionId !== callerSession) {
          return {
            success: false,
            error: `Task ${id} belongs to session "${task.sessionId}" — only its owner can delete it.`,
          };
        }

        this.tasks.delete(id);
        // Clean up references in other tasks
        const unblocked = this.resolveBlockers(id);
        // Also strip the deleted id from any remaining blockedBy lists
        for (const surviving of this.tasks.values()) {
          const before = surviving.blockedBy.length;
          surviving.blockedBy = surviving.blockedBy.filter(b => b !== id);
          if (surviving.blockedBy.length !== before) {
            this.recomputeBlocked(surviving.id);
            surviving.updatedAt = this.now();
          }
        }
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
        "Clear tasks owned by the CALLING session only. Cannot touch tasks from other sessions — " +
        "every session manages its own list. By default clears only 'completed' tasks; " +
        "pass all=true to clear every status (still scoped to the caller's session).",
      input_schema: {
        type: "object",
        properties: {
          all: {
            type: "boolean",
            description: "If true, clear all statuses (not just 'completed') within the caller's session.",
          },
        },
      },
      handler: (async (input: Record<string, unknown>) => {
        const callerSession = String(input.__sessionId ?? "main");
        const clearAllStatuses = input.all === true;

        let removed = 0;
        const removedIds: string[] = [];

        for (const [id, task] of this.tasks) {
          if (task.sessionId !== callerSession) continue;
          if (!clearAllStatuses && task.status !== "completed") continue;
          this.tasks.delete(id);
          removedIds.push(id);
          removed++;
        }

        // Clean up dangling blockedBy references in surviving tasks
        if (removedIds.length > 0) {
          const removedSet = new Set(removedIds);
          for (const surviving of this.tasks.values()) {
            const before = surviving.blockedBy.length;
            surviving.blockedBy = surviving.blockedBy.filter(b => !removedSet.has(b));
            if (surviving.blockedBy.length !== before) {
              this.recomputeBlocked(surviving.id);
              surviving.updatedAt = this.now();
            }
          }
        }

        this.publishToHud();
        return {
          success: true,
          removed,
          remaining: this.tasks.size,
          sessionId: callerSession,
        };
      }) as CapabilityHandler,
    });
  }

  // ─── HTTP Routes (HUD direct manipulation) ─────────────────
  // These routes bypass the owner-only check enforced on capabilities,
  // because the human user (operating the HUD) is the supreme owner of
  // every session. The capability layer remains strict so the LLM cannot
  // mess with tasks owned by other sessions.

  private registerRoutes(): void {
    // POST /plugins/tasks/create
    // Body: { sessionId, subject, description?, status?, priority?, blockedBy? }
    this.ctx.registerRoute("POST", "/plugins/tasks/create", async (req: any, res: any) => {
      try {
        const body = await readJsonBody(req);
        const sessionId = String(body.sessionId ?? "main");
        const subject = String(body.subject ?? "").trim();
        if (!subject) {
          return sendJson(res, 400, { ok: false, error: "subject is required" });
        }
        const blockedBy = Array.isArray(body.blockedBy)
          ? (body.blockedBy as string[]).filter(bId => this.tasks.has(bId))
          : [];
        const status: TaskStatus = blockedBy.length > 0
          ? "blocked"
          : (body.status === "in_progress" ? "in_progress" : "pending");

        const id = this.nextId();
        const task: Task = {
          id,
          sessionId,
          subject,
          description: body.description ? String(body.description) : undefined,
          status,
          priority: validPriority(body.priority) ?? "medium",
          blockedBy,
          createdAt: this.now(),
          updatedAt: this.now(),
          metadata: {},
        };
        this.tasks.set(id, task);
        this.publishToHud();
        sendJson(res, 200, { ok: true, task: { ...task } });
      } catch (e: any) {
        sendJson(res, 400, { ok: false, error: String(e?.message ?? e) });
      }
    });

    // POST /plugins/tasks/update/<id>
    // Body: { subject?, description?, status?, priority? }
    this.ctx.registerRoute("POST", "/plugins/tasks/update/", async (req: any, res: any) => {
      const id = req.url?.split("/plugins/tasks/update/")[1]?.split("?")[0];
      if (!id) return sendJson(res, 400, { ok: false, error: "Missing task id" });
      const task = this.tasks.get(id);
      if (!task) return sendJson(res, 404, { ok: false, error: `Task ${id} not found` });
      try {
        const body = await readJsonBody(req);
        if (typeof body.subject === "string") task.subject = body.subject.trim();
        if (body.description !== undefined) task.description = String(body.description);
        if (validPriority(body.priority)) task.priority = validPriority(body.priority)!;
        let unblocked: string[] = [];
        if (body.status && body.status !== task.status) {
          const newStatus = String(body.status) as TaskStatus;
          task.status = newStatus;
          if (newStatus === "completed") {
            task.completedAt = this.now();
            unblocked = this.resolveBlockers(id);
          }
        }
        task.updatedAt = this.now();
        this.publishToHud();
        sendJson(res, 200, { ok: true, task: { ...task }, ...(unblocked.length ? { unblocked } : {}) });
      } catch (e: any) {
        sendJson(res, 400, { ok: false, error: String(e?.message ?? e) });
      }
    });

    // POST /plugins/tasks/delete/<id>
    this.ctx.registerRoute("POST", "/plugins/tasks/delete/", async (req: any, res: any) => {
      const id = req.url?.split("/plugins/tasks/delete/")[1]?.split("?")[0];
      if (!id) return sendJson(res, 400, { ok: false, error: "Missing task id" });
      if (!this.tasks.has(id)) return sendJson(res, 404, { ok: false, error: `Task ${id} not found` });
      this.tasks.delete(id);
      const unblocked = this.resolveBlockers(id);
      // Strip dangling blockedBy refs
      for (const surviving of this.tasks.values()) {
        const before = surviving.blockedBy.length;
        surviving.blockedBy = surviving.blockedBy.filter(b => b !== id);
        if (surviving.blockedBy.length !== before) {
          this.recomputeBlocked(surviving.id);
          surviving.updatedAt = this.now();
        }
      }
      this.publishToHud();
      sendJson(res, 200, { ok: true, deleted: id, ...(unblocked.length ? { unblocked } : {}) });
    });

    // POST /plugins/tasks/clear-session/<sessionId>?all=true
    // Clears completed tasks of that session by default; ?all=true clears every status.
    this.ctx.registerRoute("POST", "/plugins/tasks/clear-session/", async (req: any, res: any) => {
      const url = req.url ?? "";
      const tail = url.split("/plugins/tasks/clear-session/")[1] ?? "";
      const [rawSession, query] = tail.split("?");
      const sessionId = decodeURIComponent(rawSession ?? "");
      if (!sessionId) return sendJson(res, 400, { ok: false, error: "Missing sessionId" });
      const clearAll = (query ?? "").includes("all=true");

      let removed = 0;
      const removedIds: string[] = [];
      for (const [id, task] of this.tasks) {
        if (task.sessionId !== sessionId) continue;
        if (!clearAll && task.status !== "completed") continue;
        this.tasks.delete(id);
        removedIds.push(id);
        removed++;
      }
      if (removedIds.length > 0) {
        const removedSet = new Set(removedIds);
        for (const surviving of this.tasks.values()) {
          const before = surviving.blockedBy.length;
          surviving.blockedBy = surviving.blockedBy.filter(b => !removedSet.has(b));
          if (surviving.blockedBy.length !== before) {
            this.recomputeBlocked(surviving.id);
            surviving.updatedAt = this.now();
          }
        }
      }
      this.publishToHud();
      sendJson(res, 200, { ok: true, removed, sessionId, all: clearAll });
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

/** Read and JSON-parse the request body. Resolves to {} on empty body. */
function readJsonBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function sendJson(res: any, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
