// renderers/TaskRenderer.tsx
// HUD panel showing task progress with tree view — active task as parent,
// pending/blocked as children in sequence.
// React hooks are injected by esbuild banner via window.__JARVIS_REACT.

interface Task {
  id: string;
  sessionId: string;
  subject: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  priority: "low" | "medium" | "high" | "critical";
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

interface TaskSummary {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  blocked: number;
}

interface TaskData {
  tasks: Task[];
  summary: TaskSummary;
}

const STATUS_ICON: Record<string, string> = {
  pending: "⬚",
  in_progress: "🔧",
  completed: "✅",
  blocked: "🚫",
};

const PRIORITY_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#6b7280",
  low: "#9ca3af",
};

type FilterStatus = "all" | "pending" | "in_progress" | "completed" | "blocked";

// ─── Tree building ───────────────────────────────────────────

interface TreeNode {
  task: Task;
  children: TreeNode[];
}

function buildTree(tasks: Task[]): TreeNode[] {
  // Active tasks (in_progress) are roots.
  // Their children are: tasks that are blocked by them (direct),
  // plus pending tasks in creation order (the "sequence").
  // Completed and standalone tasks are also roots.

  const active = tasks.filter(t => t.status === "in_progress");
  const blocked = tasks.filter(t => t.status === "blocked");
  const pending = tasks.filter(t => t.status === "pending");
  const completed = tasks.filter(t => t.status === "completed");

  const claimed = new Set<string>();
  const roots: TreeNode[] = [];

  // For each active task, find children:
  // 1. Tasks blocked by this task (they list this task's id in blockedBy)
  // 2. Remaining pending tasks (sequence after the active)
  for (const act of active) {
    const children: TreeNode[] = [];

    // Pending tasks are the sequence
    for (const p of pending) {
      if (!claimed.has(p.id)) {
        claimed.add(p.id);
        children.push({ task: p, children: [] });
      }
    }

    // Blocked tasks that depend on this active task
    for (const b of blocked) {
      if (b.blockedBy.includes(act.id) && !claimed.has(b.id)) {
        claimed.add(b.id);
        children.push({ task: b, children: [] });
      }
    }

    claimed.add(act.id);
    roots.push({ task: act, children });
  }

  // Remaining blocked tasks (not claimed by any active) — as roots
  for (const b of blocked) {
    if (!claimed.has(b.id)) {
      claimed.add(b.id);
      roots.push({ task: b, children: [] });
    }
  }

  // Remaining pending tasks (no active parent) — as roots
  for (const p of pending) {
    if (!claimed.has(p.id)) {
      claimed.add(p.id);
      roots.push({ task: p, children: [] });
    }
  }

  // Completed tasks — at the bottom
  for (const c of completed) {
    if (!claimed.has(c.id)) {
      roots.push({ task: c, children: [] });
    }
  }

  return roots;
}

// ─── Render ──────────────────────────────────────────────────

export default function TaskRenderer({ state }: { state: any }) {
  const piece = useHudPiece?.(state.id);
  const data: TaskData = (piece?.data ?? state.data) as TaskData;
  const [filter, setFilter] = useState<FilterStatus>("all");

  const tasks = data?.tasks ?? [];
  const summary = data?.summary ?? { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0 };

  const tree = useMemo(() => {
    const filtered = filter === "all" ? tasks : tasks.filter(t => t.status === filter);
    return buildTree(filtered);
  }, [tasks, filter]);

  const multipleOwners = useMemo(() => {
    const sessions = new Set(tasks.map(t => t.sessionId));
    return sessions.size > 1;
  }, [tasks]);

  const pct = summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0;

  if (summary.total === 0) {
    return createElement("div", { style: styles.empty }, "No tasks yet.");
  }

  return createElement("div", { style: styles.container },
    // ── Progress bar ──
    createElement("div", { style: styles.progressSection },
      createElement("div", { style: styles.progressLabel },
        createElement("span", null, `${summary.completed}/${summary.total} completed`),
        createElement("span", { style: styles.pct }, `${pct}%`),
      ),
      createElement("div", { style: styles.progressTrack },
        createElement("div", { style: { ...styles.progressFill, width: `${pct}%` } }),
      ),
    ),

    // ── Summary chips ──
    createElement("div", { style: styles.chips },
      chipEl("all", `All ${summary.total}`, filter, setFilter),
      summary.in_progress > 0 && chipEl("in_progress", `🔧 ${summary.in_progress}`, filter, setFilter),
      summary.pending > 0 && chipEl("pending", `⬚ ${summary.pending}`, filter, setFilter),
      summary.blocked > 0 && chipEl("blocked", `🚫 ${summary.blocked}`, filter, setFilter),
      summary.completed > 0 && chipEl("completed", `✅ ${summary.completed}`, filter, setFilter),
    ),

    // ── Task tree ──
    createElement("div", { style: styles.list },
      tree.map(node => renderNode(node, tasks, multipleOwners)),
    ),
  );
}

function renderNode(node: TreeNode, allTasks: Task[], showSession: boolean): any {
  const t = node.task;
  const hasChildren = node.children.length > 0;

  return createElement("div", { key: t.id, style: styles.treeGroup },
    // Parent row
    renderTaskRow(t, allTasks, false, showSession),
    // Children
    hasChildren && createElement("div", { style: styles.childrenContainer },
      node.children.map((child, i) => {
        const isLast = i === node.children.length - 1;
        return createElement("div", { key: child.task.id, style: styles.childRow },
          // Tree connector
          createElement("div", { style: styles.connector },
            createElement("span", { style: styles.connectorChar }, isLast ? "└── " : "├── "),
          ),
          // Child task (compact)
          renderTaskRow(child.task, allTasks, true, showSession),
        );
      }),
    ),
  );
}

function renderTaskRow(t: Task, allTasks: Task[], isChild: boolean, showSession: boolean = false): any {
  return createElement("div", {
    style: {
      ...styles.taskRow,
      ...(isChild ? styles.taskRowChild : {}),
      ...(t.status === "in_progress" ? styles.taskRowActive : {}),
    }
  },
    createElement("span", { style: styles.icon }, STATUS_ICON[t.status]),
    createElement("div", { style: styles.taskBody },
      // Session tag above title
      showSession &&
        createElement("span", { style: styles.sessionTag },
          t.sessionId === "main" ? "jarvis" : t.sessionId.replace("actor-", "🤖 ")),
      createElement("div", { style: styles.taskSubject },
        createElement("span", null, t.subject),
        t.priority !== "medium" &&
          createElement("span", {
            style: { ...styles.priorityBadge, color: PRIORITY_COLOR[t.priority] }
          }, t.priority),
      ),
      t.description &&
        createElement("div", { style: styles.taskDescription }, t.description),
      // Blockers
      t.blockedBy.length > 0 &&
        createElement("div", { style: styles.taskMeta },
          createElement("span", { style: styles.blockedTag },
            `blocked by: ${t.blockedBy.map(id => {
              const blocker = allTasks.find(bt => bt.id === id);
              return blocker ? blocker.subject : id;
            }).join(", ")}`
          ),
        ),
    ),
    createElement("span", { style: styles.taskId }, t.id),
  );
}

function chipEl(
  value: FilterStatus,
  label: string,
  active: FilterStatus,
  setFilter: (v: FilterStatus) => void,
) {
  const isActive = value === active;
  return createElement("button", {
    key: value,
    style: {
      ...styles.chip,
      ...(isActive ? styles.chipActive : {}),
    },
    onClick: () => setFilter(value),
  }, label);
}

// ─── Styles ───────────────────────────────────────────────────

const styles: Record<string, any> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "12px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: "13px",
    color: "#e0e0e0",
    height: "100%",
    overflow: "hidden",
  },
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#666",
    fontStyle: "italic",
  },

  // Progress
  progressSection: { display: "flex", flexDirection: "column", gap: "4px" },
  progressLabel: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "12px",
    color: "#999",
  },
  pct: { fontWeight: 600, color: "#8b5cf6" },
  progressTrack: {
    height: "6px",
    borderRadius: "3px",
    backgroundColor: "#2a2a2a",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: "3px",
    backgroundColor: "#8b5cf6",
    transition: "width 0.3s ease",
  },

  // Chips
  chips: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
  },
  chip: {
    padding: "2px 8px",
    borderRadius: "10px",
    border: "1px solid #444",
    backgroundColor: "transparent",
    color: "#aaa",
    fontSize: "11px",
    cursor: "pointer",
    outline: "none",
  },
  chipActive: {
    backgroundColor: "#8b5cf6",
    borderColor: "#8b5cf6",
    color: "#fff",
  },

  // List
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    overflowY: "auto",
    flex: 1,
  },

  // Tree
  treeGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "0px",
    marginBottom: "4px",
  },
  childrenContainer: {
    display: "flex",
    flexDirection: "column",
    gap: "0px",
    marginLeft: "6px",
  },
  childRow: {
    display: "flex",
    alignItems: "flex-start",
  },
  connector: {
    flexShrink: 0,
    width: "28px",
    paddingTop: "6px",
  },
  connectorChar: {
    fontFamily: "monospace",
    fontSize: "12px",
    color: "#444",
    whiteSpace: "pre",
  },

  // Task row
  taskRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    padding: "6px 8px",
    borderRadius: "6px",
    backgroundColor: "#1e1e1e",
    flex: 1,
  },
  taskRowChild: {
    backgroundColor: "#191919",
    padding: "4px 8px",
  },
  taskRowActive: {
    borderLeft: "2px solid #8b5cf6",
  },

  icon: { fontSize: "14px", lineHeight: "20px", flexShrink: 0 },
  taskBody: { flex: 1, minWidth: 0 },
  taskSubject: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    lineHeight: "20px",
  },
  priorityBadge: {
    fontSize: "10px",
    fontWeight: 600,
    textTransform: "uppercase",
  },
  taskDescription: {
    fontSize: "11px",
    color: "#888",
    marginTop: "2px",
    lineHeight: "16px",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  taskMeta: {
    display: "flex",
    gap: "6px",
    fontSize: "11px",
    color: "#666",
    marginTop: "2px",
  },
  sessionTag: {
    display: "inline-block",
    backgroundColor: "#2a2a2a",
    padding: "0 5px",
    borderRadius: "3px",
    color: "#888",
    fontSize: "10px",
    marginBottom: "2px",
  },
  blockedTag: { color: "#ef4444", fontStyle: "italic" },
  taskId: {
    fontSize: "10px",
    color: "#555",
    flexShrink: 0,
    lineHeight: "20px",
  },
};
