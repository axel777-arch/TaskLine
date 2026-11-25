import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, ReminderPayload, TaskInput, TaskStatus } from "../shared/types";

contextBridge.exposeInMainWorld("taskline", {
  listTasks: () => ipcRenderer.invoke("tasks:list"),
  createTask: (input: TaskInput) => ipcRenderer.invoke("tasks:create", input),
  updateTask: (id: string, input: TaskInput) => ipcRenderer.invoke("tasks:update", id, input),
  setTaskStatus: (id: string, status: TaskStatus) => ipcRenderer.invoke("tasks:status", id, status),
  deleteTask: (id: string) => ipcRenderer.invoke("tasks:delete", id),
  reorderTasks: (ids: string[]) => ipcRenderer.invoke("tasks:reorder", ids),
  exportTasks: () => ipcRenderer.invoke("data:export"),
  importTasks: () => ipcRenderer.invoke("data:import"),
  createBackup: () => ipcRenderer.invoke("data:backup"),
  restoreBackup: () => ipcRenderer.invoke("data:restore"),
  clearData: () => ipcRenderer.invoke("data:clear"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke("settings:update", settings),
  getStats: () => ipcRenderer.invoke("stats:get"),
  snoozeReminder: () => ipcRenderer.invoke("reminder:snooze"),
  resizeReminder: (height: number) => ipcRenderer.send("reminder:resize", height),
  dismissWindow: () => ipcRenderer.send("window:dismiss"),
  openMain: () => ipcRenderer.send("window:open-main"),
  onReminder: (callback: (reminder: ReminderPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, reminder: ReminderPayload) => callback(reminder);
    ipcRenderer.on("reminder:show", listener);
    return () => ipcRenderer.removeListener("reminder:show", listener);
  },
});
