# TASKLINE

TASKLINE is a local-first Windows desktop task manager built with Electron, React, TypeScript, and SQLite. Task data and notification history stay in the Windows app-data directory. The app does not use accounts or cloud sync; packaged installations connect to GitHub Releases only to check for app updates.

## Requirements

- Windows 10 or Windows 11
- Node.js 20.19+ (Node.js 22+ recommended)
- npm

## Run from source

```powershell
npm install
npm run dev
```

The development app uses a local Vite server. To create a production build:

```powershell
npm run typecheck
npm run build
npm start
```

To create the Windows NSIS installer:

```powershell
npm run dist
```

The installer is written to `release/`. It offers installation-directory selection and creates Start-menu and desktop shortcuts. It is not code-signed, so Windows may show its standard unknown-publisher warning.

## Windows startup and tray

The **Launch when I sign in** preference is enabled by default. TASKLINE opens directly to **All tasks** when Windows starts, unless **Start minimized** is enabled. Turn **Launch when I sign in** off in **Settings → General** to remove the login item. The setting is applied immediately.

Closing the main window hides TASKLINE in the system tray by default. Use **Open TASKLINE** to show it again, or choose **Exit** from the tray menu to stop background reminders. **Start minimized** controls whether Windows sign-in and ordinary app launches show the main window.

To verify startup behavior after installing:

1. Open TASKLINE → **Settings → General** and confirm **Launch when I sign in** is on.
2. Sign out of Windows and sign in again. TASKLINE should open to **All tasks**, or stay in the tray if **Start minimized** is on.
3. Open the tray menu to restore the workspace. Turn off **Launch when I sign in** to disable future automatic launches.

## Application updates

Packaged builds check the configured GitHub Releases page when TASKLINE starts and automatically download available updates. A downloaded update is installed when the app exits. Publishing a release requires `GH_TOKEN` and an electron-builder publish run; the GitHub provider configuration is in `package.json`.

## Features

- Prioritized task list, quick add, task editing, postpone/reschedule, and manual ordering. Completed tasks move to a separate section; a task can be completed once per local day, and unfinished tasks return to Active at the next local midnight.
- Adjustable interface size from 90% to 130%, saved locally in Settings.
- Month, week, and day calendar views. Drag calendar entries to another date; scheduled sessions and deadlines are tracked separately.
- Tasks remain single entries when completed; completion does not generate another task occurrence.
- Local statistics, task search/filtering, JSON task import/export, and SQLite backup/restore.
- Tray-resident hourly, deadline, scheduled-start, overdue, custom-reminder, daily-planning, and end-of-day notifications with persisted duplicate prevention.
- Monochromatic interface and keyboard shortcuts: `Ctrl+N` new task, `Ctrl+Shift+N` quick add, `Ctrl+K` search, `Ctrl+1/2/3` dashboard/calendar/statistics, and `Esc` close.

## Storage and privacy

SQLite is stored at Electron's `userData` location (normally `%APPDATA%\taskline\taskline.sqlite`). JSON exports and SQLite backups are written only to a location selected by the user. No task content is sent over the network.
