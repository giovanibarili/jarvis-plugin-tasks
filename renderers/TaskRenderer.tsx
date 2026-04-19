// renderers/TaskRenderer.tsx
// HUD panel showing task progress with status icons and progress bar.

const { createElement, Fragment, useState, useMemo } = window.__JARVIS_REACT!;
const { useHudPiece } = window.__JARVIS_HUD_HOOKS ?? {};

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

const STATUS_ORDER: Record<string, number> = {
  in_progress: 0,
  blocked: 1,
  pending: 2,
  completed: 3,
};

const PRIORITY_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#6b7280",
  low: "#9ca3af",
};

type FilterStatus = "all" | "pending" | "in_progress" | "completed" | "blocked";

export default function TaskRenderer({ state }: { state: any }) {
  const piece = useHudPiece?.(state.id);
  const data: TaskData = (piece?.data ?? state.data) as TaskData;
  const [filter, setFilter] = useState<FilterStatus>("all");

  const tasks = data?.tasks ?? [];
  const summary = data?.summary ?? { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0 };

  const sorted = useMemo(() => {
    let filtered = filter === "all" ? tasks : tasks.filter(t => t.status === filter);
    return [...filtered].sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
  }, [tasks, filter]);

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

    // ── Task list ──
    createElement("div", { style: styles.list },
      sorted.map(t =>
        createElement("div", { key: t.id, style: styles.taskRow },
          createElement("span", { style: styles.icon }, STATUS_ICON[t.status]),
          createElement("div", { style: styles.taskBody },
            createElement("div", { style: styles.taskSubject },
              createElement("span", null, t.subject),
              t.priority !== "medium" &&
                createElement("span", {
                  style: { ...styles.priorityBadge, color: PRIORITY_COLOR[t.priority] }
                }, t.priority),
            ),
            createElement("div", { style: styles.taskMeta },
              t.sessionId !== "main" &&
                createElement("span", { style: styles.sessionTag }, t.sessionId),
              t.blockedBy.length > 0 &&
                createElement("span", { style: styles.blockedTag },
                  `blocked by: ${t.blockedBy.join(", ")}`
                ),
            ),
          ),
          createElement("span", { style: styles.taskId }, t.id),
        ),
      ),
    ),
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

const styles: Record<string, React.CSSProperties> = {
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
    gap: "4px",
    overflowY: "auto",
    flex: 1,
  },
  taskRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    padding: "6px 8px",
    borderRadius: "6px",
    backgroundColor: "#1e1e1e",
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
    textTransform: "uppercase" as const,
  },
  taskMeta: {
    display: "flex",
    gap: "6px",
    fontSize: "11px",
    color: "#666",
    marginTop: "2px",
  },
  sessionTag: {
    backgroundColor: "#2a2a2a",
    padding: "0 4px",
    borderRadius: "3px",
    color: "#888",
  },
  blockedTag: { color: "#ef4444", fontStyle: "italic" },
  taskId: {
    fontSize: "10px",
    color: "#555",
    flexShrink: 0,
    lineHeight: "20px",
  },
};
