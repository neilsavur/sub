// Lock-screen spike: two layers mixed through one AudioContext.
// Layer 1 loops a single file. Layer 2 is a 2-track playlist that advances on `ended`.
// Everything interesting is written to the on-screen log with wall-clock timestamps,
// because the whole point is reading back what happened while the screen was off.

const $ = (id) => document.getElementById(id);

const els = {
  loopFile: $('loopFile'),
  loopVol: $('loopVol'),
  loopVolOut: $('loopVolOut'),
  listFiles: $('listFiles'),
  listVol: $('listVol'),
  listVolOut: $('listVolOut'),
  play: $('play'),
  stop: $('stop'),
  status: $('status'),
  log: $('log'),
  copyLog: $('copyLog'),
};

// ---------------------------------------------------------------- logging

const LOG_KEY = 'spike.log';
let logLines = [];

try {
  const saved = sessionStorage.getItem(LOG_KEY);
  if (saved) logLines = JSON.parse(saved);
} catch { /* private mode or blocked storage — log stays in memory only */ }

function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function log(msg, kind = '') {
  logLines.push({ t: stamp(), msg, kind });
  if (logLines.length > 600) logLines.splice(0, logLines.length - 600);
  try { sessionStorage.setItem(LOG_KEY, JSON.stringify(logLines)); } catch { /* ignore */ }
  render();
}

function render() {
  const atBottom = els.log.scrollTop + els.log.clientHeight >= els.log.scrollHeight - 20;
  els.log.innerHTML = logLines
    .map((l) => `<div><span class="t">${l.t}</span> <span class="${l.kind}">${escapeHtml(l.msg)}</span></div>`)
    .join('');
  if (atBottom) els.log.scrollTop = els.log.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

render();
log(`page loaded — ${navigator.userAgent}`);
log(`standalone: ${window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true}`);

els.copyLog.addEventListener('click', async () => {
  const text = logLines.map((l) => `${l.t} ${l.msg}`).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    els.copyLog.textContent = 'Copied';
    setTimeout(() => { els.copyLog.textContent = 'Copy'; }, 1500);
  } catch {
    log('clipboard blocked — select the log text manually', 'bad');
  }
});

// ---------------------------------------------------------------- audio graph

let ctx = null;
let master = null;
let heartbeat = null;

// Each layer reuses ONE HTMLAudioElement for its whole life. iOS grants playback
// permission to an element once it has played inside a user gesture; swapping `src`
// on that same element keeps the permission, whereas a fresh element created later
// (e.g. while locked) would not be allowed to start.
const layers = {
  loop: { el: null, src: null, gain: null, url: null },
  list: { el: null, src: null, gain: null, urls: [], names: [], index: 0 },
};

function buildContext() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  log(`AudioContext created — state=${ctx.state}, rate=${ctx.sampleRate}`);

  // iOS 17.5+: declares this as a playback session so the context is not suspended
  // when the app goes to the background. Absent on desktop and older iOS.
  if ('audioSession' in navigator) {
    try {
      navigator.audioSession.type = 'playback';
      log(`navigator.audioSession.type = ${navigator.audioSession.type}`, 'ok');
    } catch (e) {
      log(`audioSession set failed: ${e}`, 'bad');
    }
  } else {
    log('navigator.audioSession not supported on this browser', 'bad');
  }

  ctx.addEventListener('statechange', () => log(`ctx.statechange -> ${ctx.state}`, ctx.state === 'running' ? 'ok' : 'bad'));
}

function attach(layerKey, audioEl) {
  const layer = layers[layerKey];
  layer.el = audioEl;
  layer.gain = ctx.createGain();
  layer.gain.gain.value = Number(layerKey === 'loop' ? els.loopVol.value : els.listVol.value);
  layer.src = ctx.createMediaElementSource(audioEl);
  layer.src.connect(layer.gain).connect(master);
  log(`layer "${layerKey}" wired: element -> gain(${layer.gain.gain.value.toFixed(2)}) -> master`);
}

function makeElement(tag) {
  const el = new Audio();
  el.preload = 'metadata';
  el.playsInline = true;
  const MEDIA_ERR = {
    1: 'ABORTED — load cancelled',
    2: 'NETWORK — transfer failed mid-load',
    3: 'DECODE — file is corrupt, or truncated by low memory',
    4: 'SRC_NOT_SUPPORTED — this browser cannot decode this format',
  };
  const events = ['loadedmetadata', 'canplay', 'play', 'pause', 'ended', 'stalled', 'waiting', 'error', 'suspend'];
  events.forEach((ev) => {
    el.addEventListener(ev, () => {
      let extra = '';
      if (ev === 'error' && el.error) extra = ` — ${MEDIA_ERR[el.error.code] || el.error.code}`;
      if (ev === 'loadedmetadata') extra = ` — duration ${fmtDuration(el.duration)}`;
      log(`[${tag}] ${ev}${extra} @ ${el.currentTime.toFixed(1)}s`, ev === 'error' ? 'bad' : '');
    });
  });
  return el;
}

// ---------------------------------------------------------------- file inputs

els.loopFile.addEventListener('change', () => {
  const f = els.loopFile.files[0];
  if (!f) return;
  if (layers.loop.url) URL.revokeObjectURL(layers.loop.url);
  layers.loop.url = URL.createObjectURL(f);
  describe('loop', f);
  updateStatus();
});

els.listFiles.addEventListener('change', () => {
  const files = [...els.listFiles.files];
  layers.list.urls.forEach(URL.revokeObjectURL);
  layers.list.urls = files.map((f) => URL.createObjectURL(f));
  layers.list.names = files.map((f) => f.name);
  layers.list.index = 0;
  files.forEach((f) => describe('list', f));
  if (files.length < 2) log('pick two files for the playlist layer — rollover needs a next track', 'bad');
  updateStatus();
});

function fmtDuration(d) {
  if (!isFinite(d)) return 'unknown';
  return `${Math.floor(d / 60)}m ${String(Math.round(d % 60)).padStart(2, '0')}s`;
}

// Report what we actually got. On iOS the picker hands back files with an empty
// MIME type surprisingly often, and oversized files are the usual failure cause.
function describe(tag, f) {
  const mb = f.size / 1048576;
  log(`[${tag}] picked "${f.name}" — ${mb.toFixed(1)} MB, type "${f.type || '(none reported)'}"`);
  if (mb > 60) {
    log(`[${tag}] that file is large; iOS may run out of memory decoding it. Re-encode to ~128 kbps MP3 if it fails.`, 'bad');
  }
  const probe = new Audio();
  probe.preload = 'metadata';
  probe.addEventListener('loadedmetadata', () => {
    log(`[${tag}] "${f.name}" is decodable — duration ${fmtDuration(probe.duration)}`, 'ok');
    URL.revokeObjectURL(probe.src);
  });
  probe.addEventListener('error', () => {
    log(`[${tag}] "${f.name}" FAILED to load before playback even started (code ${probe.error && probe.error.code})`, 'bad');
    URL.revokeObjectURL(probe.src);
  });
  probe.src = URL.createObjectURL(f);
}

function updateStatus() {
  const ready = layers.loop.url && layers.list.urls.length >= 2;
  els.status.textContent = ready
    ? 'Ready. Press Play, then lock the phone.'
    : 'Pick a loop file and two playlist files.';
}

// ---------------------------------------------------------------- volume

els.loopVol.addEventListener('input', () => {
  els.loopVolOut.textContent = `${Math.round(els.loopVol.value * 100)}%`;
  if (layers.loop.gain) layers.loop.gain.gain.value = Number(els.loopVol.value);
});

els.listVol.addEventListener('input', () => {
  els.listVolOut.textContent = `${Math.round(els.listVol.value * 100)}%`;
  if (layers.list.gain) layers.list.gain.gain.value = Number(els.listVol.value);
});

// ---------------------------------------------------------------- transport

els.play.addEventListener('click', async () => {
  if (!layers.loop.url || layers.list.urls.length < 2) {
    log('need 1 loop file + 2 playlist files before playing', 'bad');
    return;
  }

  buildContext();

  if (ctx.state !== 'running') {
    await ctx.resume();
    log(`ctx.resume() -> ${ctx.state}`, ctx.state === 'running' ? 'ok' : 'bad');
  }

  if (!layers.loop.el) {
    attach('loop', makeElement('loop'));
    layers.loop.el.loop = true;
  }
  if (!layers.list.el) {
    attach('list', makeElement('list'));
    layers.list.el.addEventListener('ended', advance);
  }

  layers.loop.el.src = layers.loop.url;
  layers.list.index = 0;
  layers.list.el.src = layers.list.urls[0];

  await start(layers.loop.el, 'loop');
  await start(layers.list.el, 'list');

  setMetadata();
  startHeartbeat();

  els.play.disabled = true;
  els.stop.disabled = false;
  els.status.textContent = 'Playing. Lock the phone now and wait for track 1 to end.';
});

els.stop.addEventListener('click', () => {
  stopHeartbeat();
  [layers.loop.el, layers.list.el].forEach((el) => { if (el) el.pause(); });
  log('stopped by user');
  els.play.disabled = false;
  els.stop.disabled = true;
  els.status.textContent = 'Stopped.';
});

async function start(el, tag) {
  try {
    await el.play();
    log(`[${tag}] play() resolved`, 'ok');
  } catch (e) {
    log(`[${tag}] play() REJECTED: ${e.name} — ${e.message}`, 'bad');
  }
}

// The moment under test: this fires while the screen is off, or it does not.
async function advance() {
  const L = layers.list;
  L.index = (L.index + 1) % L.urls.length;
  log(`[list] ADVANCING to track ${L.index + 1}: ${L.names[L.index]}`, 'ok');
  L.el.src = L.urls[L.index];
  await start(L.el, 'list');
  setMetadata();
}

function setMetadata() {
  if (!('mediaSession' in navigator)) {
    log('mediaSession not supported', 'bad');
    return;
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: layers.list.names[layers.list.index] || 'Layer 2',
    artist: 'Subliminal + Music spike',
    album: `track ${layers.list.index + 1} of ${layers.list.urls.length}`,
  });
  navigator.mediaSession.playbackState = 'playing';
  navigator.mediaSession.setActionHandler('play', () => {
    log('mediaSession: play from lock screen', 'ok');
    [layers.loop.el, layers.list.el].forEach((el) => el && el.play().catch((e) => log(`resume failed: ${e}`, 'bad')));
    navigator.mediaSession.playbackState = 'playing';
  });
  navigator.mediaSession.setActionHandler('pause', () => {
    log('mediaSession: pause from lock screen', 'ok');
    [layers.loop.el, layers.list.el].forEach((el) => el && el.pause());
    navigator.mediaSession.playbackState = 'paused';
  });
}

// ---------------------------------------------------------------- heartbeat

// Timer throttling while locked is itself a result worth recording: if the heartbeat
// stops and then floods on unlock, JS was frozen and any `ended` handler was too.
function startHeartbeat() {
  stopHeartbeat();
  heartbeat = setInterval(() => {
    const L = layers.list;
    const loopT = layers.loop.el ? layers.loop.el.currentTime.toFixed(1) : '-';
    const listT = L.el ? L.el.currentTime.toFixed(1) : '-';
    const dur = L.el && isFinite(L.el.duration) ? L.el.duration.toFixed(1) : '?';
    log(`beat ctx=${ctx.state} loop=${loopT}s list=${listT}/${dur}s track=${L.index + 1}`);
  }, 1000);
}

function stopHeartbeat() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}

document.addEventListener('visibilitychange', () => {
  log(`visibilitychange -> ${document.visibilityState}`, document.visibilityState === 'visible' ? 'ok' : '');
});
window.addEventListener('pagehide', () => log('pagehide', 'bad'));
window.addEventListener('freeze', () => log('page FROZEN by the browser', 'bad'));
window.addEventListener('resume', () => log('page resumed from frozen', 'ok'));

updateStatus();
