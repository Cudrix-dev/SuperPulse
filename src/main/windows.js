/**
 * Window factories for the splash screen and the main dashboard.
 *
 * Both windows rely on the Windows 11 system backdrop API (exposed by
 * Electron as `backgroundMaterial`): Acrylic for the transient splash,
 * Mica for the long-lived dashboard — exactly how Fluent Design assigns
 * the two materials. On older systems the renderer paints an opaque
 * fallback surface instead (see `data-material` in the CSS).
 */
'use strict';

const os = require('node:os');
const path = require('node:path');
const { BrowserWindow, screen, shell } = require('electron');

const ROOT_DIR = path.join(__dirname, '..', '..');
const RENDERER_DIR = path.join(ROOT_DIR, 'src', 'renderer');
const PRELOAD_DIR = path.join(ROOT_DIR, 'src', 'preload');
const ICON_PATH = path.join(ROOT_DIR, 'assets', 'icon.ico');

/** Height of the custom title bar; must match `--titlebar-height` in dashboard.css. */
const TITLEBAR_HEIGHT = 40;

/** Opaque colour painted behind the page when no system backdrop is available. */
const FALLBACK_BACKGROUND = '#15171d';

/**
 * Windows 11 22H2 (build 22621) introduced the DWM system-backdrop API that
 * `backgroundMaterial` depends on.
 * @returns {boolean}
 */
function supportsSystemBackdrop() {
  if (process.platform !== 'win32') return false;
  const build = Number.parseInt(os.release().split('.')[2] ?? '0', 10);
  return build >= 22621;
}

/**
 * Returns window bounds of the given size centred on the primary display's
 * work area (the monitor area excluding the taskbar).
 */
function centeredOnPrimary(width, height) {
  const { workArea } = screen.getPrimaryDisplay();
  const w = Math.min(width, workArea.width);
  const h = Math.min(height, workArea.height);
  return {
    width: w,
    height: h,
    x: Math.round(workArea.x + (workArea.width - w) / 2),
    y: Math.round(workArea.y + (workArea.height - h) / 2),
  };
}

/** Shared, locked-down renderer preferences. */
function secureWebPreferences(preloadFile, isDev = false) {
  return {
    preload: path.join(PRELOAD_DIR, preloadFile),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
    devTools: isDev,
  };
}

/**
 * The splash: frameless, non-resizable, centred on the primary monitor.
 * It starts fully transparent — the splash sequence fades it in.
 */
function createSplashWindow() {
  const material = supportsSystemBackdrop() ? 'acrylic' : 'none';

  const win = new BrowserWindow({
    ...centeredOnPrimary(440, 300),
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    roundedCorners: true,
    backgroundMaterial: material === 'none' ? undefined : material,
    backgroundColor: material === 'none' ? FALLBACK_BACKGROUND : '#00000000',
    icon: ICON_PATH,
    title: 'SuperPulse',
    webPreferences: secureWebPreferences('splash.js'),
  });

  win.loadFile(path.join(RENDERER_DIR, 'splash', 'index.html'), { query: { material } });
  return win;
}

/**
 * The dashboard: Mica backdrop with a custom, draggable title bar and the
 * native caption buttons drawn by Windows (Window Controls Overlay), which
 * keeps Snap Layouts working.
 */
function createDashboardWindow({ isDev = false } = {}) {
  const material = supportsSystemBackdrop() ? 'mica' : 'none';
  const { workArea } = screen.getPrimaryDisplay();

  const win = new BrowserWindow({
    ...centeredOnPrimary(
      Math.min(1240, workArea.width - 64),
      Math.min(820, workArea.height - 48),
    ),
    minWidth: 720,
    minHeight: 460,
    show: false,
    title: 'SuperPulse',
    icon: ICON_PATH,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#e8eaf0',
      height: TITLEBAR_HEIGHT,
    },
    backgroundMaterial: material === 'none' ? undefined : material,
    backgroundColor: material === 'none' ? FALLBACK_BACKGROUND : '#00000000',
    webPreferences: secureWebPreferences('dashboard.js', isDev),
  });

  win.loadFile(path.join(RENDERER_DIR, 'dashboard', 'index.html'), { query: { material } });
  return win;
}

/**
 * Prevents renderers from navigating away or opening new windows.
 * Plain https links are handed to the user's default browser instead.
 * @param {import('electron').WebContents} contents
 */
function hardenWebContents(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
}

/**
 * True when an IPC message comes from one of SuperPulse's own pages.
 * @param {import('electron').IpcMainEvent | import('electron').IpcMainInvokeEvent} event
 */
function isTrustedSender(event) {
  const url = event.senderFrame?.url ?? '';
  if (!url.startsWith('file://')) return false;
  try {
    const filePath = path.normalize(decodeURIComponent(new URL(url).pathname).replace(/^\/(\w:)/, '$1'));
    return filePath.toLowerCase().startsWith(path.normalize(RENDERER_DIR).toLowerCase());
  } catch {
    return false;
  }
}

module.exports = {
  createSplashWindow,
  createDashboardWindow,
  hardenWebContents,
  isTrustedSender,
  supportsSystemBackdrop,
};
