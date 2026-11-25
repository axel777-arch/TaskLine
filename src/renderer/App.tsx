import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bell, CalendarDays, Check, CheckCheck,
  ChevronDown, ChevronLeft, ChevronRight, Circle, Clock3, Command, GripVertical, ListTodo,
  MoreHorizontal, Pause, Pencil, Plus, Search, Settings2, Sparkles, Target, Trash2,
  TrendingUp, X,
} from "lucide-react";
import type { AppSettings, Priority, ReminderPayload, Task, TaskInput, TaskStats, TaskStatus } from "../shared/types";

type Page = "dashboard" | "calendar" | "tasks" | "statistics" | "settings";
type CalendarView = "month" | "week" | "day";
const priorityOrder: Priority[] = ["low", "normal", "high", "critical"];
const emptyStats: TaskStats = { total: 0, completed: 0, active: 0, overdue: 0, completedToday: 0, completedThisWeek: 0, completionRate: 0, averageCompletionMins: null };
const emptySettings: AppSettings = {
  launchOnStartup: true, startMinimized: false, minimizeToTray: true, hourlyReminders: true,
  interfaceScale: 1.1,
  reminderFrequencyMins: 60, reminderStartHour: 8, reminderEndHour: 21, deadlineReminders: true,
  scheduledReminders: true, overdueReminders: true, dailyPlanning: true, endOfDaySummary: true,
  endOfDayHour: 20,
  automaticPrioritization: true, defaultPriority: "normal", defaultDurationMins: 30,
  quietStartHour: 22, quietEndHour: 7,
};

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function toLocalInput(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${dayKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}
function dateLabel(date: Date, options?: Intl.DateTimeFormatOptions): string {
  return date.toLocaleDateString(undefined, options ?? { weekday: "long", month: "long", day: "numeric" });
}
function statusLabel(status: TaskStatus): string {
  return status === "in_progress" ? "In progress" : status === "postponed" ? "Postponed" : status;
}
function isOverdue(task: Task): boolean {
  return Boolean(task.deadlineAt && task.status !== "completed" && Date.parse(task.deadlineAt) < Date.now());
}

export default function App() {
  const isPopup = new URLSearchParams(window.location.search).has("popup");
  const [page, setPage] = useState<Page>("tasks");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<TaskStats>(emptyStats);
  const [settings, setSettings] = useState<AppSettings>(emptySettings);
  const [busy, setBusy] = useState(false);
  const [modalTask, setModalTask] = useState<Task | null | undefined>(undefined);
  const [draftScheduledAt, setDraftScheduledAt] = useState<string | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [calendarView, setCalendarView] = useState<CalendarView>("month");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [calendarCursor, setCalendarCursor] = useState(() => new Date());
  const [notice, setNotice] = useState("");
  const [reminder, setReminder] = useState<ReminderPayload | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextTasks, nextStats, nextSettings] = await Promise.all([
        window.taskline.listTasks(), window.taskline.getStats(), window.taskline.getSettings(),
      ]);
      setTasks(nextTasks);
      setStats(nextStats);
      setSettings(nextSettings);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load your local task data.");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!isPopup) return;
    document.body.classList.add("popup-body");
    document.documentElement.classList.add("popup-body");
    return () => {
      document.body.classList.remove("popup-body");
      document.documentElement.classList.remove("popup-body");
    };
  }, [isPopup]);
  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    return window.taskline.onReminder(setReminder);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3800);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setModalTask(undefined); setDraftScheduledAt(null); setReminder(null); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setDraftScheduledAt(null);
        setModalTask(null);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPage("tasks");
        window.setTimeout(() => document.getElementById("task-search")?.focus(), 0);
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && ["1", "2", "3"].includes(event.key)) {
        setPage(event.key === "1" ? "dashboard" : event.key === "2" ? "calendar" : "statistics");
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setPage("dashboard");
        window.setTimeout(() => document.getElementById("quick-add")?.focus(), 0);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const activeTasks = useMemo(() => tasks.filter(task => task.status !== "completed"), [tasks]);
  const completedTasks = useMemo(() => tasks.filter(task => task.status === "completed"), [tasks]);
  const approaching = useMemo(() => activeTasks.filter(task => task.deadlineAt &&
    Date.parse(task.deadlineAt) >= Date.now() && Date.parse(task.deadlineAt) < Date.now() + 24 * 60 * 60_000), [activeTasks]);
  const dueToday = useMemo(() => tasks.filter(task =>
    (task.scheduledAt && dayKey(new Date(task.scheduledAt)) === dayKey(new Date())) ||
    (task.deadlineAt && dayKey(new Date(task.deadlineAt)) === dayKey(new Date()))), [tasks]);
  const upcoming = useMemo(() => activeTasks.filter(task => {
    const date = task.scheduledAt ?? task.deadlineAt;
    return date && Date.parse(date) > Date.now() && Date.parse(date) < Date.now() + 7 * 86_400_000;
  }).slice(0, 3), [activeTasks]);

  const updateStatus = async (id: string, status: TaskStatus) => {
    setBusy(true);
    try { await window.taskline.setTaskStatus(id, status); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not update task."); }
    finally { setBusy(false); }
  };
  const saveTask = async (input: TaskInput, task?: Task) => {
    setBusy(true);
    try {
      if (task) await window.taskline.updateTask(task.id, input);
      else await window.taskline.createTask(input);
      setModalTask(undefined);
      setDraftScheduledAt(null);
      setNotice(task ? "Changes saved." : "Task added to your list.");
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save task."); }
    finally { setBusy(false); }
  };
  const deleteTask = async (task: Task) => {
    if (!window.confirm(`Delete “${task.title}”? This cannot be undone.`)) return;
    try { await window.taskline.deleteTask(task.id); setNotice("Task deleted."); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not delete task."); }
  };
  const quickAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!quickTitle.trim()) return;
    await saveTask({ title: quickTitle, priority: settings.defaultPriority, durationMins: settings.defaultDurationMins });
    setQuickTitle("");
  };
  const updateSettings = async (patch: Partial<AppSettings>) => {
    try { setSettings(await window.taskline.updateSettings(patch)); setNotice("Preferences saved."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not save preferences."); }
  };
  const dataAction = async (action: "export" | "import" | "backup" | "restore" | "clear") => {
    try {
      if (action === "clear" && !window.confirm("Delete all tasks and notification history from this device? This cannot be undone.")) return;
      if (action === "restore" && !window.confirm("Replace your current TASKLINE data with the selected backup?")) return;
      if (action === "export") {
        const saved = await window.taskline.exportTasks();
        if (saved) setNotice("Tasks exported.");
      } else if (action === "import") {
        const count = await window.taskline.importTasks();
        if (count) { setNotice(`Imported ${count} task${count === 1 ? "" : "s"}.`); await refresh(); }
      } else if (action === "backup") {
        if (await window.taskline.createBackup()) setNotice("Local backup created.");
      } else if (action === "restore") {
        if (await window.taskline.restoreBackup()) { setNotice("Backup restored."); await refresh(); }
      } else {
        await window.taskline.clearData();
        setNotice("Local task data cleared.");
        await refresh();
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : "The data operation failed."); }
  };
  const postpone = async (task: Task) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const next = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 9);
    try {
      await window.taskline.updateTask(task.id, {
        title: task.title, description: task.description, priority: task.priority,
        deadlineAt: task.deadlineAt, scheduledAt: next.toISOString(), durationMins: task.durationMins,
        category: task.category, reminderAt: task.reminderAt,
      });
      await window.taskline.setTaskStatus(task.id, "postponed");
      setNotice("Moved to tomorrow at 9:00 AM.");
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not reschedule task."); }
  };
  const moveTask = async (id: string, direction: -1 | 1) => {
    const ordered = activeTasks.map(task => task.id);
    const current = ordered.indexOf(id);
    const target = current + direction;
    if (current < 0 || target < 0 || target >= ordered.length) return;
    [ordered[current], ordered[target]] = [ordered[target], ordered[current]];
    try { await window.taskline.reorderTasks(ordered); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not reorder tasks."); }
  };
  const openNewTask = (scheduledAt: string | null = null) => {
    setDraftScheduledAt(scheduledAt);
    setModalTask(null);
  };
  const moveTaskDate = async (task: Task, kind: "scheduled" | "deadline", date: Date) => {
    const source = kind === "scheduled" ? task.scheduledAt : task.deadlineAt;
    const original = source ? new Date(source) : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9);
    original.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
    const scheduledAt = kind === "scheduled" ? original.toISOString() : task.scheduledAt;
    const deadlineAt = kind === "deadline" ? original.toISOString() : task.deadlineAt;
    try {
      await window.taskline.updateTask(task.id, {
        title: task.title, description: task.description, priority: task.priority,
        scheduledAt, deadlineAt, durationMins: task.durationMins, category: task.category,
        recurrence: task.recurrence, reminderAt: task.reminderAt,
      });
      setNotice(kind === "scheduled" ? "Work session moved." : "Deadline moved.");
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not move calendar item."); }
  };

  if (isPopup) {
    return <ReminderCard reminder={reminder} onDismiss={() => window.taskline.dismissWindow()}
      onOpen={() => window.taskline.openMain()} interfaceScale={settings.interfaceScale}
      onSnooze={() => { void window.taskline.snoozeReminder(); window.taskline.dismissWindow(); }} />;
  }

  const pages: { id: Page; label: string; icon: typeof Target; shortcut?: string }[] = [
    { id: "dashboard", label: "Dashboard", icon: Target, shortcut: "1" },
    { id: "calendar", label: "Calendar", icon: CalendarDays, shortcut: "2" },
    { id: "tasks", label: "All tasks", icon: ListTodo },
    { id: "statistics", label: "Statistics", icon: TrendingUp, shortcut: "3" },
  ];
  const pageTitle = { dashboard: "Your focus", calendar: "Calendar", tasks: "All tasks", statistics: "Statistics", settings: "Settings" }[page];

  return (
    <div className="app-shell" style={{ zoom: settings.interfaceScale }}>
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><span /></div><div><strong>TASKLINE</strong><small>PERSONAL WORKSPACE</small></div></div>
        <div className="side-label">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          {pages.map(item => <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => setPage(item.id)}>
            <item.icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.shortcut && <kbd>Ctrl+{item.shortcut}</kbd>}
          </button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-progress">
            <div className="progress-caption"><span>DAILY PROGRESS</span><span>{dueToday.filter(t => t.status === "completed").length}/{dueToday.length || 0}</span></div>
            <div className="progress-track"><span style={{ width: `${dueToday.length ? Math.round(dueToday.filter(t => t.status === "completed").length / dueToday.length * 100) : 0}%` }} /></div>
            <small>{dueToday.length ? `${dueToday.length} item${dueToday.length === 1 ? "" : "s"} on your plate today` : "A clear day ahead"}</small>
          </div>
          <button className={`nav-item ${page === "settings" ? "active" : ""}`} onClick={() => setPage("settings")}><Settings2 size={17} /><span>Settings</span></button>
          <div className="offline-indicator"><span className="status-dot" />Local only <span className="offline-label">· Offline ready</span></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{pageTitle}</strong></div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Search tasks" onClick={() => { setPage("tasks"); window.setTimeout(() => document.getElementById("task-search")?.focus(), 0); }}><Search size={17} /></button>
            <span className="top-divider" />
            <button className="date-chip" onClick={() => { setPage("calendar"); setSelectedDate(new Date()); setCalendarCursor(new Date()); }}><CalendarDays size={15} />{dateLabel(new Date(), { month: "short", day: "numeric" })}</button>
            <button className="avatar" aria-label="Local profile">T</button>
          </div>
        </header>

        <div className="page-scroll">
          {page === "dashboard" && <Dashboard
            activeTasks={activeTasks} completedTasks={completedTasks} approaching={approaching} dueToday={dueToday}
            upcoming={upcoming}
            quickTitle={quickTitle} setQuickTitle={setQuickTitle} quickAdd={quickAdd} busy={busy}
            onStatus={updateStatus} onEdit={task => setModalTask(task)} onDelete={deleteTask}
            onMove={moveTask}
            onPostpone={postpone} onCalendar={() => setPage("calendar")} onCreate={() => openNewTask()}
            onOpenTasks={() => setPage("tasks")} />}
          {page === "calendar" && <CalendarPage
            tasks={tasks} view={calendarView} setView={setCalendarView} cursor={calendarCursor}
            setCursor={setCalendarCursor} selected={selectedDate} setSelected={setSelectedDate}
            onCreate={() => {
              const date = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 9);
              openNewTask(date.toISOString());
            }} onEdit={task => setModalTask(task)} onMoveDate={moveTaskDate} />}
          {page === "tasks" && <AllTasks tasks={tasks} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter}
            onCreate={() => openNewTask()} onEdit={task => setModalTask(task)} onStatus={updateStatus} onDelete={deleteTask} />}
          {page === "statistics" && <Statistics stats={stats} />}
          {page === "settings" && <SettingsPage settings={settings} onChange={updateSettings} onDataAction={dataAction} />}
        </div>
      </main>

      {modalTask !== undefined && <TaskModal task={modalTask ?? undefined} defaultPriority={settings.defaultPriority}
        defaultDuration={settings.defaultDurationMins} defaultScheduledAt={draftScheduledAt}
        onClose={() => { setModalTask(undefined); setDraftScheduledAt(null); }} onSave={input => saveTask(input, modalTask ?? undefined)} busy={busy} />}
      {notice && <div className="toast"><Check size={15} />{notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}
    </div>
  );
}

function Dashboard(props: {
  activeTasks: Task[]; completedTasks: Task[]; approaching: Task[]; dueToday: Task[]; upcoming: Task[];
  quickTitle: string; setQuickTitle: (value: string) => void; quickAdd: (event: React.FormEvent) => void;
  busy: boolean; onStatus: (id: string, status: TaskStatus) => void; onEdit: (task: Task) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDelete: (task: Task) => void; onPostpone: (task: Task) => void; onCalendar: () => void;
  onCreate: () => void; onOpenTasks: () => void;
}) {
  const topTask = props.activeTasks[0];
  const activeDueToday = props.dueToday.filter(task => task.status !== "completed");
  return <section className="dashboard-page">
    <div className="welcome-row">
      <div><div className="eyebrow">{dateLabel(new Date(), { weekday: "long", month: "long", day: "numeric" }).toUpperCase()}</div>
        <h1>Make today <span>count.</span></h1><p>A clear next step is all you need to get moving.</p></div>
      <button className="primary-button" onClick={props.onCreate}><Plus size={17} />New task <kbd>Ctrl+N</kbd></button>
    </div>
    <div className="summary-grid">
      <SummaryCard icon={ListTodo} label="ACTIVE TASKS" value={props.activeTasks.length} detail="across your list" />
      <SummaryCard icon={CheckCheck} label="COMPLETED" value={props.completedTasks.length} detail="kept for your record" />
      <SummaryCard icon={Bell} label="DUE SOON" value={props.approaching.length} detail="within the next 24 hours" />
      <SummaryCard icon={Clock3} label="TODAY" value={props.dueToday.length} detail="scheduled or due today" />
    </div>
    <div className="dashboard-columns">
      <div className="focus-column">
        <div className="section-heading">
          <div><div className="eyebrow">YOUR PRIORITIES</div><h2>Next up</h2></div>
          <button className="text-button" onClick={props.onOpenTasks}>View all <ArrowRight size={14} /></button>
        </div>
        <form className="quick-add" onSubmit={props.quickAdd}>
          <Plus size={18} /><input id="quick-add" value={props.quickTitle} onChange={event => props.setQuickTitle(event.target.value)} placeholder="Add a task to your list…" aria-label="Quick add task" />
          <kbd>↵</kbd><button className="quick-submit" type="submit" disabled={!props.quickTitle.trim() || props.busy}>Add task</button>
        </form>
        {props.activeTasks.length ? <div className="task-list">
          {props.activeTasks.map((task, index) => <TaskCard key={task.id} task={task} index={index} onStatus={props.onStatus} onEdit={props.onEdit} onDelete={props.onDelete} onPostpone={props.onPostpone} onMove={props.onMove} />)}
        </div> : <EmptyState onCreate={props.onCreate} />}
        <section className="completed-task-section">
          <div className="completed-section-heading"><div><div className="eyebrow">DONE FOR NOW</div><h2>Completed</h2></div><span>{props.completedTasks.length}</span></div>
          {props.completedTasks.length ? <div className="completed-task-list">{props.completedTasks.map(task =>
            <CompletedTaskRow key={task.id} task={task} onStatus={props.onStatus} onEdit={props.onEdit} onDelete={props.onDelete} />
          )}</div> : <div className="completed-section-empty">Completed tasks will appear here. Click their circle to move them back to your priorities.</div>}
        </section>
      </div>
      <aside className="right-rail">
        <div className="rail-card featured-card">
          <div className="rail-card-header"><span className="icon-tile"><Sparkles size={16} /></span><span>RECOMMENDED NEXT</span><span className="priority-pill">{topTask?.priority ?? "—"}</span></div>
          {topTask ? <><h3>{topTask.title}</h3><p>{topTask.description || "A good place to focus your attention next."}</p>
            <div className="recommend-meta"><Clock3 size={14} /><span>{topTask.durationMins} min</span>{topTask.deadlineAt && <><span className="meta-separator">·</span><span>Due {dateLabel(new Date(topTask.deadlineAt), { month: "short", day: "numeric" })}</span></>}</div>
            <button className="outline-button" onClick={() => props.onStatus(topTask.id, "in_progress")}><ArrowRight size={15} />Start working</button>
          </> : <><h3>You’re all caught up.</h3><p>Add a task whenever there’s something you want to make room for.</p></>}
        </div>
        <div className="rail-card agenda-card">
          <div className="agenda-heading"><div><div className="eyebrow">A LITTLE STRUCTURE</div><h3>Today’s agenda</h3></div><button className="icon-button small" onClick={props.onCalendar} aria-label="Open calendar"><ArrowRight size={15} /></button></div>
          {activeDueToday.length ? activeDueToday.slice(0, 4).map(task => <button key={task.id} className="agenda-item" onClick={() => props.onEdit(task)}>
            <span className="agenda-time">{task.scheduledAt ? new Date(task.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "DUE"}</span>
            <span className="agenda-text">{task.title}<small>{task.durationMins} min {task.deadlineAt && task.scheduledAt ? "· deadline set" : ""}</small></span><ChevronRight size={14} />
          </button>) : <div className="agenda-empty">Nothing scheduled today. Keep a little space for yourself.</div>}
          <button className="agenda-footer" onClick={props.onCalendar}>Open calendar <ArrowRight size={14} /></button>
        </div>
        <div className="rail-card upcoming-card">
          <div className="eyebrow">ON THE HORIZON</div><h3>Coming up</h3>
          {props.upcoming.length ? props.upcoming.map(task => <button key={task.id} className="upcoming-item" onClick={() => props.onEdit(task)}>
            <span className="upcoming-date">{dateLabel(new Date(task.scheduledAt ?? task.deadlineAt!), { weekday: "short", day: "numeric" })}</span><span>{task.title}<small>{task.scheduledAt ? "Planned work" : "Deadline"}</small></span><ChevronRight size={14} />
          </button>) : <p className="agenda-empty">No upcoming dates in the next week.</p>}
        </div>
        <div className="focus-note"><span className="note-line" /><p>Progress isn’t always loud. Keep showing up, one task at a time.</p></div>
      </aside>
    </div>
  </section>;
}

function SummaryCard({ icon: Icon, label, value, detail }: { icon: typeof Target; label: string; value: number; detail: string }) {
  return <div className="summary-card"><div className="summary-top"><span className="summary-icon"><Icon size={16} /></span><span>{label}</span><MoreHorizontal size={17} className="summary-more" /></div><strong>{value}</strong><small>{detail}</small></div>;
}

function TaskCard({ task, index, onStatus, onEdit, onDelete, onPostpone, onMove }: {
  task: Task; index: number; onStatus: (id: string, status: TaskStatus) => void;
  onEdit: (task: Task) => void; onDelete: (task: Task) => void; onPostpone: (task: Task) => void;
  onMove?: (id: string, direction: -1 | 1) => void;
}) {
  const [menu, setMenu] = useState(false);
  const overdue = isOverdue(task);
  return <article className={`task-card ${overdue ? "is-overdue" : ""} ${task.status === "in_progress" ? "is-active" : ""}`}>
    <button className="complete-toggle" aria-label={task.completedToday ? "Already completed today; available tomorrow" : "Mark complete"} title={task.completedToday ? "Already completed today; available tomorrow" : "Mark complete"} disabled={task.completedToday} onClick={() => onStatus(task.id, "completed")}><Circle size={19} /></button>
    <div className="task-main">
      <div className="task-title-row"><button className="task-title" onClick={() => onEdit(task)}>{task.title}</button><span className={`status-tag ${task.status}`}>{task.completedToday ? "Done today" : overdue ? "Overdue" : statusLabel(task.status)}</span></div>
      {task.description && <p className="task-description">{task.description}</p>}
      <div className="task-meta">
        <span className={`priority-dot ${task.priority}`} /><span className="priority-label">{task.priority}</span>
        {task.deadlineAt && <span className={overdue ? "meta-overdue" : ""}><Clock3 size={13} />{overdue ? "Overdue" : "Due"} {dateLabel(new Date(task.deadlineAt), { month: "short", day: "numeric" })}</span>}
        {task.scheduledAt && <span><CalendarDays size={13} />{dateLabel(new Date(task.scheduledAt), { month: "short", day: "numeric" })} · {new Date(task.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
        <span><Clock3 size={13} />{task.durationMins}m</span>
        {task.category && <span className="category-tag">{task.category}</span>}
      </div>
    </div>
    <div className="task-actions">
      {onMove && <div className="order-actions"><button title="Move up" aria-label="Move task up" disabled={index === 0} onClick={() => onMove(task.id, -1)}><ArrowUp size={12} /></button><button title="Move down" aria-label="Move task down" onClick={() => onMove(task.id, 1)}><ArrowDown size={12} /></button></div>}
      {task.status !== "in_progress" && <button className="start-icon" title="Start task" aria-label="Start task" onClick={() => onStatus(task.id, "in_progress")}><ArrowRight size={16} /></button>}
      <div className="task-menu-wrap"><button className="icon-button small" aria-label="More task actions" onClick={() => setMenu(!menu)}><MoreHorizontal size={17} /></button>
        {menu && <><button className="menu-dismiss" onClick={() => setMenu(false)} aria-label="Close menu" /><div className="task-menu">
          <button onClick={() => { onEdit(task); setMenu(false); }}><Pencil size={14} />Edit task</button>
          <button onClick={() => { onPostpone(task); setMenu(false); }}><ArrowRight size={14} />Move to tomorrow</button>
          <button onClick={() => { onDelete(task); setMenu(false); }} className="delete-action"><Trash2 size={14} />Delete task</button>
        </div></>}
      </div>
    </div>
  </article>;
}

function CompletedTaskRow({ task, onStatus, onEdit, onDelete }: {
  task: Task; onStatus: (id: string, status: TaskStatus) => void;
  onEdit: (task: Task) => void; onDelete: (task: Task) => void;
}) {
  return <article className="completed-task-row">
    <button className="completed-check" onClick={() => onStatus(task.id, "pending")} aria-label="Move task back to active" title="Move back to active"><Check size={14} /></button>
    <button className="completed-task-title" onClick={() => onEdit(task)}>{task.title}</button>
    <span className="completed-task-date">Completed {task.completedAt ? dateLabel(new Date(task.completedAt), { month: "short", day: "numeric" }) : "today"}</span>
    <button className="icon-button small" onClick={() => onEdit(task)} aria-label="Edit task"><Pencil size={14} /></button>
    <button className="icon-button small" onClick={() => onDelete(task)} aria-label="Delete task"><Trash2 size={14} /></button>
  </article>;
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return <div className="empty-state"><div className="empty-mark"><Target size={23} /></div><h3>A little room to begin.</h3><p>Your task list is clear. Add one thing you’d like to move forward today.</p><button className="outline-button" onClick={onCreate}><Plus size={15} />Create your first task</button></div>;
}

function CalendarPage({ tasks, view, setView, cursor, setCursor, selected, setSelected, onCreate, onEdit, onMoveDate }: {
  tasks: Task[]; view: CalendarView; setView: (view: CalendarView) => void;
  cursor: Date; setCursor: (date: Date) => void; selected: Date; setSelected: (date: Date) => void;
  onCreate: () => void; onEdit: (task: Task) => void;
  onMoveDate: (task: Task, kind: "scheduled" | "deadline", date: Date) => void;
}) {
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(1 - ((monthStart.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
  const shiftCursor = (amount: number) => {
    const next = new Date(cursor);
    if (view === "month") next.setMonth(next.getMonth() + amount);
    else if (view === "week") next.setDate(next.getDate() + amount * 7);
    else next.setDate(next.getDate() + amount);
    setCursor(next);
  };
  const eventsForDay = (date: Date) => tasks.flatMap(task => {
    const entries: { task: Task; kind: "scheduled" | "deadline" }[] = [];
    if (task.scheduledAt && dayKey(new Date(task.scheduledAt)) === dayKey(date)) entries.push({ task, kind: "scheduled" });
    if (task.deadlineAt && dayKey(new Date(task.deadlineAt)) === dayKey(date)) entries.push({ task, kind: "deadline" });
    return entries;
  });
  const selectedTasks = eventsForDay(selected);
  const unscheduled = tasks.filter(task => task.status !== "completed" && !task.scheduledAt && !task.deadlineAt);
  const agendaStart = new Date();
  agendaStart.setHours(0, 0, 0, 0);
  const agendaEnd = new Date(agendaStart);
  agendaEnd.setDate(agendaEnd.getDate() + 30);
  const agendaEntries = tasks
    .filter(task => task.status !== "completed")
    .flatMap(task => [
      ...(task.scheduledAt ? [{ task, kind: "scheduled" as const, at: new Date(task.scheduledAt) }] : []),
      ...(task.deadlineAt ? [{ task, kind: "deadline" as const, at: new Date(task.deadlineAt) }] : []),
    ])
    .filter(entry => entry.at >= agendaStart && entry.at < agendaEnd);
  const agendaGroups = Array.from(agendaEntries.reduce((groups, entry) => {
    const key = dayKey(entry.at);
    const group = groups.get(key) ?? { date: new Date(entry.at.getFullYear(), entry.at.getMonth(), entry.at.getDate()), entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
    return groups;
  }, new Map<string, { date: Date; entries: typeof agendaEntries }>()).values())
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  agendaGroups.forEach(group => group.entries.sort((a, b) => a.at.getTime() - b.at.getTime()));
  const visibleDays = view === "month" ? days : [selected];
  const label = view === "month" ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : view === "day" ? dateLabel(selected)
      : `Week of ${dateLabel(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - ((cursor.getDay() + 6) % 7)), { month: "short", day: "numeric" })}`;
  const daysToRender = view === "week"
    ? Array.from({ length: 7 }, (_, i) => { const date = new Date(cursor); date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + i); return date; })
    : visibleDays;
  return <section className="content-page calendar-page">
    <div className="page-heading"><div><div className="eyebrow">PLAN YOUR TIME</div><h1>Calendar</h1><p>Deadlines and planned work, in one place.</p></div><button className="primary-button" onClick={onCreate}><Plus size={16} />New task</button></div>
    <div className="calendar-toolbar">
      <div className="calendar-nav"><button className="icon-button" onClick={() => shiftCursor(-1)} aria-label="Previous period"><ChevronLeft size={17} /></button><button className="today-button" onClick={() => { setCursor(new Date()); setSelected(new Date()); }}>Today</button><button className="icon-button" onClick={() => shiftCursor(1)} aria-label="Next period"><ChevronRight size={17} /></button><strong>{label}</strong></div>
      <div className="segmented-control">{(["month", "week", "day"] as const).map(item => <button key={item} className={view === item ? "selected" : ""} onClick={() => setView(item)}>{item}</button>)}</div>
    </div>
    {view !== "day" ? <div className={`calendar-grid ${view === "week" ? "week-view" : ""}`}>
      {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map(day => <div key={day} className="weekday-cell">{day}</div>)}
      {daysToRender.map(date => <button key={dayKey(date)} className={`day-cell ${date.getMonth() !== cursor.getMonth() && view === "month" ? "outside" : ""} ${dayKey(date) === dayKey(selected) ? "selected" : ""} ${dayKey(date) === dayKey(new Date()) ? "today" : ""}`} onClick={() => { setSelected(date); if (view === "month" && date.getMonth() !== cursor.getMonth()) setCursor(date); }} onDragOver={event => event.preventDefault()} onDrop={event => {
        event.preventDefault();
        const [taskId, kind] = (event.dataTransfer.getData("text/plain") || "").split("|");
        const task = tasks.find(item => item.id === taskId);
        if (task && (kind === "scheduled" || kind === "deadline")) onMoveDate(task, kind, date);
      }}>
        <span className="day-number">{date.getDate()}</span>
        {eventsForDay(date).slice(0, view === "month" ? 2 : 5).map(({ task, kind }) => <span key={`${task.id}:${kind}`} draggable onDragStart={event => event.dataTransfer.setData("text/plain", `${task.id}|${kind}`)} className={`calendar-event ${kind === "deadline" ? "deadline-event" : ""}`} onClick={event => { event.stopPropagation(); onEdit(task); }}>
          {kind === "scheduled" ? <small>{new Date(task.scheduledAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small> : <small>DUE · </small>}{task.title}
        </span>)}
        {eventsForDay(date).length > (view === "month" ? 2 : 5) && <span className="more-events">+{eventsForDay(date).length - (view === "month" ? 2 : 5)} more</span>}
      </button>)}
    </div> : <div className="day-agenda">
      <div className="day-agenda-header"><div className="day-big">{String(selected.getDate()).padStart(2, "0")}</div><div><strong>{dateLabel(selected, { weekday: "long" })}</strong><span>{dateLabel(selected, { month: "long", year: "numeric" })}</span></div><button className="text-button" onClick={onCreate}><Plus size={15} />Add to day</button></div>
      {selectedTasks.length ? selectedTasks.sort((a, b) => (a.kind === "scheduled" ? a.task.scheduledAt ?? "" : a.task.deadlineAt ?? "").localeCompare(b.kind === "scheduled" ? b.task.scheduledAt ?? "" : b.task.deadlineAt ?? "")).map(({ task, kind }) => <button className="day-task-row" key={`${task.id}:${kind}`} onClick={() => onEdit(task)}><span className="day-task-time">{kind === "scheduled" ? new Date(task.scheduledAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "DEADLINE"}</span><span className="day-task-marker" /><span className="day-task-name">{task.title}<small>{kind === "scheduled" ? `${task.durationMins} min planned` : "Task deadline"}</small></span><ArrowRight size={15} /></button>) : <div className="agenda-empty">No tasks scheduled for this date.</div>}
    </div>}
    <div className="calendar-bottom">
      <div><span className="legend-dot scheduled-dot" />Scheduled work</div><div><span className="legend-dot deadline-dot" />Deadline</div>
      {unscheduled.length > 0 && <div className="unscheduled-box"><div className="eyebrow">UNSCHEDULED <span>{unscheduled.length}</span></div>{unscheduled.slice(0, 5).map(task => <button key={task.id} onClick={() => onEdit(task)}>{task.title}<Pencil size={13} /></button>)}</div>}
    </div>
    <section className="calendar-agenda">
      <div className="calendar-agenda-heading"><div><div className="eyebrow">THE NEXT 30 DAYS</div><h2>Agenda</h2></div><span>{agendaEntries.length} item{agendaEntries.length === 1 ? "" : "s"}</span></div>
      {agendaGroups.length ? <div className="calendar-agenda-list">{agendaGroups.map(group => <div className="calendar-agenda-day" key={dayKey(group.date)}>
        <button className="calendar-agenda-date" onClick={() => { setSelected(group.date); setCursor(group.date); }} aria-label={`Show ${dateLabel(group.date)} in calendar`}>
          <strong>{dateLabel(group.date, { month: "short", day: "numeric" })}</strong><span>{dateLabel(group.date, { weekday: "long" })}</span>
        </button>
        <div className="calendar-agenda-events">{group.entries.map(({ task, kind, at }) => <button className="calendar-agenda-event" key={`${task.id}:${kind}`} onClick={() => onEdit(task)}>
          <span className="calendar-agenda-time">{kind === "scheduled" ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "DEADLINE"}</span>
          <span className="calendar-agenda-task">{task.title}<small>{kind === "scheduled" ? `Scheduled work · ${task.durationMins} min` : "Task deadline"}</small></span><ChevronRight size={15} />
        </button>)}</div>
      </div>)}</div> : <div className="calendar-agenda-empty">No scheduled tasks or deadlines in the next 30 days.</div>}
    </section>
  </section>;
}

function AllTasks({ tasks, search, setSearch, filter, setFilter, onCreate, onEdit, onStatus, onDelete }: {
  tasks: Task[]; search: string; setSearch: (value: string) => void; filter: string;
  setFilter: (value: string) => void; onCreate: () => void; onEdit: (task: Task) => void;
  onStatus: (id: string, status: TaskStatus) => void; onDelete: (task: Task) => void;
}) {
  const filtered = tasks.filter(task => {
    const matchesText = `${task.title} ${task.description} ${task.category}`.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "all" || (filter === "active" && task.status !== "completed") ||
      (filter === "completed" && task.status === "completed") || (filter === "overdue" && isOverdue(task)) ||
      (filter === "today" && ((task.scheduledAt && dayKey(new Date(task.scheduledAt)) === dayKey(new Date())) ||
        (task.deadlineAt && dayKey(new Date(task.deadlineAt)) === dayKey(new Date()))));
    return matchesText && matchesFilter;
  });
  const activeFiltered = filtered.filter(task => task.status !== "completed");
  const completedFiltered = filtered.filter(task => task.status === "completed");
  return <section className="content-page">
    <div className="page-heading"><div><div className="eyebrow">YOUR TASK LIBRARY</div><h1>All tasks</h1><p>Every commitment, kept in view.</p></div><button className="primary-button" onClick={onCreate}><Plus size={16} />New task</button></div>
    <div className="task-filters"><label className="search-field"><Search size={16} /><input id="task-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search title, details, or category…" /><kbd>Ctrl+K</kbd></label>
      <div className="filter-tabs">{[["all", "All"], ["active", "Active"], ["today", "Today"], ["overdue", "Overdue"], ["completed", "Completed"]].map(([key, label]) => <button key={key} className={filter === key ? "selected" : ""} onClick={() => setFilter(key)}>{label}</button>)}</div>
    </div>
    <div className="all-task-list">{filtered.length ? <>
      {filter !== "completed" && <section className="task-list-section">
        <div className="task-list-section-heading"><h2>Active</h2><span>{activeFiltered.length}</span></div>
        {activeFiltered.length ? <div className="task-list">{activeFiltered.map((task, index) =>
          <TaskCard key={task.id} task={task} index={index} onStatus={onStatus} onEdit={onEdit} onDelete={onDelete} onPostpone={task => onStatus(task.id, "postponed")} />
        )}</div> : <div className="completed-section-empty">No active tasks match this view.</div>}
      </section>}
      {filter !== "active" && <section className="task-list-section">
        <div className="task-list-section-heading"><h2>Completed</h2><span>{completedFiltered.length}</span></div>
        {completedFiltered.length ? <div className="completed-task-list">{completedFiltered.map(task =>
          <CompletedTaskRow key={task.id} task={task} onStatus={onStatus} onEdit={onEdit} onDelete={onDelete} />
        )}</div> : <div className="completed-section-empty">Completed tasks will appear here. Click their circle to move them back to active.</div>}
      </section>}
    </> : <div className="empty-state compact"><div className="empty-mark"><Search size={20} /></div><h3>No matching tasks.</h3><p>Try a different search or filter, or add a new task.</p><button className="outline-button" onClick={onCreate}><Plus size={15} />Add a task</button></div>}</div>
  </section>;
}

function Statistics({ stats }: { stats: TaskStats }) {
  return <section className="content-page stats-page">
    <div className="page-heading"><div><div className="eyebrow">A MOMENT TO REFLECT</div><h1>Statistics</h1><p>Small signals of the work you’ve put in.</p></div><div className="stats-date"><CalendarDays size={15} />Since you started</div></div>
    <div className="stats-grid">
      <StatCard label="TASKS CREATED" value={stats.total} detail="Across your workspace" icon={ListTodo} />
      <StatCard label="TASKS COMPLETED" value={stats.completed} detail={`${stats.completedToday} completed today`} icon={CheckCheck} />
      <StatCard label="COMPLETION RATE" value={`${stats.completionRate}%`} detail="Of all created tasks" icon={TrendingUp} />
      <StatCard label="COMPLETED THIS WEEK" value={stats.completedThisWeek} detail="A steady week of progress" icon={Target} />
      <StatCard label="OVERDUE TASKS" value={stats.overdue} detail={stats.overdue ? "Worth a quick review" : "Nothing past its deadline"} icon={Clock3} />
      <StatCard label="AVG. TIME TO COMPLETE" value={stats.averageCompletionMins === null ? "—" : stats.averageCompletionMins >= 60 ? `${Math.floor(stats.averageCompletionMins / 60)}h ${stats.averageCompletionMins % 60}m` : `${stats.averageCompletionMins}m`} detail={stats.averageCompletionMins === null ? "Start tasks to track your pace" : "Based on tasks with a start time"} icon={TrendingUp} />
    </div>
    <div className="stats-note"><Sparkles size={16} /><div><strong>Consistency over intensity.</strong><p>These numbers are just a reflection of your own work. Keep building a pace that feels sustainable.</p></div></div>
  </section>;
}

function StatCard({ label, value, detail, icon: Icon }: { label: string; value: number | string; detail: string; icon: typeof Target }) {
  return <div className="stat-card"><div className="stat-card-top"><span>{label}</span><Icon size={16} /></div><strong>{value}</strong><small>{detail}</small></div>;
}

function SettingsPage({ settings, onChange, onDataAction }: {
  settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void;
  onDataAction: (action: "export" | "import" | "backup" | "restore" | "clear") => void;
}) {
  return <section className="content-page settings-page">
    <div className="page-heading"><div><div className="eyebrow">MAKE TASKLINE YOURS</div><h1>Settings</h1><p>Your preferences stay on this device.</p></div></div>
    <div className="settings-layout">
      <div className="settings-section"><div className="settings-section-title"><div className="settings-icon"><Settings2 size={17} /></div><div><h2>General</h2><p>How TASKLINE runs on your desktop.</p></div></div>
        <SettingRow title="Launch when I sign in" description="Open TASKLINE when Windows starts."><Toggle checked={settings.launchOnStartup} onChange={value => onChange({ launchOnStartup: value })} /></SettingRow>
        <SettingRow title="Start minimized" description="Keep the main window out of the way when launched."><Toggle checked={settings.startMinimized} onChange={value => onChange({ startMinimized: value })} /></SettingRow>
        <SettingRow title="Close to system tray" description="Closing the window keeps reminders running in the background."><Toggle checked={settings.minimizeToTray} onChange={value => onChange({ minimizeToTray: value })} /></SettingRow>
        <SettingRow title="Interface size" description="Adjust text and controls across TASKLINE."><div className="scale-control"><input type="range" min="0.9" max="1.3" step="0.05" value={settings.interfaceScale} aria-label="Interface size" onChange={event => onChange({ interfaceScale: Number(event.target.value) })} /><output>{Math.round(settings.interfaceScale * 100)}%</output></div></SettingRow>
        <SettingRow title="Automatic prioritization" description="Order active tasks by deadline, schedule, and priority."><Toggle checked={settings.automaticPrioritization} onChange={value => onChange({ automaticPrioritization: value })} /></SettingRow>
        <SettingRow title="Default task priority" description="Applied to tasks you add with quick-add."><select value={settings.defaultPriority} onChange={event => onChange({ defaultPriority: event.target.value as Priority })}>{priorityOrder.map(priority => <option key={priority} value={priority}>{priority}</option>)}</select></SettingRow>
        <SettingRow title="Default task duration" description="A starting estimate for quick-added tasks."><select value={settings.defaultDurationMins} onChange={event => onChange({ defaultDurationMins: Number(event.target.value) })}>{[15, 30, 45, 60, 90, 120].map(value => <option key={value} value={value}>{value} minutes</option>)}</select></SettingRow>
      </div>
      <div className="settings-section"><div className="settings-section-title"><div className="settings-icon"><Bell size={17} /></div><div><h2>Reminders</h2><p>Useful nudges, never noise.</p></div></div>
        <SettingRow title="Hourly focus reminder" description="A gentle prompt with your current highest-priority task."><Toggle checked={settings.hourlyReminders} onChange={value => onChange({ hourlyReminders: value })} /></SettingRow>
        <SettingRow title="Reminder frequency" description="How often the focus reminder appears."><select value={settings.reminderFrequencyMins} onChange={event => onChange({ reminderFrequencyMins: Number(event.target.value) })}>{[30, 60, 90, 120].map(value => <option key={value} value={value}>{value === 60 ? "Every hour" : `Every ${value} minutes`}</option>)}</select></SettingRow>
        <SettingRow title="Active reminder hours" description="Hourly nudges are only shown during this window."><div className="hour-range"><select value={settings.reminderStartHour} onChange={event => onChange({ reminderStartHour: Number(event.target.value) })}>{Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}</select><span>to</span><select value={settings.reminderEndHour} onChange={event => onChange({ reminderEndHour: Number(event.target.value) })}>{Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}</select></div></SettingRow>
        <SettingRow title="Upcoming deadline reminders" description="Prioritized alerts as a due time approaches."><Toggle checked={settings.deadlineReminders} onChange={value => onChange({ deadlineReminders: value })} /></SettingRow>
        <SettingRow title="Scheduled task reminders" description="A heads-up before a planned work session."><Toggle checked={settings.scheduledReminders} onChange={value => onChange({ scheduledReminders: value })} /></SettingRow>
        <SettingRow title="Overdue reminders" description="A daily nudge if an unfinished task passes its deadline."><Toggle checked={settings.overdueReminders} onChange={value => onChange({ overdueReminders: value })} /></SettingRow>
        <SettingRow title="Daily planning reminder" description="A brief overview when you start your day."><Toggle checked={settings.dailyPlanning} onChange={value => onChange({ dailyPlanning: value })} /></SettingRow>
        <SettingRow title="End-of-day summary" description="A quiet look at what’s done and what’s next."><Toggle checked={settings.endOfDaySummary} onChange={value => onChange({ endOfDaySummary: value })} /></SettingRow>
        <SettingRow title="End-of-day summary time" description="When TASKLINE sends your daily wrap-up."><select value={settings.endOfDayHour} onChange={event => onChange({ endOfDayHour: Number(event.target.value) })}>{Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}</select></SettingRow>
        <SettingRow title="Quiet hours" description="Suppress scheduled notifications during these hours."><div className="hour-range"><select value={settings.quietStartHour} onChange={event => onChange({ quietStartHour: Number(event.target.value) })}>{Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}</select><span>to</span><select value={settings.quietEndHour} onChange={event => onChange({ quietEndHour: Number(event.target.value) })}>{Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}</select></div></SettingRow>
      </div>
      <div className="settings-section"><div className="settings-section-title"><div className="settings-icon"><ListTodo size={17} /></div><div><h2>Local data</h2><p>Move or safeguard your task list. Everything stays on this device.</p></div></div>
        <div className="data-actions"><button onClick={() => onDataAction("export")}>Export tasks <ArrowDown size={14} /></button><button onClick={() => onDataAction("import")}>Import tasks <ArrowUp size={14} /></button><button onClick={() => onDataAction("backup")}>Create backup <CheckCheck size={14} /></button><button onClick={() => onDataAction("restore")}>Restore backup <ArrowRight size={14} /></button><button className="danger-outline" onClick={() => onDataAction("clear")}>Clear task data <Trash2 size={14} /></button></div>
      </div>
      <div className="settings-footer"><span>Stored locally in your Windows app data. No account or network required.</span><span className="shortcut-hint"><Command size={13} /> Ctrl+N new task · Ctrl+K search · Esc close</span></div>
    </div>
  </section>;
}

function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="setting-row"><div><strong>{title}</strong><span>{description}</span></div>{children}</div>;
}
function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return <button role="switch" aria-checked={checked} className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><span /></button>;
}

function TaskModal({ task, defaultPriority, defaultDuration, defaultScheduledAt, onClose, onSave, busy }: {
  task?: Task; defaultPriority: Priority; defaultDuration: number; defaultScheduledAt: string | null; onClose: () => void;
  onSave: (input: TaskInput) => void; busy: boolean;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? defaultPriority);
  const [deadline, setDeadline] = useState(toLocalInput(task?.deadlineAt));
  const [scheduled, setScheduled] = useState(toLocalInput(task?.scheduledAt ?? defaultScheduledAt));
  const [duration, setDuration] = useState(task?.durationMins ?? defaultDuration);
  const [category, setCategory] = useState(task?.category ?? "");
  const [reminder, setReminder] = useState(toLocalInput(task?.reminderAt));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onSave({ title, description, priority, deadlineAt: fromLocalInput(deadline), scheduledAt: fromLocalInput(scheduled), durationMins: duration, category, recurrence: "none", recurrenceIntervalDays: 1, reminderAt: fromLocalInput(reminder) });
  };
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="task-modal" onSubmit={submit}>
      <div className="modal-head"><div><div className="eyebrow">{task ? "REFINE THE DETAILS" : "A NEW COMMITMENT"}</div><h2>{task ? "Edit task" : "Create a task"}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></div>
      <label className="form-field full"><span>Task title <b>*</b></span><input autoFocus maxLength={200} required value={title} onChange={event => setTitle(event.target.value)} placeholder="What needs your attention?" /></label>
      <label className="form-field full"><span>Description <small>OPTIONAL</small></span><textarea rows={3} maxLength={5000} value={description} onChange={event => setDescription(event.target.value)} placeholder="Add a little context for later…" /></label>
      <div className="form-grid">
        <label className="form-field"><span>Priority</span><select value={priority} onChange={event => setPriority(event.target.value as Priority)}>{priorityOrder.map(item => <option value={item} key={item}>{item}</option>)}</select></label>
        <label className="form-field"><span>Estimated time</span><select value={duration} onChange={event => setDuration(Number(event.target.value))}>{[15, 30, 45, 60, 90, 120, 180, 240].map(item => <option key={item} value={item}>{item < 60 ? `${item} minutes` : `${item / 60} ${item === 60 ? "hour" : "hours"}`}</option>)}</select></label>
        <label className="form-field"><span>Work session <small>OPTIONAL</small></span><input type="datetime-local" value={scheduled} onChange={event => setScheduled(event.target.value)} /></label>
        <label className="form-field"><span>Deadline <small>OPTIONAL</small></span><input type="datetime-local" value={deadline} onChange={event => setDeadline(event.target.value)} /></label>
        <label className="form-field"><span>Category <small>OPTIONAL</small></span><input maxLength={80} value={category} onChange={event => setCategory(event.target.value)} placeholder="e.g. Personal" /></label>
        <label className="form-field"><span>Custom reminder <small>OPTIONAL</small></span><input type="datetime-local" value={reminder} onChange={event => setReminder(event.target.value)} /></label>
      </div>
      <div className="modal-footer"><span>Only the title is required.</span><div><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !title.trim()} type="submit">{busy ? "Saving…" : task ? "Save changes" : <><Plus size={15} />Create task</>}</button></div></div>
    </form>
  </div>;
}

function ReminderCard({ reminder, onDismiss, onOpen, onSnooze, interfaceScale }: {
  reminder: ReminderPayload | null; onDismiss: () => void; onOpen: () => void; onSnooze: () => void;
  interfaceScale: number;
}) {
  const [payload, setPayload] = useState(reminder);
  const [sequence, setSequence] = useState(0);
  useEffect(() => setPayload(reminder), [reminder]);
  useEffect(() => window.taskline.onReminder(value => {
    setPayload(value);
    setSequence(current => current + 1);
  }), []);
  useEffect(() => {
    const element = document.querySelector<HTMLElement>(".popup-window");
    if (!element) return;
    const resize = () => window.taskline.resizeReminder(element.getBoundingClientRect().height);
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, [interfaceScale, payload]);
  return <div className="popup-window" style={{ zoom: interfaceScale }}>
    <div className="popup-head"><div className="popup-brand"><span className="popup-mark"><Target size={13} /></span><span>TASKLINE <i>·</i> A MOMENT TO RESET</span></div><button onClick={onDismiss} aria-label="Dismiss reminder"><X size={15} /></button></div>
    <div className="popup-content"><div className="popup-title">{payload?.title ?? "Take a breath. Find your next step."}</div><div className="popup-message">{payload?.message ?? "A little progress is still progress."}</div></div>
    <div className="popup-actions">{payload?.task && <button className="popup-task-action" onClick={() => { onOpen(); window.taskline.setTaskStatus(payload.task!.id, "in_progress"); }}>Start task <ArrowRight size={13} /></button>}
      <button className="popup-snooze" title="Snooze for 10 minutes" aria-label="Snooze for 10 minutes" onClick={onSnooze}><Pause size={13} /></button>
      <button className="popup-open" onClick={onOpen}>Open list <ArrowRight size={13} /></button></div>
    <div className="popup-progress" key={sequence}><span /></div>
  </div>;
}
