// Renders the layer list. Each layer: name, loop/playlist toggle, its tracks,
// a volume slider, mute and remove.

import * as files from '../storage/files.js';

const pct = (v) => `${Math.round(v * 100)}%`;

export function renderLayers(root, mixer, handlers) {
  root.replaceChildren();

  if (mixer.list().length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No layers yet. Add one to get started.';
    root.append(empty);
    return;
  }

  mixer.list().forEach((layer) => root.append(layerCard(layer, mixer, handlers)));
}

function layerCard(layer, mixer, handlers) {
  const card = el('section', 'layer');
  if (layer.error) card.classList.add('has-error');

  // --- header: name + remove
  const head = el('header', 'layer-head');
  const name = el('input', 'layer-name');
  name.value = layer.name;
  name.setAttribute('aria-label', 'Layer name');
  name.addEventListener('change', () => {
    layer.name = name.value.trim() || 'Layer';
    handlers.onDirty();
  });

  const kill = iconButton('Remove layer', '✕');
  kill.classList.add('danger');
  kill.addEventListener('click', () => handlers.onRemoveLayer(layer.id));

  head.append(name, kill);

  // --- mode toggle
  const modes = el('div', 'modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Playback mode');
  [['loop', 'Loop'], ['playlist', 'Playlist']].forEach(([value, label]) => {
    const b = el('button', 'mode');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(layer.mode === value));
    if (layer.mode === value) b.classList.add('on');
    b.addEventListener('click', () => {
      layer.setMode(value);
      handlers.onDirty();
    });
    modes.append(b);
  });

  const hint = el('p', 'hint');
  hint.textContent = layer.mode === 'loop'
    ? 'Plays the first track on repeat, forever.'
    : 'Plays through the tracks in order, then starts again.';

  // --- tracks
  const tracks = el('ul', 'tracks');
  if (layer.fileIds.length === 0) {
    const li = el('li', 'no-tracks');
    li.textContent = 'No tracks yet.';
    tracks.append(li);
  }
  layer.fileIds.forEach((fid, i) => {
    const meta = files.meta(fid);
    const li = el('li', 'track');
    if (i === layer.index && layer.fileIds.length > 1) li.classList.add('current');

    const label = el('span', 'track-name');
    label.textContent = meta ? meta.name : '(file missing)';
    if (!meta) label.classList.add('missing');

    const drop = iconButton(`Remove ${meta ? meta.name : 'track'} from layer`, '−');
    drop.addEventListener('click', () => handlers.onRemoveTrack(layer.id, i));

    li.append(label, drop);
    tracks.append(li);
  });

  const addTrack = el('button', 'add-track');
  addTrack.type = 'button';
  addTrack.textContent = layer.mode === 'loop' && layer.fileIds.length ? 'Change track' : '+ Add track';
  addTrack.addEventListener('click', () => handlers.onPickTrack(layer.id));

  // --- volume
  const volRow = el('div', 'vol');
  const slider = el('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.01';
  slider.value = String(layer.volume);
  slider.disabled = layer.muted;
  slider.setAttribute('aria-label', `${layer.name} volume`);
  const out = el('output', 'vol-out');
  out.textContent = layer.muted ? 'muted' : pct(layer.volume);
  slider.addEventListener('input', () => {
    layer.setVolume(Number(slider.value));
    out.textContent = pct(layer.volume);
    handlers.onLiveChange();
  });

  const mute = el('button', 'mute');
  mute.type = 'button';
  mute.textContent = layer.muted ? 'Unmute' : 'Mute';
  mute.setAttribute('aria-pressed', String(layer.muted));
  if (layer.muted) mute.classList.add('on');
  mute.addEventListener('click', () => {
    layer.setMuted(!layer.muted);
    handlers.onDirty();
  });

  volRow.append(slider, out, mute);

  card.append(head, modes, hint, tracks, addTrack, volRow);

  if (layer.error) {
    const err = el('p', 'error');
    err.textContent = layer.error;
    card.append(err);
  }

  return card;
}

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function iconButton(label, glyph) {
  const b = el('button', 'icon');
  b.type = 'button';
  b.textContent = glyph;
  b.title = label;
  b.setAttribute('aria-label', label);
  return b;
}
