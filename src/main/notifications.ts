import { Notification, powerMonitor, screen } from "electron";
import {
  getSettings,
  getStats,
  getNotificationCount,
  listTasks,
  recordNotification,
  wasNotificationSent,
} from "./database";
import type { ReminderPayload, Task } from "../shared/types";

type ShowReminder = (reminder: ReminderPayload) => void;

const messages = [
  "An hour has passed. What's your next move?",
  "Small progress is still progress. Keep going.",
  "It's time to refocus.",
  "One task at a time. Start now.",
  "Your priorities haven't changed. Continue.",
  "A little progress now makes tomorrow easier.",
];
let timer: NodeJS.Timeout | undefined;
let lastHourlyAt = 0;
let messageIndex = -1;
let specialNotificationsThisCycle = 0;
let showReminder: ShowReminder = () => undefined;
let openMain: () => void = () => undefined;
let isMainVisible: () => boolean = () => false;

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isQuietHour(hour: number, start: number, end: number): boolean {
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

function isWithinHours(hour: number, start: number, end: number): boolean {
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

function emit(reminder: ReminderPayload, customOnly = false): void {
  if (customOnly || isMainVisible() || !Notification.isSupported()) {
    showReminder(reminder);
    return;
  }
  const notification = new Notification({ title: reminder.title, body: reminder.message, silent: true });
  notification.on("click", openMain);
  notification.show();
}

function once(fingerprint: string, kind: ReminderPayload["kind"], message: string, task?: Task): void {
  if (specialNotificationsThisCycle >= 2 || wasNotificationSent(fingerprint)) return;
  recordNotification(fingerprint, kind, task?.id);
  specialNotificationsThisCycle++;
  emit({ title: task?.title ?? "TASKLINE", message, task, kind });
}

function notifyDeadline(task: Task, hoursLeft: number, now: Date): void {
  const thresholds = task.priority === "critical" ? [24, 6, 1, 1 / 6]
    : task.priority === "high" ? [6, 1, 1 / 6]
      : task.priority === "normal" ? [1, 1 / 6] : [1 / 6];
  const threshold = thresholds.find(value => hoursLeft <= value && hoursLeft > value - 1);
  if (threshold === undefined) return;
  const label = threshold >= 1 ? `${threshold} hour${threshold === 1 ? "" : "s"}` : "10 minutes";
  once(`deadline:${task.id}:${localDateKey(now)}:${threshold}`, "deadline",
    `Due in ${label}. ${task.durationMins} min estimated. Consider starting now.`, task);
}

function evaluate(): void {
  specialNotificationsThisCycle = 0;
  const settings = getSettings();
  const now = new Date();
  const hour = now.getHours();
  const tasks = listTasks();
  const active = tasks.filter(task => task.status !== "completed");
  const quiet = isQuietHour(hour, settings.quietStartHour, settings.quietEndHour);

  if (settings.overdueReminders && !quiet) {
    const overdue = active.filter(task => task.deadlineAt && Date.parse(task.deadlineAt) < now.getTime())
      .sort((a, b) => Date.parse(a.deadlineAt!) - Date.parse(b.deadlineAt!))[0];
    if (overdue) {
      once(`overdue:${overdue.id}:${localDateKey(now)}`, "overdue",
        "This task is past its deadline. Reschedule it or make a little progress.", overdue);
    }
  }

  if (settings.deadlineReminders && !quiet) {
    const risky = active.find(task => task.deadlineAt && task.status !== "completed" &&
      Date.parse(task.deadlineAt) > now.getTime() &&
      (Date.parse(task.deadlineAt) - now.getTime()) / 60_000 < task.durationMins);
    if (risky) {
      once(`risk:${risky.id}:${localDateKey(now)}`, "risk",
        `Due soon with ${risky.durationMins} min estimated. The remaining time may be tight.`, risky);
    }
    for (const task of active) {
      if (!task.deadlineAt) continue;
      const hoursLeft = (Date.parse(task.deadlineAt) - now.getTime()) / 3_600_000;
      if (hoursLeft > 0) notifyDeadline(task, hoursLeft, now);
    }
  }

  if (!quiet) {
    const repeatedlyPostponed = active.find(task => task.postponeCount >= 3);
    if (repeatedlyPostponed) {
      once(`postponed:${repeatedlyPostponed.id}:${repeatedlyPostponed.postponeCount}`, "missed",
        "You have rescheduled this task several times. Consider setting aside time to finish it.", repeatedlyPostponed);
    }
  }

  if (settings.scheduledReminders && !quiet) {
    const nextTask = active.find(task => task.scheduledAt &&
      ((Date.parse(task.scheduledAt) - now.getTime()) >= 0 && (Date.parse(task.scheduledAt) - now.getTime()) <= 10 * 60_000 ||
        (Date.parse(task.scheduledAt) - now.getTime()) <= -30 * 60_000 &&
        (Date.parse(task.scheduledAt) - now.getTime()) > -60 * 60_000));
    for (const task of nextTask ? [nextTask] : []) {
      if (!task.scheduledAt) continue;
      const minutesToStart = (Date.parse(task.scheduledAt) - now.getTime()) / 60_000;
      if (minutesToStart >= 0 && minutesToStart <= 10) {
        once(`scheduled:${task.id}:${task.scheduledAt}`, "scheduled",
          `Starting soon · ${task.durationMins} min estimated.`, task);
      } else if (minutesToStart <= -30 && minutesToStart > -60) {
        once(`missed:${task.id}:${task.scheduledAt}`, "missed",
          `You planned to start this 30 minutes ago. Start now or reschedule?`, task);
      }
    }
  }

  if (!quiet) {
    const nextReminder = active.find(task => task.reminderAt &&
      (Date.parse(task.reminderAt) - now.getTime()) / 60_000 >= 0 &&
      (Date.parse(task.reminderAt) - now.getTime()) / 60_000 <= 1);
    for (const task of nextReminder ? [nextReminder] : []) {
      if (!task.reminderAt) continue;
      const minutesToReminder = (Date.parse(task.reminderAt) - now.getTime()) / 60_000;
      if (minutesToReminder >= 0 && minutesToReminder <= 1) {
        once(`custom:${task.id}:${task.reminderAt}`, "scheduled", "Your custom reminder is due.", task);
      }
    }
  }

  if (settings.dailyPlanning && !quiet && hour >= 8 && hour < 10) {
    once(`planning:${localDateKey(now)}`, "planning",
      `${active.filter(task => task.scheduledAt && new Date(task.scheduledAt).toDateString() === now.toDateString()).length} tasks scheduled today · ${active.filter(task => task.deadlineAt && new Date(task.deadlineAt).toDateString() === now.toDateString()).length} due today.`);
  }

  if (settings.endOfDaySummary && !quiet && hour === settings.endOfDayHour && now.getMinutes() < 5) {
    const stats = getStats();
    const pending = active.filter(task => !task.scheduledAt || new Date(task.scheduledAt).toDateString() === now.toDateString()).length;
    once(`summary:${localDateKey(now)}`, "summary",
      `${stats.completedToday} completed today · ${pending} unfinished · ${stats.overdue} overdue.`);
  }

  const insideActiveHours = isWithinHours(hour, settings.reminderStartHour, settings.reminderEndHour);
  const frequencyMs = settings.reminderFrequencyMins * 60_000;
  const isHourlyDue = !lastHourlyAt || now.getTime() - lastHourlyAt >= frequencyMs;
  if (settings.hourlyReminders && insideActiveHours && !quiet && isHourlyDue) {
    const fingerprint = `hourly:${localDateKey(now)}:${hour}:${Math.floor(now.getMinutes() / Math.max(1, settings.reminderFrequencyMins))}`;
    if (!wasNotificationSent(fingerprint)) {
      lastHourlyAt = now.getTime();
      recordNotification(fingerprint, "hourly");
      messageIndex = (messageIndex + 1) % messages.length;
      const first = active.find(task => task.status === "in_progress") ?? active[0];
      const dueNow = active.find(task => task.scheduledAt && Math.abs(Date.parse(task.scheduledAt) - now.getTime()) < 60 * 60_000);
      const overdue = active.find(task => task.deadlineAt && Date.parse(task.deadlineAt) < now.getTime());
      const todayKey = localDateKey(now);
      const remainingToday = active.filter(task =>
        [task.scheduledAt, task.deadlineAt].some(value => value && localDateKey(new Date(value)) === todayKey));
      const chosen = overdue ?? dueNow ?? first;
      if (active.length === 0 && tasks.length > 0) {
        emit({ title: "A clear slate.", message: "All done for now. Take a moment to enjoy it.", kind: "hourly" }, true);
      } else if (!chosen) {
        emit({ title: "Make room for what matters.", message: "Add a task when you're ready to plan your day.", kind: "hourly" }, true);
      } else {
        const detail = chosen.deadlineAt
          ? `Due ${new Date(chosen.deadlineAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
          : chosen.scheduledAt
            ? `Planned ${new Date(chosen.scheduledAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
            : `${chosen.durationMins} min estimated`;
        const remainingCount = remainingToday.length;
        const countLabel = `${remainingCount} task${remainingCount === 1 ? "" : "s"} left for today`;
        const title = remainingCount > 0 ? countLabel : "No tasks due today";
        const message = remainingCount > 0
          ? `${messages[messageIndex]} ${chosen.title} · ${detail}`
          : `${active.length} unfinished task${active.length === 1 ? "" : "s"} remain. ${messages[messageIndex]} Next up: ${chosen.title} · ${detail}`;
        emit({ title, message, task: chosen, kind: "hourly" }, true);
      }
    }
  }
}

export function startNotificationService(onShow: ShowReminder, onOpenMain: () => void, isVisible: () => boolean): void {
  showReminder = onShow;
  openMain = onOpenMain;
  isMainVisible = isVisible;
  messageIndex = getNotificationCount("hourly") % messages.length - 1;
  if (timer) clearInterval(timer);
  evaluate();
  timer = setInterval(evaluate, 60_000);
  powerMonitor.on("resume", evaluate);
  powerMonitor.on("lock-screen", () => undefined);
}

export function stopNotificationService(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  powerMonitor.removeListener("resume", evaluate);
}

export function popupBounds(scale = 1): Electron.Rectangle {
  const display = screen.getPrimaryDisplay();
  const { x, y, height } = display.workArea;
  const popupWidth = Math.round(360 * scale);
  const popupHeight = Math.round(148 * scale);
  return { x: x + 20, y: y + height - popupHeight - 20, width: popupWidth, height: popupHeight };
}
