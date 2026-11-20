/**
 * Orchestrates the 2-second splash → dashboard hand-over.
 *
 *   0 ms ─────── 500 ms ───────────────── 1600 ms ─────── 2000 ms
 *   │  enter    │        pulse            │   exit / crossfade  │
 *   │ fade-in + │  glowing pulse beats    │ splash fades out,   │
 *   │ scale/    │                         │ dashboard fades in  │
 *   │ slide     │                         │                     │
 *
 * The renderer plays the matching CSS keyframes (it receives the same
 * timeline over IPC), while this module animates the native window opacity
 * so the Acrylic/Mica backdrops fade together with the page content.
 * Every phase is scheduled against one shared start time, so timer jitter
 * never accumulates and the splash closes at 2000 ms.
 */
'use strict';

/** Splash timeline in milliseconds (all values are offsets from t0). */
const TIMELINE = Object.freeze({
  enterEnd: 500,
  pulseEnd: 1600,
  total: 2000,
});

const FRAME_MS = 1000 / 60;

/**
 * Windows timers tick every ~15.6 ms by default, so a setTimeout can fire up
 * to one tick late. Inside this window before a deadline we poll with
 * setImmediate instead (a brief spin, once per phase), which lands each
 * phase boundary — and the final 2000 ms hand-over — within ~1 ms.
 */
const PRECISION_WINDOW_MS = 20;

/** Schedules `fn` for `deadline` (a performance.now() timestamp) with ~1 ms accuracy. */
function scheduleAt(deadline, fn, maxDelay = Infinity) {
  const remaining = deadline - now();
  if (remaining <= PRECISION_WINDOW_MS) {
    setImmediate(fn);
  } else {
    setTimeout(fn, Math.min(maxDelay, remaining - PRECISION_WINDOW_MS));
  }
}

/** Fluent "decelerate" and "accelerate" curves, approximated as easing functions. */
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

const now = () => performance.now();
const alive = (win) => Boolean(win) && !win.isDestroyed();

/** Resolves once `ms` (an absolute performance.now() timestamp) is reached. */
function waitUntil(timestamp) {
  return new Promise((resolve) => {
    const check = () => (now() >= timestamp ? resolve() : scheduleAt(timestamp, check));
    check();
  });
}

function onceReadyToShow(win) {
  return new Promise((resolve) => {
    if (!alive(win)) return resolve();
    win.once('ready-to-show', resolve);
    win.once('closed', resolve);
  });
}

/**
 * Animates a window's opacity between two absolute timestamps.
 * @param {import('electron').BrowserWindow} win
 * @param {{from: number, to: number, start: number, end: number, ease?: (t:number)=>number}} opts
 */
function animateOpacity(win, { from, to, start, end, ease = easeInOutSine }) {
  return new Promise((resolve) => {
    const duration = Math.max(1, end - start);
    let lastFrame = -Infinity;
    const tick = () => {
      if (!alive(win)) return resolve();
      const t = now();
      const progress = Math.min(1, Math.max(0, (t - start) / duration));
      // While polling near the deadline, only touch the window once per frame
      // (and always on the final value).
      if (progress >= 1 || t - lastFrame >= FRAME_MS - 1) {
        win.setOpacity(from + (to - from) * ease(progress));
        lastFrame = t;
      }
      if (progress >= 1) return resolve();
      // Regular frames use timers; only the last ~20 ms poll precisely.
      scheduleAt(end, tick, FRAME_MS);
    };
    tick();
  });
}

/**
 * Plays the splash and reveals the dashboard. Resolves when the splash
 * window has been destroyed.
 * @param {{splash: import('electron').BrowserWindow, dashboard: import('electron').BrowserWindow, trace?: boolean}} options
 *   `trace` logs the measured phase timings (used with `npm run dev`).
 */
async function runSplashSequence({ splash, dashboard, trace = false }) {
  const dashboardReady = onceReadyToShow(dashboard);
  await onceReadyToShow(splash);

  if (!alive(splash)) {
    // The splash failed to load; never leave the user without a window.
    if (alive(dashboard)) dashboard.show();
    return;
  }

  // ── t0: entrance ──────────────────────────────────────────────────────
  splash.setOpacity(0);
  splash.show();
  const t0 = now();
  splash.webContents.send('splash:start', { timeline: TIMELINE });

  await animateOpacity(splash, {
    from: 0,
    to: 1,
    start: t0,
    end: t0 + TIMELINE.enterEnd,
    ease: easeOutCubic,
  });

  // ── 500–1600 ms: the renderer plays the glowing pulse ─────────────────
  await waitUntil(t0 + TIMELINE.pulseEnd);
  await dashboardReady; // Normally resolved long before this point.

  // ── 1600–2000 ms: crossfade into the dashboard ────────────────────────
  if (alive(dashboard)) {
    dashboard.setOpacity(0);
    dashboard.show();
    dashboard.webContents.send('dashboard:reveal');
    if (alive(splash)) splash.moveTop(); // Keep the fading splash above.
  }

  // Progress is computed against the scheduled timestamps (not "now"), so a
  // late timer only skips a frame instead of pushing the whole exit back.
  const exitStart = t0 + TIMELINE.pulseEnd;
  const exitEnd = t0 + TIMELINE.total;
  const exitBegan = now();
  await Promise.all([
    animateOpacity(splash, { from: 1, to: 0, start: exitStart, end: exitEnd }),
    animateOpacity(dashboard, { from: 0, to: 1, start: exitStart, end: exitEnd }),
  ]);
  const handedOver = now(); // splash fully transparent, dashboard fully opaque

  if (alive(splash)) splash.destroy();
  if (alive(dashboard)) {
    dashboard.setOpacity(1);
    dashboard.focus();
  }

  if (trace) {
    const ms = (t) => `${Math.round(t - t0)} ms`;
    console.log(
      `[splash] crossfade began ${ms(exitBegan)} · hand-over complete ${ms(handedOver)} · window destroyed ${ms(now())}`,
    );
  }
}

module.exports = { runSplashSequence, TIMELINE };
