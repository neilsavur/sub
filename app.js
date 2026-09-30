// Wires the mixer, the storage, and the UI together.

import { Mixer } from './audio/mixer.js';
import * as files from './storage/files.js';
import * as db from './storage/db.js';
import { renderLayers } from './ui/layerView.js';
import { createLibrary } from './ui/library.js';
import { createPresets } from './ui/presets.js';

const SESSION_KEY = 'layers.session';

const $ = (sel) => document.querySelector(sel);

const mixer = new Mixer();
let pickingForLayer = null;
let redrawQueued = false;

const layerRoot = $('#layers');
const playBtn = $('#play');
const masterSlider = $('#master');
const masterOut = $('#masterOut');
const statusLine = $('#status');
const storageLine = $('#storage');

const library = createLibrary({
  onPicked: (fileId) => attachTrack(fileId),
  onChanged: () => {
    draw();
    reportStorage();
  },
});

const presetSheet = createPresets({
  getSnapshot: () => mixer.snapshot(),
  onLoad: (preset) => loadPreset(preset),
});

// ---------------------------------------------------------------- rendering

// Anything the lock screen depends on runs synchronously. It must NOT sit behind
// requestAnimationFrame: rAF does not fire while the page is hidden, which is
// precisely the locked-screen case this app exists for — a track change would
// then never reach the now-playing controls.
function draw() {
  sync();
  scheduleList();
}

// Rebuilding the layer list replaces its DOM, so it is deferred and coalesced:
// doing it on every volume tick would rip the slider out from under your finger.
function scheduleList() {
  if (redrawQueued) return;
  redrawQueued = true;
  setTimeout(() => {
    redrawQueued = false;
    renderLayers(layerRoot, mixer, handlers);
  }, 0);
}

function sync() {
  updateTransport();
  updateMediaSession();
}

function updateTransport() {
  const hasAudio = mixer.list().some((l) => l.fileIds.length > 0);
  playBtn.disabled = !hasAudio;
  playBtn.textContent = mixer.playing ? 'Pause' : 'Play';
  playBtn.setAttribute('aria-pressed', String(mixer.playing));

  if (!hasAudio) {
    statusLine.textContent = 'Add a layer and give it a track.';
  } else if (mixer.playing) {
    const n = mixer.list().filter((l) => l.fileIds.length && !l.muted).length;
    statusLine.textContent = `Playing ${n} layer${n === 1 ? '' : 's'}. Safe to lock the phone.`;
  } else {
    statusLine.textContent = 'Ready.';
  }
}

const handlers = {
  onDirty: () => {
    saveSession();
    draw();
  },
  // Live slider drags: no list rebuild, or the slider is destroyed mid-gesture.
  onLiveChange: () => {
    saveSession();
    sync();
  },
  onRemoveLayer: (id) => {
    mixer.removeLayer(id);
    saveSession();
    draw();
  },
  onRemoveTrack: async (id, pos) => {
    const layer = mixer.layers.get(id);
    if (!layer) return;
    await layer.removeTrack(pos);
    saveSession();
    draw();
  },
  onPickTrack: (id) => {
    pickingForLayer = id;
    library.open({ picking: true });
  },
};

// ---------------------------------------------------------------- actions

$('#addLayer').addEventListener('click', () => {
  // Inside a gesture, so the context and the new element start out permitted.
  const n = mixer.list().length + 1;
  mixer.addLayer({ name: `Layer ${n}`, mode: n === 1 ? 'loop' : 'playlist' });
  saveSession();
  draw();
});

$('#openLibrary').addEventListener('click', () => library.open({ picking: false }));
$('#openPresets').addEventListener('click', () => presetSheet.open());

playBtn.addEventListener('click', async () => {
  await mixer.toggle();
  draw();
});

masterSlider.addEventListener('input', () => {
  mixer.masterVolume = Number(masterSlider.value);
  masterOut.textContent = `${Math.round(masterSlider.value * 100)}%`;
  saveSession();
});

async function attachTrack(fileId) {
  const layer = mixer.layers.get(pickingForLayer);
  pickingForLayer = null;
  if (!layer) return;

  if (layer.mode === 'loop') {
    await layer.setTracks([fileId]); // a loop layer holds exactly one track
  } else {
    await layer.addTrack(fileId);
  }

  // Still inside the activation from the tap that picked the file, so a layer
  // added mid-session can start without waiting for the next Play press.
  if (mixer.playing) await layer.play();

  saveSession();
  draw();
}

async function loadPreset(preset) {
  const wasPlaying = mixer.playing;
  mixer.pause();
  mixer.clear();
  for (const state of preset.layers) {
    const layer = mixer.addLayer(state);
    await layer.ready;
  }
  saveSession();
  draw();
  if (wasPlaying) {
    await mixer.play();
    draw();
  }
}

// ---------------------------------------------------------------- lock screen

function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const layer = mixer.nowPlayingLayer();
  const others = mixer.list().filter((l) => l.fileIds.length).length;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: (layer && layer.currentName) || 'Layers',
    artist: others > 1 ? `${others} layers mixed` : 'Single layer',
    album: layer && layer.mode === 'playlist' && layer.fileIds.length > 1
      ? `Track ${layer.index + 1} of ${layer.fileIds.length}`
      : 'Looping',
    artwork: [
      { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  });
  navigator.mediaSession.playbackState = mixer.playing ? 'playing' : 'paused';
}

function wireMediaSessionActions() {
  if (!('mediaSession' in navigator)) return;
  const set = (action, fn) => {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported action */ }
  };
  set('play', async () => {
    await mixer.play();
    draw();
  });
  set('pause', () => {
    mixer.pause();
    draw();
  });
  set('nexttrack', async () => {
    const layer = mixer.nowPlayingLayer();
    if (layer && layer.mode === 'playlist') await layer.advance();
    draw();
  });
}

// ---------------------------------------------------------------- persistence

function saveSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      master: mixer.masterVolume,
      layers: mixer.snapshot(),
    }));
  } catch { /* storage blocked; the session just will not be restored */ }
}

async function restoreSession() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch { /* corrupt; start fresh */ }
  if (!saved || !saved.layers || !saved.layers.length) return;

  // Creating the context here leaves it suspended until the first tap, which is
  // fine: the elements are only ever *played* from inside a gesture.
  for (const state of saved.layers) {
    const layer = mixer.addLayer(state);
    await layer.ready;
  }
  if (typeof saved.master === 'number') {
    mixer.masterVolume = saved.master;
    masterSlider.value = String(saved.master);
    masterOut.textContent = `${Math.round(saved.master * 100)}%`;
  }
}

async function reportStorage() {
  const info = await db.usage();
  if (!info || !info.quota) {
    storageLine.textContent = 'Audio is stored on this device. Keep your originals in the Files app.';
    return;
  }
  const usedMb = (info.used / 1048576).toFixed(0);
  const quotaMb = (info.quota / 1048576).toFixed(0);
  storageLine.textContent = `Using ${usedMb} MB of about ${quotaMb} MB on this device. iOS can clear this — keep your originals in the Files app.`;
}

// ---------------------------------------------------------------- boot

mixer.onchange = draw;

(async function boot() {
  await files.load();
  await restoreSession();
  wireMediaSessionActions();
  draw();
  reportStorage();
  db.requestPersistence();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ });
  }
})();
