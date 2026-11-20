/**
 * Splash controller.
 *
 * The animation is pure CSS; this script only applies the timeline sent by
 * the main process (so window-opacity and CSS phases stay in lock-step)
 * and fills in the version label.
 */

const api = window.superpulse;
const root = document.documentElement;

root.dataset.material = new URLSearchParams(location.search).get('material') ?? 'none';

api
  .getAppInfo()
  .then(({ version }) => {
    document.getElementById('version').textContent = `v${version}`;
  })
  .catch(() => {
    /* The version label is decorative; ignore failures. */
  });

api.onStart(({ timeline }) => {
  const { enterEnd, pulseEnd, total } = timeline;
  const set = (name, ms) => root.style.setProperty(name, `${ms}ms`);

  set('--t-enter', enterEnd);
  set('--t-pulse-start', enterEnd);
  set('--t-pulse', pulseEnd - enterEnd);
  set('--t-exit-start', pulseEnd);
  set('--t-exit', total - pulseEnd);

  root.classList.add('is-playing');
});
