// renderers/TaskRenderer.tsx
// HUD panel showing task progress.
// Features:
//   - Tasks are grouped per sessionId, with collapsible headers.
//   - Each group exposes a `+` (create), `🗑` (clear completed in that session)
//     and a per-row `×` (delete). Clicking a task's subject opens inline edit.
//   - Status filter chips remain on top.
//   - All write operations go through HTTP routes registered by the plugin
//     (`/plugins/tasks/...`) so the HUD bypasses the owner-only rule the
//     capability layer enforces on the LLM.
//
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

// ─── HTTP helpers ─────────────────────────────────────────────

async function postJson(path: string, body?: unknown): Promise<any> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json().catch(() => ({}));
  } catch (e) {
    console.error("[task-renderer] HTTP failed:", path, e);
    return { ok: false, error: String(e) };
  }
}

const apiCreate = (sessionId: string, subject: string) =>
  postJson("/plugins/tasks/create", { sessionId, subject });

const apiUpdate = (id: string, patch: Partial<Pick<Task, "subject" | "description" | "status" | "priority">>) =>
  postJson(`/plugins/tasks/update/${id}`, patch);

const apiDelete = (id: string) =>
  postJson(`/plugins/tasks/delete/${id}`);

const apiClearSession = (sessionId: string, all: boolean) =>
  postJson(`/plugins/tasks/clear-session/${encodeURIComponent(sessionId)}${all ? "?all=true" : ""}`);

// ─── Render ──────────────────────────────────────────────────

export default function TaskRenderer({ state }: { state: any }) {
  const piece = useHudPiece?.(state.id);
  const data: TaskData = (piece?.data ?? state.data) as TaskData;
  const [filter, setFilter] = useState<FilterStatus>("all");

  // collapse state per sessionId — default expanded
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // inline edit state — { taskId: draftSubject }
  const [editing, setEditing] = useState<Record<string, string>>({});
  // add-task state per session — { sessionId: draftSubject }
  const [adding, setAdding] = useState<Record<string, string>>({});
  // expanded description state — { taskId: true }
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const tasks = data?.tasks ?? [];
  const summary = data?.summary ?? { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0 };

  const filtered = useMemo(
    () => filter === "all" ? tasks : tasks.filter(t => t.status === filter),
    [tasks, filter],
  );

  // group filtered tasks by sessionId, preserving insertion order
  const groups = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of filtered) {
      if (!map.has(t.sessionId)) map.set(t.sessionId, []);
      map.get(t.sessionId)!.push(t);
    }
    // sort: main first, then alphabetical
    const sorted = [...map.entries()].sort(([a], [b]) => {
      if (a === "main") return -1;
      if (b === "main") return 1;
      return a.localeCompare(b);
    });
    return sorted;
  }, [filtered]);

  const pct = summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0;

  const toggleCollapse = (sid: string) =>
    setCollapsed(prev => ({ ...prev, [sid]: !prev[sid] }));

  // ── Empty state ──
  if (summary.total === 0) {
    return createElement("div", { style: styles.container },
      createElement("div", { style: styles.empty }, "No tasks yet."),
      createElement(AddTaskRow, {
        sessionId: "main",
        draft: adding["main"] ?? "",
        onChange: (v: string) => setAdding(prev => ({ ...prev, main: v })),
        onSubmit: async () => {
          const subject = (adding["main"] ?? "").trim();
          if (!subject) return;
          await apiCreate("main", subject);
          setAdding(prev => ({ ...prev, main: "" }));
        },
      }),
    );
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

    // ── Groups ──
    createElement("div", { style: styles.list },
      groups.map(([sid, sessionTasks]) =>
        createElement(SessionGroup, {
          key: sid,
          sessionId: sid,
          tasks: sessionTasks,
          allTasks: tasks,
          collapsed: !!collapsed[sid],
          onToggleCollapse: () => toggleCollapse(sid),
          editing,
          setEditing,
          adding,
          setAdding,
          expanded,
          setExpanded,
        }),
      ),
    ),
  );
}

// ─── Session group ───────────────────────────────────────────

function SessionGroup({
  sessionId,
  tasks,
  allTasks,
  collapsed,
  onToggleCollapse,
  editing,
  setEditing,
  adding,
  setAdding,
  expanded,
  setExpanded,
}: {
  sessionId: string;
  tasks: Task[];
  allTasks: Task[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  editing: Record<string, string>;
  setEditing: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  adding: Record<string, string>;
  setAdding: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  expanded: Record<string, boolean>;
  setExpanded: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
}) {
  const completedCount = tasks.filter(t => t.status === "completed").length;
  const activeCount = tasks.length - completedCount;
  const label = sessionId === "main" ? "jarvis" : sessionId.replace("actor-", "🤖 ");

  return createElement("div", { style: styles.sessionGroup },
    // ── Header ──
    createElement("div", { style: styles.sessionHeader },
      createElement("button", {
        style: styles.headerToggle,
        onClick: onToggleCollapse,
        title: collapsed ? "Expand" : "Collapse",
      },
        createElement("span", { style: styles.chevron }, collapsed ? "▸" : "▾"),
        createElement("span", { style: styles.sessionLabel }, label),
        createElement("span", { style: styles.sessionCount },
          `${activeCount}/${tasks.length}`,
        ),
      ),
      createElement("div", { style: styles.headerActions },
        // 🧹 Broom — clear completed (only when there are completed tasks)
        completedCount > 0 && createElement("button", {
          style: styles.iconBtn,
          title: `Clear ${completedCount} completed`,
          onClick: async () => { await apiClearSession(sessionId, false); },
        }, "🧹"),
        // 💥 Burst — clear ALL tasks of this session (always visible, with confirm).
        // mix-blend-mode: multiply on the inner span removes the white tile that
        // macOS/iOS emoji fonts paint behind the glyph, blending it into the dark
        // panel background while preserving the orange/red foreground.
        tasks.length > 0 && createElement("button", {
          style: styles.iconBtnDanger,
          title: `Clear ALL ${tasks.length} tasks of "${label}"`,
          onClick: async () => {
            const ok = window.confirm(
              `Clear ALL ${tasks.length} tasks from "${label}"? This cannot be undone.`,
            );
            if (ok) await apiClearSession(sessionId, true);
          },
        }, createElement("span", { style: styles.emojiBlend }, "💥")),
      ),
    ),

    // ── Body ──
    !collapsed && createElement("div", { style: styles.sessionBody },
      tasks.map(t => createElement(TaskRow, {
        key: t.id,
        task: t,
        allTasks,
        descExpanded: !!expanded[t.id],
        onToggleExpand: () => setExpanded(prev => ({ ...prev, [t.id]: !prev[t.id] })),
        editingDraft: editing[t.id],
        onStartEdit: () => setEditing(prev => ({ ...prev, [t.id]: t.subject })),
        onChangeEdit: (v: string) => setEditing(prev => ({ ...prev, [t.id]: v })),
        onCommitEdit: async () => {
          const draft = (editing[t.id] ?? "").trim();
          if (draft && draft !== t.subject) {
            await apiUpdate(t.id, { subject: draft });
          }
          setEditing(prev => {
            const next = { ...prev };
            delete next[t.id];
            return next;
          });
        },
        onCancelEdit: () => setEditing(prev => {
          const next = { ...prev };
          delete next[t.id];
          return next;
        }),
        onDelete: async () => { await apiDelete(t.id); },
        onToggleStatus: async () => {
          // cycle pending → in_progress → completed → pending
          const next: Task["status"] =
            t.status === "pending" ? "in_progress" :
            t.status === "in_progress" ? "completed" :
            t.status === "completed" ? "pending" :
            "pending"; // blocked stays manual
          if (t.status === "blocked") return;
          await apiUpdate(t.id, { status: next });
        },
      })),

      // Inline add row
      createElement(AddTaskRow, {
        sessionId,
        draft: adding[sessionId] ?? "",
        onChange: (v: string) => setAdding(prev => ({ ...prev, [sessionId]: v })),
        onSubmit: async () => {
          const subject = (adding[sessionId] ?? "").trim();
          if (!subject) return;
          await apiCreate(sessionId, subject);
          setAdding(prev => ({ ...prev, [sessionId]: "" }));
        },
      }),
    ),
  );
}

// ─── Task row ─────────────────────────────────────────────────

function DescriptionText({ text }: { text: string }) {
  const urlRegex = /(https?:\/\/[^\s\)]+)/g;
  const parts: (string | ReturnType<typeof createElement>)[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(createElement("a", {
      key: key++,
      href: match[1],
      target: "_blank",
      rel: "noopener noreferrer",
      style: { color: "#818cf8", textDecoration: "underline" },
    }, match[1]));
    last = match.index + match[1].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return createElement("span", null, ...parts);
}

function TaskRow({
  task: t,
  allTasks,
  editingDraft,
  descExpanded,
  onToggleExpand,
  onStartEdit,
  onChangeEdit,
  onCommitEdit,
  onCancelEdit,
  onDelete,
  onToggleStatus,
}: {
  task: Task;
  allTasks: Task[];
  editingDraft: string | undefined;
  descExpanded: boolean;
  onToggleExpand: () => void;
  onStartEdit: () => void;
  onChangeEdit: (v: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onToggleStatus: () => void;
}) {
  const isEditing = editingDraft !== undefined;

  return createElement("div", {
    style: {
      ...styles.taskRow,
      ...(t.status === "in_progress" ? styles.taskRowActive : {}),
      ...(t.status === "completed" ? styles.taskRowCompleted : {}),
    },
  },
    // status icon — clickable to cycle
    createElement("button", {
      style: styles.statusBtn,
      onClick: onToggleStatus,
      title: `Cycle status (current: ${t.status})`,
    }, STATUS_ICON[t.status]),

    // body
    createElement("div", { style: styles.taskBody },
      // subject — click to edit
      isEditing
        ? createElement("input", {
            style: styles.editInput,
            value: editingDraft,
            autoFocus: true,
            onChange: (e: any) => onChangeEdit(e.target.value),
            onBlur: onCommitEdit,
            onKeyDown: (e: any) => {
              if (e.key === "Enter") { e.preventDefault(); onCommitEdit(); }
              else if (e.key === "Escape") { e.preventDefault(); onCancelEdit(); }
            },
          })
        : createElement("div", {
            style: styles.taskSubject,
            onClick: onStartEdit,
            title: "Click to edit",
          },
            createElement("span",
              { style: t.status === "completed" ? styles.subjectCompleted : undefined },
              t.subject,
            ),
            t.priority !== "medium" &&
              createElement("span", {
                style: { ...styles.priorityBadge, color: PRIORITY_COLOR[t.priority] },
              }, t.priority),
          ),

      // description — click to expand/collapse
      t.description && !isEditing &&
        createElement("div", {
          style: descExpanded ? styles.taskDescriptionExpanded : styles.taskDescription,
          onClick: onToggleExpand,
          title: descExpanded ? "Click to collapse" : "Click to expand",
        },
          createElement(DescriptionText, { text: t.description }),
          !descExpanded && createElement("span", { style: styles.descMore }, " ▸"),
        ),

      // blockers
      t.blockedBy.length > 0 &&
        createElement("div", { style: styles.taskMeta },
          createElement("span", { style: styles.blockedTag },
            `blocked by: ${t.blockedBy.map(id => {
              const blocker = allTasks.find(bt => bt.id === id);
              return blocker ? blocker.subject : id;
            }).join(", ")}`,
          ),
        ),
    ),

    // task id + delete
    createElement("div", { style: styles.taskRight },
      createElement("span", { style: styles.taskId }, t.id),
      createElement("button", {
        style: styles.deleteBtn,
        onClick: onDelete,
        title: "Delete task",
      }, "×"),
    ),
  );
}

// ─── Add-task row ─────────────────────────────────────────────

function AddTaskRow({
  sessionId: _sessionId,
  draft,
  onChange,
  onSubmit,
}: {
  sessionId: string;
  draft: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return createElement("div", { style: styles.addRow },
    createElement("span", { style: styles.addPlus }, "+"),
    createElement("input", {
      style: styles.addInput,
      placeholder: "Add a task…",
      value: draft,
      onChange: (e: any) => onChange(e.target.value),
      onKeyDown: (e: any) => {
        if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
      },
    }),
    draft.trim() &&
      createElement("button", {
        style: styles.addSubmitBtn,
        onClick: onSubmit,
        title: "Create task",
      }, "↵"),
  );
}

// ─── Filter chip ──────────────────────────────────────────────

function chipEl(
  value: FilterStatus,
  label: string,
  active: FilterStatus,
  setFilter: (v: FilterStatus) => void,
) {
  const isActive = value === active;
  return createElement("button", {
    key: value,
    style: { ...styles.chip, ...(isActive ? styles.chipActive : {}) },
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
    boxSizing: "border-box" as const,
  },
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "60%",
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
  chips: { display: "flex", gap: "6px", flexWrap: "wrap" },
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
  chipActive: { backgroundColor: "#8b5cf6", borderColor: "#8b5cf6", color: "#fff" },

  // List of session groups
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    overflowY: "auto",
    flex: 1,
  },

  // Session group
  sessionGroup: {
    display: "flex",
    flexDirection: "column",
    border: "1px solid #2a2a2a",
    borderRadius: "6px",
    overflow: "visible",
  },
  sessionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 8px",
    backgroundColor: "#1a1a1a",
  },
  headerToggle: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    background: "transparent",
    border: "none",
    color: "#ddd",
    cursor: "pointer",
    padding: 0,
    fontSize: "12px",
    fontFamily: "inherit",
    flex: 1,
    textAlign: "left",
    outline: "none",
  },
  chevron: { color: "#888", fontSize: "10px", width: "10px" },
  sessionLabel: { fontWeight: 600, color: "#ddd" },
  sessionCount: { color: "#666", fontSize: "11px" },
  headerActions: { display: "flex", gap: "4px" },
  iconBtn: {
    background: "transparent",
    border: "none",
    color: "#888",
    cursor: "pointer",
    fontSize: "12px",
    padding: "2px 4px",
    borderRadius: "4px",
    outline: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "22px",
    height: "22px",
  },
  iconBtnDanger: {
    background: "transparent",
    border: "none",
    color: "#ef4444",
    cursor: "pointer",
    fontSize: "12px",
    padding: "2px 4px",
    borderRadius: "4px",
    outline: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "22px",
    height: "22px",
  },
  // Wrapper used to neutralize the white tile that macOS draws behind some
  // color emoji glyphs (notably 💥). `mix-blend-mode: multiply` lets the dark
  // panel bleed through any white pixels while keeping the orange/red
  // explosion strokes visible.
  emojiBlend: {
    display: "inline-block",
    mixBlendMode: "multiply" as const,
    fontSize: "13px",
    lineHeight: "13px",
  },
  sessionBody: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "4px 4px 6px",
    backgroundColor: "#141414",
  },

  // Task row
  taskRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    padding: "6px 8px",
    borderRadius: "4px",
    backgroundColor: "#1e1e1e",
  },
  taskRowActive: { borderLeft: "2px solid #8b5cf6" },
  taskRowCompleted: { opacity: 0.55 },
  statusBtn: {
    background: "transparent",
    border: "none",
    color: "inherit",
    fontSize: "14px",
    lineHeight: "20px",
    cursor: "pointer",
    padding: 0,
    flexShrink: 0,
    outline: "none",
  },
  taskBody: { flex: 1, minWidth: 0 },
  taskSubject: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    lineHeight: "20px",
    cursor: "text",
  },
  subjectCompleted: { textDecoration: "line-through" },
  priorityBadge: { fontSize: "10px", fontWeight: 600, textTransform: "uppercase" },
  taskDescription: {
    fontSize: "11px",
    color: "#888",
    marginTop: "2px",
    lineHeight: "16px",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    cursor: "pointer",
    userSelect: "none" as const,
  },
  taskDescriptionExpanded: {
    fontSize: "11px",
    color: "#aaa",
    marginTop: "2px",
    lineHeight: "17px",
    whiteSpace: "pre-wrap" as const,
    cursor: "pointer",
    userSelect: "text" as const,
    backgroundColor: "#111",
    borderRadius: "4px",
    padding: "6px 8px",
    border: "1px solid #2a2a2a",
    maxHeight: "240px",
    overflowY: "auto" as const,
  },
  descMore: {
    color: "#555",
    fontSize: "10px",
  },
  descLink: {
    color: "#818cf8",
    textDecoration: "none",
    wordBreak: "break-all" as const,
  },
  taskMeta: { display: "flex", gap: "6px", fontSize: "11px", color: "#666", marginTop: "2px" },
  blockedTag: { color: "#ef4444", fontStyle: "italic" },
  taskRight: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    flexShrink: 0,
  },
  taskId: { fontSize: "10px", color: "#555", lineHeight: "20px" },
  deleteBtn: {
    background: "transparent",
    border: "none",
    color: "#666",
    cursor: "pointer",
    fontSize: "16px",
    lineHeight: "16px",
    width: "20px",
    height: "20px",
    borderRadius: "4px",
    padding: 0,
    outline: "none",
  },
  editInput: {
    width: "100%",
    background: "#0e0e0e",
    border: "1px solid #444",
    borderRadius: "4px",
    color: "#e0e0e0",
    padding: "3px 6px",
    fontSize: "13px",
    fontFamily: "inherit",
    outline: "none",
  },

  // Add row
  addRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 8px",
    marginTop: "2px",
    borderRadius: "4px",
    backgroundColor: "#161616",
    border: "1px dashed #333",
  },
  addPlus: { color: "#8b5cf6", fontWeight: 600, fontSize: "14px" },
  addInput: {
    flex: 1,
    background: "transparent",
    border: "none",
    color: "#e0e0e0",
    fontSize: "12px",
    fontFamily: "inherit",
    outline: "none",
  },
  addSubmitBtn: {
    background: "#8b5cf6",
    border: "none",
    color: "#fff",
    cursor: "pointer",
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    outline: "none",
  },
};
