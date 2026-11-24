import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, Tray } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  clearTaskData,
  closeDatabase,
  createDatabaseBackup,
  createTask,
  deleteTask,
  exportTaskData,
  getSettings,
  getStats,
  initializeDatabase,
  listTasks,
  importTaskData,
  reorderTasks,
  restoreDatabaseBackup,
  setTaskStatus,
  updateSettings,
  updateTask,
} from "./database";
import { popupBounds, startNotificationService, stopNotificationService } from "./notifications";
import type { AppSettings, ReminderPayload, TaskInput, TaskStatus } from "../shared/types";

let mainWindow: BrowserWindow | null = null;
let reminderWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let pendingReminder: ReminderPayload | null = null;
let reminderHideTimer: NodeJS.Timeout | undefined;

function updateStartupSetting(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled, args: ["--hidden"] });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 920,
    minHeight: 640,
    show: !process.argv.includes("--hidden") && !getSettings().startMinimized,
    backgroundColor: "#0b0b0b",
    title: "TASKLINE",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(join(__dirname, "../../dist/index.html"));
  }
  window.on("close", event => {
    if (!quitting && getSettings().minimizeToTray) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
  mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  const image = nativeImage.createFromPath(join(__dirname, "../../assets/taskline-icon.png")).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip("TASKLINE");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open TASKLINE", click: showMainWindow },
    { label: "Remind me in 10 minutes", click: () => { if (pendingReminder) setTimeout(() => showReminder(pendingReminder!), 10 * 60_000); } },
    { type: "separator" },
    { label: "Exit", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", showMainWindow);
}

function createReminderWindow(): BrowserWindow {
  const bounds = popupBounds(getSettings().interfaceScale);
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setAlwaysOnTop(true, "floating");
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(`${process.env.VITE_DEV_SERVER_URL}?popup=1`);
  } else {
    void window.loadFile(join(__dirname, "../../dist/index.html"), { query: { popup: "1" } });
  }
  return window;
}

function showReminder(reminder: ReminderPayload): void {
  pendingReminder = reminder;
  if (!reminderWindow || reminderWindow.isDestroyed()) reminderWindow = createReminderWindow();
  const bounds = popupBounds(getSettings().interfaceScale);
  reminderWindow.setBounds(bounds);
  if (reminderWindow.webContents.isLoading()) {
    reminderWindow.webContents.once("did-finish-load", () => {
      reminderWindow?.webContents.send("reminder:show", reminder);
    });
  } else {
    reminderWindow.webContents.send("reminder:show", reminder);
  }
  reminderWindow.showInactive();
  if (reminderHideTimer) clearTimeout(reminderHideTimer);
  reminderHideTimer = setTimeout(() => {
    if (reminderWindow && !reminderWindow.isDestroyed()) reminderWindow.hide();
  }, 13_000);
}

function registerIpc(): void {
  ipcMain.handle("tasks:list", () => listTasks());
  ipcMain.handle("tasks:create", (_event, input: TaskInput) => createTask(input));
  ipcMain.handle("tasks:update", (_event, id: string, input: TaskInput) => updateTask(id, input));
  ipcMain.handle("tasks:status", (_event, id: string, status: TaskStatus) => setTaskStatus(id, status));
  ipcMain.handle("tasks:delete", (_event, id: string) => deleteTask(id));
  ipcMain.handle("tasks:reorder", (_event, ids: string[]) => reorderTasks(ids));
  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:update", (_event, settings: Partial<AppSettings>) => {
    const saved = updateSettings(settings);
    updateStartupSetting(saved.launchOnStartup);
    return saved;
  });
  ipcMain.handle("stats:get", () => getStats());
  ipcMain.handle("data:export", async () => {
    const result = await dialog.showSaveDialog({
      title: "Export TASKLINE tasks",
      defaultPath: "taskline-tasks.json",
      filters: [{ name: "TASKLINE task export", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(result.filePath, JSON.stringify({ exportedAt: new Date().toISOString(), tasks: exportTaskData() }, null, 2), "utf8");
    return true;
  });
  ipcMain.handle("data:import", async () => {
    const result = await dialog.showOpenDialog({
      title: "Import TASKLINE tasks",
      properties: ["openFile"],
      filters: [{ name: "TASKLINE task export", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePaths[0]) return 0;
    const content = await readFile(result.filePaths[0], "utf8");
    let data: unknown;
    try { data = JSON.parse(content); }
    catch { throw new Error("The selected file is not valid JSON."); }
    return importTaskData(data);
  });
  ipcMain.handle("data:backup", async () => {
    const result = await dialog.showSaveDialog({
      title: "Create a TASKLINE backup",
      defaultPath: "taskline-backup.sqlite",
      filters: [{ name: "SQLite backup", extensions: ["sqlite"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await createDatabaseBackup(result.filePath);
    return true;
  });
  ipcMain.handle("data:restore", async () => {
    const result = await dialog.showOpenDialog({
      title: "Restore a TASKLINE backup",
      properties: ["openFile"],
      filters: [{ name: "SQLite backup", extensions: ["sqlite", "db"] }],
    });
    if (result.canceled || !result.filePaths[0]) return false;
    restoreDatabaseBackup(result.filePaths[0]);
    return true;
  });
  ipcMain.handle("data:clear", () => clearTaskData());
  ipcMain.handle("reminder:snooze", () => {
    if (pendingReminder) setTimeout(() => showReminder(pendingReminder!), 10 * 60_000);
  });
  ipcMain.on("window:dismiss", () => reminderWindow?.hide());
  ipcMain.on("window:open-main", () => {
    reminderWindow?.hide();
    showMainWindow();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());
  app.whenReady().then(() => {
    app.setAppUserModelId("com.taskline.desktop");
    initializeDatabase();
    updateStartupSetting(getSettings().launchOnStartup);
    registerIpc();
    createTray();
    mainWindow = createMainWindow();
    startNotificationService(showReminder, showMainWindow, () => Boolean(mainWindow?.isVisible()));
    app.on("activate", showMainWindow);
  });
  app.on("before-quit", () => {
    quitting = true;
    stopNotificationService();
    closeDatabase();
    tray?.destroy();
  });
}

