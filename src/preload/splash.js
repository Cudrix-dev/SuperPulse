/**
 * Splash preload — exposes the minimal API the splash page needs.
 * Runs sandboxed with context isolation; nothing from Node leaks through.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The start signal is captured as soon as the preload runs, so it can never
// be missed even if the page script subscribes slightly later.
let startPayload = null;
let startCallback = null;

ipcRenderer.once('splash:start', (_event, payload) => {
  startPayload = payload;
  startCallback?.(payload);
});

contextBridge.exposeInMainWorld('superpulse', {
  /** Resolves with `{ name, version }`. */
  getAppInfo: () => ipcRenderer.invoke('app:info'),

  /** Called once when the main process starts the splash timeline. */
  onStart: (callback) => {
    startCallback = callback;
    if (startPayload) callback(startPayload);
  },
});
