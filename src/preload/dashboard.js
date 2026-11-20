/**
 * Dashboard preload — a narrow, typed bridge to the metrics service.
 * Runs sandboxed with context isolation; nothing from Node leaks through.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** Subscribes to a push channel and returns an unsubscribe function. */
function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('superpulse', {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  getStaticInfo: () => ipcRenderer.invoke('metrics:static'),
  getSnapshot: () => ipcRenderer.invoke('metrics:snapshot'),
  onMetrics: (callback) => subscribe('metrics:update', callback),
  onReveal: (callback) => subscribe('dashboard:reveal', callback),
});
