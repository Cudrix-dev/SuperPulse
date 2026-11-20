/**
 * IPC bridge between the main process and SuperPulse's renderers.
 *
 * Channels
 *   invoke  app:info          → { name, version }
 *   invoke  metrics:static    → static hardware description
 *   invoke  metrics:snapshot  → latest live snapshot
 *   push    metrics:update    → live snapshot, once per second
 *   push    splash:start      → splash timeline (see splash-sequence.js)
 *   push    dashboard:reveal  → dashboard entrance animation trigger
 */
'use strict';

const { app, ipcMain } = require('electron');
const { isTrustedSender } = require('./windows');

/**
 * @param {{ metrics: import('./metrics').MetricsService,
 *           getDashboard: () => import('electron').BrowserWindow | null }} deps
 */
function registerIpc({ metrics, getDashboard }) {
  /** Wraps a handler so only SuperPulse's own pages can call it. */
  const guarded = (handler) => (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return handler(...args);
  };

  ipcMain.handle('app:info', guarded(() => ({ name: app.getName(), version: app.getVersion() })));
  ipcMain.handle('metrics:static', guarded(() => metrics.getStaticInfo()));
  ipcMain.handle('metrics:snapshot', guarded(() => metrics.snapshot));

  metrics.on('update', (snapshot) => {
    const win = getDashboard();
    if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
      win.webContents.send('metrics:update', snapshot);
    }
  });
}

module.exports = { registerIpc };
