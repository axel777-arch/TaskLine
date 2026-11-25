export type Priority = "low" | "normal" | "high" | "critical";
export type TaskStatus = "pending" | "in_progress" | "completed" | "postponed";
export type Recurrence = "none" | "daily" | "weekly" | "monthly" | "custom";

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  deadlineAt: string | null;
  scheduledAt: string | null;
  durationMins: number;
  category: string;
  recurrence: Recurrence;
  recurrenceIntervalDays: number;
  status: TaskStatus;
  completedToday: boolean;
  reminderAt: string | null;
  createdAt: string;
  completedAt: string | null;
  startedAt: string | null;
  postponeCount: number;
  manualOrder: number | null;
}

export interface TaskInput {
  title: string;
  description?: string;
  priority?: Priority;
  deadlineAt?: string | null;
  scheduledAt?: string | null;
  durationMins?: number;
  category?: string;
  recurrence?: Recurrence;
  recurrenceIntervalDays?: number;
  reminderAt?: string | null;
}

export interface AppSettings {
  launchOnStartup: boolean;
  startMinimized: boolean;
  minimizeToTray: boolean;
  interfaceScale: number;
  hourlyReminders: boolean;
  reminderFrequencyMins: number;
  reminderStartHour: number;
  reminderEndHour: number;
  deadlineReminders: boolean;
  scheduledReminders: boolean;
  overdueReminders: boolean;
  dailyPlanning: boolean;
  endOfDaySummary: boolean;
  endOfDayHour: number;
  automaticPrioritization: boolean;
  defaultPriority: Priority;
  defaultDurationMins: number;
  quietStartHour: number;
  quietEndHour: number;
}

export interface TaskStats {
  total: number;
  completed: number;
  active: number;
  overdue: number;
  completedToday: number;
  completedThisWeek: number;
  completionRate: number;
  averageCompletionMins: number | null;
}

export interface ReminderPayload {
  title: string;
  message: string;
  task?: Task;
  kind: "hourly" | "deadline" | "overdue" | "scheduled" | "planning" | "summary" | "missed" | "risk";
}

export interface TasklineApi {
  listTasks(): Promise<Task[]>;
  createTask(input: TaskInput): Promise<Task>;
  updateTask(id: string, input: TaskInput): Promise<Task>;
  setTaskStatus(id: string, status: TaskStatus): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  reorderTasks(ids: string[]): Promise<void>;
  exportTasks(): Promise<boolean>;
  importTasks(): Promise<number>;
  createBackup(): Promise<boolean>;
  restoreBackup(): Promise<boolean>;
  clearData(): Promise<void>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
  getStats(): Promise<TaskStats>;
  snoozeReminder(): Promise<void>;
  resizeReminder(height: number): void;
  dismissWindow(): void;
  openMain(): void;
  onReminder(callback: (reminder: ReminderPayload) => void): () => void;
  onReminderHide(callback: () => void): () => void;
}

declare global {
  interface Window {
    taskline: TasklineApi;
  }
}
