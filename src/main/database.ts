import Database from "better-sqlite3";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import type { AppSettings, Priority, Recurrence, Task, TaskInput, TaskStats, TaskStatus } from "../shared/types";

const defaults: AppSettings = {
  launchOnStartup: true,
  startMinimized: false,
  minimizeToTray: true,
  interfaceScale: 1.1,
  hourlyReminders: true,
  reminderFrequencyMins: 60,
  reminderStartHour: 8,
  reminderEndHour: 21,
  deadlineReminders: true,
  scheduledReminders: true,
  overdueReminders: true,
  dailyPlanning: true,
  endOfDaySummary: true,
  endOfDayHour: 20,
  automaticPrioritization: true,
  defaultPriority: "normal",
  defaultDurationMins: 30,
  quietStartHour: 22,
  quietEndHour: 7,
};

let db: Database.Database;
let databasePath: string;

export function initializeDatabase(): void {
  databasePath = join(app.getPath("userData"), "taskline.sqlite");
  db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'normal',
      deadline_at TEXT,
      scheduled_at TEXT,
      duration_mins INTEGER NOT NULL DEFAULT 30,
      category TEXT NOT NULL DEFAULT '',
      recurrence TEXT NOT NULL DEFAULT 'none',
      recurrence_interval_days INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      reminder_at TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      started_at TEXT,
      postpone_count INTEGER NOT NULL DEFAULT 0,
      manual_order INTEGER
    );
    CREATE TABLE IF NOT EXISTS task_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      event TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      task_id TEXT,
      sent_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tasks_status_deadline ON tasks(status, deadline_at);
    CREATE INDEX IF NOT EXISTS tasks_status_completed_at ON tasks(status, completed_at);
    CREATE INDEX IF NOT EXISTS tasks_scheduled_at ON tasks(scheduled_at);
    CREATE INDEX IF NOT EXISTS notifications_sent_at ON notification_history(sent_at);
    CREATE INDEX IF NOT EXISTS task_history_event_time ON task_history(event, occurred_at);
  `);
  const taskColumns = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  if (!taskColumns.some(column => column.name === "recurrence")) {
    db.exec("ALTER TABLE tasks ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none'");
  }
  if (!taskColumns.some(column => column.name === "recurrence_interval_days")) {
    db.exec("ALTER TABLE tasks ADD COLUMN recurrence_interval_days INTEGER NOT NULL DEFAULT 1");
  }
  db.prepare(`
    DELETE FROM tasks
    WHERE id IN (
      SELECT child.id
      FROM tasks AS child
      JOIN tasks AS parent ON parent.id != child.id
      JOIN task_history AS completion
        ON completion.task_id = parent.id
        AND completion.event = 'completed'
        AND completion.occurred_at = child.created_at
      WHERE parent.recurrence != 'none'
        AND child.recurrence = parent.recurrence
        AND child.recurrence_interval_days = parent.recurrence_interval_days
        AND child.title = parent.title
        AND child.description = parent.description
        AND child.priority = parent.priority
        AND child.duration_mins = parent.duration_mins
        AND child.category = parent.category
        AND child.status = 'pending'
        AND child.started_at IS NULL
        AND child.postpone_count = 0
    )
  `).run();
  const insertSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(defaults)) {
    insertSetting.run(key, JSON.stringify(value));
  }
  refreshDailyTasks();
}

function localDayRange(now: Date): [string, string] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return [start.toISOString(), end.toISOString()];
}

function completedTaskIdsForDay(start: string, end: string): Set<string> {
  const rows = db.prepare(`
    SELECT task_id AS id FROM task_history
    WHERE event = 'completed' AND occurred_at >= ? AND occurred_at < ?
    UNION
    SELECT id FROM tasks WHERE completed_at >= ? AND completed_at < ?
  `).all(start, end, start, end) as { id: string }[];
  return new Set(rows.map(row => row.id));
}

function refreshDailyTasks(now = new Date()): void {
  const [start] = localDayRange(now);
  const stale = db.prepare(`
    SELECT id FROM tasks
    WHERE status = 'completed'
      AND (
        completed_at < ?
        OR (
          completed_at IS NULL
          AND EXISTS (
            SELECT 1 FROM task_history
            WHERE task_history.task_id = tasks.id
              AND task_history.event = 'completed'
              AND task_history.occurred_at < ?
          )
        )
      )
  `).all(start, start) as { id: string }[];
  if (!stale.length) return;

  db.transaction(() => {
    const resetTask = db.prepare("UPDATE tasks SET status = 'pending', manual_order = NULL WHERE id = ?");
    const recordReset = db.prepare("INSERT INTO task_history (task_id, event, occurred_at) VALUES (?, 'daily_reset', ?)");
    const resetAt = now.toISOString();
    for (const task of stale) {
      resetTask.run(task.id);
      recordReset.run(task.id, resetAt);
    }
  })();
}

function rowToTask(row: Record<string, unknown>, completedToday: boolean): Task {
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description ?? ""),
    priority: row.priority as Priority,
    deadlineAt: row.deadline_at as string | null,
    scheduledAt: row.scheduled_at as string | null,
    durationMins: Number(row.duration_mins),
    category: String(row.category ?? ""),
    recurrence: (row.recurrence ?? "none") as Recurrence,
    recurrenceIntervalDays: Number(row.recurrence_interval_days ?? 1),
    status: row.status as TaskStatus,
    completedToday,
    reminderAt: row.reminder_at as string | null,
    createdAt: String(row.created_at),
    completedAt: row.completed_at as string | null,
    startedAt: row.started_at as string | null,
    postponeCount: Number(row.postpone_count),
    manualOrder: row.manual_order === null ? null : Number(row.manual_order),
  };
}

function priorityScore(task: Task, now: number): number {
  const score = { low: 0, normal: 12, high: 26, critical: 42 }[task.priority];
  const overdueHours = task.deadlineAt ? Math.max(0, (now - Date.parse(task.deadlineAt)) / 3_600_000) : 0;
  const untilDeadlineHours = task.deadlineAt ? (Date.parse(task.deadlineAt) - now) / 3_600_000 : Infinity;
  const untilScheduledHours = task.scheduledAt ? (Date.parse(task.scheduledAt) - now) / 3_600_000 : Infinity;
  return score + Math.min(60, overdueHours * 2.5) +
    (untilDeadlineHours >= 0 ? Math.max(0, 40 - untilDeadlineHours) : 35) +
    (untilScheduledHours < 24 && untilScheduledHours > -2 ? 18 : 0) +
    (task.status === "in_progress" ? 16 : 0) +
    Math.min(18, task.postponeCount * 4) +
    Math.min(15, task.durationMins / 30);
}

export function listTasks(): Task[] {
  const now = new Date();
  refreshDailyTasks(now);
  const [start, end] = localDayRange(now);
  const completedToday = completedTaskIdsForDay(start, end);
  const tasks = (db.prepare("SELECT * FROM tasks").all() as Record<string, unknown>[]).map(row =>
    rowToTask(row, completedToday.has(String(row.id))));
  if (!getSettings().automaticPrioritization) {
    const active = tasks.filter(task => task.status !== "completed")
      .sort((a, b) => (a.manualOrder ?? Number.MAX_SAFE_INTEGER) - (b.manualOrder ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt.localeCompare(b.createdAt));
    return active.concat(tasks.filter(task => task.status === "completed"));
  }
  return tasks.sort((a, b) => {
    if (a.status === "completed" && b.status !== "completed") return 1;
    if (b.status === "completed" && a.status !== "completed") return -1;
    if (a.manualOrder !== null || b.manualOrder !== null) {
      return (a.manualOrder ?? Number.MAX_SAFE_INTEGER) - (b.manualOrder ?? Number.MAX_SAFE_INTEGER);
    }
    return priorityScore(b, Date.now()) - priorityScore(a, Date.now());
  });
}

function validateInput(input: TaskInput): TaskInput {
  const title = input.title?.trim();
  if (!title || title.length > 200) throw new Error("Task title must be between 1 and 200 characters.");
  if (input.description && input.description.length > 5000) throw new Error("Description is too long.");
  if (input.category && input.category.length > 80) throw new Error("Category is too long.");
  if (input.priority && !["low", "normal", "high", "critical"].includes(input.priority)) {
    throw new Error("Invalid task priority.");
  }
  if (input.recurrence && !["none", "daily", "weekly", "monthly", "custom"].includes(input.recurrence)) {
    throw new Error("Invalid recurrence setting.");
  }
  if (input.recurrenceIntervalDays !== undefined &&
      (!Number.isInteger(input.recurrenceIntervalDays) || input.recurrenceIntervalDays < 1 || input.recurrenceIntervalDays > 365)) {
    throw new Error("Custom recurrence must be between 1 and 365 days.");
  }
  for (const date of [input.deadlineAt, input.scheduledAt, input.reminderAt]) {
    if (date !== undefined && date !== null && (typeof date !== "string" || !Number.isFinite(Date.parse(date)))) {
      throw new Error("Task dates must be valid date and time values.");
    }
  }
  if (input.durationMins !== undefined && (!Number.isInteger(input.durationMins) || input.durationMins < 1 || input.durationMins > 10080)) {
    throw new Error("Duration must be between 1 minute and 7 days.");
  }
  return { ...input, title };
}

export function createTask(input: TaskInput): Task {
  const clean = validateInput(input);
  return db.transaction(() => {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO tasks (id, title, description, priority, deadline_at, scheduled_at, duration_mins, category, recurrence, recurrence_interval_days, reminder_at, created_at)
      VALUES (@id, @title, @description, @priority, @deadlineAt, @scheduledAt, @durationMins, @category, @recurrence, @recurrenceIntervalDays, @reminderAt, @createdAt)
    `).run({
      id, title: clean.title, description: clean.description ?? "", priority: clean.priority ?? "normal",
      deadlineAt: clean.deadlineAt ?? null, scheduledAt: clean.scheduledAt ?? null,
      durationMins: clean.durationMins ?? 30, category: clean.category ?? "",
      recurrence: clean.recurrence ?? "none",
      recurrenceIntervalDays: clean.recurrenceIntervalDays ?? 1,
      reminderAt: clean.reminderAt ?? null, createdAt: now,
    });
    db.prepare("INSERT INTO task_history (task_id, event, occurred_at) VALUES (?, 'created', ?)").run(id, now);
    return getTask(id);
  })();
}

export function updateTask(id: string, input: TaskInput): Task {
  const clean = validateInput(input);
  const existing = getTask(id);
  return db.transaction(() => {
    const updatedSchedule = clean.scheduledAt === undefined ? existing.scheduledAt : clean.scheduledAt;
    db.prepare(`
      UPDATE tasks SET title = @title, description = @description, priority = @priority,
        deadline_at = @deadlineAt, scheduled_at = @scheduledAt, duration_mins = @durationMins,
        category = @category, recurrence = @recurrence, recurrence_interval_days = @recurrenceIntervalDays,
        reminder_at = @reminderAt,
        postpone_count = postpone_count + CASE WHEN @scheduledAt IS NOT scheduled_at THEN 1 ELSE 0 END,
        manual_order = NULL
      WHERE id = @id
    `).run({
      id, title: clean.title, description: clean.description ?? existing.description,
      priority: clean.priority ?? existing.priority,
      deadlineAt: clean.deadlineAt === undefined ? existing.deadlineAt : clean.deadlineAt,
      scheduledAt: updatedSchedule,
      durationMins: clean.durationMins ?? existing.durationMins,
      category: clean.category ?? existing.category,
      recurrence: clean.recurrence ?? existing.recurrence,
      recurrenceIntervalDays: clean.recurrenceIntervalDays ?? existing.recurrenceIntervalDays,
      reminderAt: clean.reminderAt === undefined ? existing.reminderAt : clean.reminderAt,
    });
    if (updatedSchedule !== existing.scheduledAt) {
      db.prepare("INSERT INTO task_history (task_id, event, occurred_at) VALUES (?, 'rescheduled', ?)").run(id, new Date().toISOString());
    }
    return getTask(id);
  })();
}

export function setTaskStatus(id: string, status: TaskStatus): Task {
  if (!["pending", "in_progress", "completed", "postponed"].includes(status)) throw new Error("Invalid task status.");
  return db.transaction(() => {
    const existing = getTask(id);
    if (status === "completed" && existing.status === "completed") return existing;
    if (status === "completed" && existing.completedToday) {
      throw new Error("This task has already been completed today. It will be available again tomorrow.");
    }
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE tasks SET status = ?, completed_at = ?,
        started_at = CASE WHEN ? = 'in_progress' THEN COALESCE(started_at, ?) ELSE started_at END,
        manual_order = NULL WHERE id = ?
    `).run(status, status === "completed" ? now : null, status, status === "in_progress" ? now : null, id);
    db.prepare("INSERT INTO task_history (task_id, event, occurred_at) VALUES (?, ?, ?)").run(id, status, now);
    return getTask(id);
  })();
}

export function reorderTasks(ids: string[]): void {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) {
    throw new Error("Task ordering must contain unique task IDs.");
  }
  const update = db.prepare("UPDATE tasks SET manual_order = ? WHERE id = ?");
  db.transaction((taskIds: string[]) => taskIds.forEach((id, index) => update.run(index, id)))(ids);
}

export function exportTaskData(): Task[] {
  const now = new Date();
  refreshDailyTasks(now);
  const [start, end] = localDayRange(now);
  const completedToday = completedTaskIdsForDay(start, end);
  return (db.prepare("SELECT * FROM tasks ORDER BY created_at").all() as Record<string, unknown>[])
    .map(row => rowToTask(row, completedToday.has(String(row.id))));
}

export function importTaskData(value: unknown): number {
  const rows = Array.isArray(value) ? value
    : value && typeof value === "object" && "tasks" in value && Array.isArray(value.tasks) ? value.tasks
      : null;
  if (!rows) throw new Error("The selected file does not contain a TASKLINE task list.");
  const clean = rows.map((row: unknown) => {
    if (!row || typeof row !== "object" || typeof (row as { title?: unknown }).title !== "string") {
      throw new Error("The selected file contains an invalid task.");
    }
    const task = row as Partial<Task> & TaskInput;
    const input = validateInput(task);
    const status = task.status && ["pending", "in_progress", "completed", "postponed"].includes(task.status)
      ? task.status : "pending";
    const validDate = (date: string | null | undefined, fallback: string | null): string | null =>
      date && Number.isFinite(Date.parse(date)) ? date : fallback;
    return {
      input,
      status,
      createdAt: validDate(task.createdAt, new Date().toISOString())!,
      completedAt: status === "completed" ? validDate(task.completedAt, new Date().toISOString()) : null,
      startedAt: validDate(task.startedAt, null),
      postponeCount: Number.isInteger(task.postponeCount) && (task.postponeCount ?? 0) >= 0 ? task.postponeCount! : 0,
      manualOrder: Number.isInteger(task.manualOrder) ? task.manualOrder : null,
    };
  });
  const insert = db.prepare(`
    INSERT INTO tasks (id, title, description, priority, deadline_at, scheduled_at, duration_mins,
      category, recurrence, recurrence_interval_days, status, reminder_at, created_at, completed_at, started_at, postpone_count, manual_order)
    VALUES (@id, @title, @description, @priority, @deadlineAt, @scheduledAt, @durationMins,
      @category, @recurrence, @recurrenceIntervalDays, @status, @reminderAt, @createdAt, @completedAt, @startedAt, @postponeCount, @manualOrder)
  `);
  const history = db.prepare("INSERT INTO task_history (task_id, event, occurred_at) VALUES (?, ?, ?)");
  const insertAll = db.transaction((items: typeof clean) => {
    for (const item of items) {
      const id = randomUUID();
      const now = new Date().toISOString();
      insert.run({
        id, title: item.input.title, description: item.input.description ?? "",
        priority: item.input.priority ?? "normal", deadlineAt: item.input.deadlineAt ?? null,
        scheduledAt: item.input.scheduledAt ?? null, durationMins: item.input.durationMins ?? 30,
        category: item.input.category ?? "", recurrence: item.input.recurrence ?? "none",
        recurrenceIntervalDays: item.input.recurrenceIntervalDays ?? 1,
        status: item.status, reminderAt: item.input.reminderAt ?? null, createdAt: item.createdAt,
        completedAt: item.completedAt, startedAt: item.startedAt, postponeCount: item.postponeCount,
        manualOrder: item.manualOrder,
      });
      history.run(id, "imported", now);
      if (item.status === "completed" && item.completedAt) history.run(id, "completed", item.completedAt);
    }
  });
  insertAll(clean);
  return clean.length;
}

export async function createDatabaseBackup(path: string): Promise<void> {
  await db.backup(path);
}

export function restoreDatabaseBackup(path: string): void {
  if (path === databasePath) throw new Error("Choose a backup file instead of the active database.");
  const backup = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const integrity = backup.pragma("integrity_check") as { integrity_check: string }[];
    if (integrity[0]?.integrity_check !== "ok") throw new Error("The selected backup is damaged.");
    backup.prepare("SELECT id, title FROM tasks LIMIT 1").get();
  } finally {
    backup.close();
  }
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  try {
    copyFileSync(path, databasePath);
  } catch (error) {
    initializeDatabase();
    throw error;
  }
  initializeDatabase();
}

export function clearTaskData(): void {
  db.transaction(() => {
    db.prepare("DELETE FROM task_history").run();
    db.prepare("DELETE FROM tasks").run();
    db.prepare("DELETE FROM notification_history").run();
  })();
}

export function deleteTask(id: string): void {
  const result = db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  if (result.changes === 0) throw new Error("Task not found.");
}

export function getTask(id: string): Task {
  const now = new Date();
  refreshDailyTasks(now);
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Task not found.");
  const [start, end] = localDayRange(now);
  return rowToTask(row, completedTaskIdsForDay(start, end).has(id));
}

export function getSettings(): AppSettings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  return { ...defaults, ...Object.fromEntries(rows.map(({ key, value }) => [key, JSON.parse(value)])) } as AppSettings;
}

export function updateSettings(update: Partial<AppSettings>): AppSettings {
  const allowed = Object.keys(defaults) as (keyof AppSettings)[];
  const set = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const updates: [keyof AppSettings, unknown][] = [];
  for (const [key, value] of Object.entries(update)) {
    if (!allowed.includes(key as keyof AppSettings)) throw new Error(`Unknown setting: ${key}.`);
    const setting = key as keyof AppSettings;
    if (typeof value !== typeof defaults[setting]) throw new Error(`Invalid value for setting: ${key}.`);
    if (setting === "defaultPriority" && !["low", "normal", "high", "critical"].includes(String(value))) {
      throw new Error("Invalid default task priority.");
    }
    if (setting.endsWith("Hour") && (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 23)) {
      throw new Error("Hours must be whole numbers between 0 and 23.");
    }
    if (setting === "reminderFrequencyMins" && ![30, 60, 90, 120].includes(Number(value))) {
      throw new Error("Choose a supported reminder frequency.");
    }
    if (setting === "defaultDurationMins" && (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 10080)) {
      throw new Error("Default duration must be between 1 minute and 7 days.");
    }
    if (setting === "interfaceScale" && (!Number.isFinite(value) || Number(value) < 0.9 || Number(value) > 1.3)) {
      throw new Error("Interface size must be between 90% and 130%.");
    }
    updates.push([setting, value]);
  }
  db.transaction(() => updates.forEach(([key, value]) => set.run(key, JSON.stringify(value))))();
  return getSettings();
}

export function getStats(): TaskStats {
  const now = new Date();
  refreshDailyTasks(now);
  const rows = db.prepare("SELECT * FROM tasks").all() as Record<string, unknown>[];
  const tasks = rows.map(row => rowToTask(row, false));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = today - ((now.getDay() + 6) % 7) * 86_400_000;
  const completedTaskIds = new Set((db.prepare(`
    SELECT task_id AS id FROM task_history WHERE event = 'completed'
    UNION SELECT id FROM tasks WHERE completed_at IS NOT NULL
  `).all() as { id: string }[]).map(row => row.id));
  const [todayStart, todayEnd] = localDayRange(now);
  const completedToday = completedTaskIdsForDay(todayStart, todayEnd).size;
  const completedThisWeek = new Set((db.prepare(`
    SELECT task_id AS id FROM task_history WHERE event = 'completed' AND occurred_at >= ?
    UNION SELECT id FROM tasks WHERE completed_at >= ?
  `).all(new Date(startOfWeek).toISOString(), new Date(startOfWeek).toISOString()) as { id: string }[]).map(row => row.id)).size;
  const active = tasks.filter(task => task.status !== "completed");
  const completionDurations = tasks
    .filter(task => task.startedAt && task.completedAt)
    .map(task => (Date.parse(task.completedAt!) - Date.parse(task.startedAt!)) / 60_000)
    .filter(duration => duration >= 0);
  return {
    total: tasks.length,
    completed: completedTaskIds.size,
    active: active.length,
    overdue: active.filter(task => task.deadlineAt && Date.parse(task.deadlineAt) < Date.now()).length,
    completedToday,
    completedThisWeek,
    completionRate: tasks.length ? Math.round(completedTaskIds.size / tasks.length * 100) : 0,
    averageCompletionMins: completionDurations.length
      ? Math.round(completionDurations.reduce((sum, duration) => sum + duration, 0) / completionDurations.length)
      : null,
  };
}

export function wasNotificationSent(fingerprint: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM notification_history WHERE fingerprint = ?").get(fingerprint));
}

export function recordNotification(fingerprint: string, kind: string, taskId?: string): void {
  db.prepare("INSERT OR IGNORE INTO notification_history (fingerprint, kind, task_id, sent_at) VALUES (?, ?, ?, ?)")
    .run(fingerprint, kind, taskId ?? null, new Date().toISOString());
}

export function getNotificationCount(kind: string): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM notification_history WHERE kind = ?").get(kind) as { count: number };
  return row.count;
}

export function closeDatabase(): void {
  if (db?.open) db.close();
}
