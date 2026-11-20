/**
 * SuperPulse — main process entry point.
 *
 * Responsibilities:
 *   1. Enforce a single running instance.
 *   2. Start the hardware metrics service as early as possible so the
 *      dashboard has data the moment it becomes visible.
 *   3. Run the 2-second splash sequence, then hand over to the dashboard.
 */
'use strict';

const { app, nativeTheme, Menu } = require('electron');

const { createSplashWindow, createDashboardWindow, hardenWebContents } = require('./windows');
const { runSplashSequence } = require('./splash-sequence');
const { MetricsService } = require('./metrics');
const { registerIpc } = require('./ipc');

const isDev = process.argv.includes('--dev');
/** Logs measured splash timings; enabled by --dev or SUPERPULSE_TRACE=1. */
const traceTimeline = isDev || process.env.SUPERPULSE_TRACE === '1';

/** @type {import('electron').BrowserWindow | null} */
let dashboardWindow = null;
let splashFinished = false;

// ---------------------------------------------------------------------------
// Single instance: a second launch simply focuses the existing dashboard.
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!dashboardWindow || dashboardWindow.isDestroyed()) return;
    if (dashboardWindow.isMinimized()) dashboardWindow.restore();
    if (splashFinished) dashboardWindow.show();
    dashboardWindow.focus();
  });

  bootstrap();
}

function bootstrap() {
  // Groups taskbar entries and must match `appId` in electron-builder.yml.
  app.setAppUserModelId('com.cudrix.superpulse');

  // Every window has its own custom chrome — no default menu bar needed.
  Menu.setApplicationMenu(null);

  // Protect every web contents created by the app (navigation, popups).
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));

  const metrics = new MetricsService();

  app.whenReady().then(async () => {
    // SuperPulse is designed as a dark-first experience.
    nativeTheme.themeSource = 'dark';

    registerIpc({ metrics, getDashboard: () => dashboardWindow });

    // Begin cheap sampling immediately so history is populated during the
    // splash; the GPU / storage collectors wait until the splash is done.
    metrics.start({ deferHeavy: true });

    // The dashboard loads hidden in the background while the splash plays.
    dashboardWindow = createDashboardWindow({ isDev });
    const splashWindow = createSplashWindow();

    dashboardWindow.on('minimize', () => metrics.setActive(false));
    dashboardWindow.on('restore', () => metrics.setActive(true));
    dashboardWindow.on('closed', () => {
      dashboardWindow = null;
    });

    // In development, a reload (Ctrl+R) must re-trigger the entrance animation.
    dashboardWindow.webContents.on('did-finish-load', () => {
      if (splashFinished) dashboardWindow?.webContents.send('dashboard:reveal');
    });

    await runSplashSequence({ splash: splashWindow, dashboard: dashboardWindow, trace: traceTimeline });
    splashFinished = true;
    metrics.startHeavy();

    if (isDev && dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => metrics.stop());
}
