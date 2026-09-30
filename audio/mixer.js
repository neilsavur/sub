// Owns the single AudioContext and the master bus. Layers are entries in a Map,
// so adding one is just another node chain — there is no cap on layer count.

import { Layer } from './layer.js';

export class Mixer {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.layers = new Map(); // id -> Layer
    this.playing = false;
    this.onchange = () => {};
  }

  // Must be called from inside a user gesture: iOS will not start a context otherwise.
  ensureContext() {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.ctx.destination);

    // iOS 17.5+: marks this as a playback session so the context is not suspended
    // in the background. Feature-detected — absent on desktop and older iOS.
    if ('audioSession' in navigator) {
      try { navigator.audioSession.type = 'playback'; } catch { /* non-fatal */ }
    }

    this.ctx.addEventListener('statechange', () => this.onchange());
    return this.ctx;
  }

  async resume() {
    this.ensureContext();
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* reported via statechange */ }
    }
  }

  get masterVolume() {
    return this.master ? this.master.gain.value : 1;
  }

  set masterVolume(v) {
    this.ensureContext();
    this.master.gain.value = v;
  }

  // Call from a click handler. The Layer builds its media element here so that the
  // element gets its first play() inside the gesture and stays allowed to start
  // later on its own — including while the screen is locked.
  addLayer(state = {}) {
    this.ensureContext();
    const layer = new Layer(this.ctx, this.master, state);
    this.layers.set(layer.id, layer);
    layer.onchange = () => this.onchange();
    this.onchange();
    return layer;
  }

  removeLayer(id) {
    const layer = this.layers.get(id);
    if (!layer) return;
    layer.dispose();
    this.layers.delete(id);
    if (this.list().length === 0) this.playing = false;
    this.onchange();
  }

  list() {
    return [...this.layers.values()];
  }

  clear() {
    this.list().forEach((l) => l.dispose());
    this.layers.clear();
    this.playing = false;
    this.onchange();
  }

  async play() {
    await this.resume();
    await Promise.all(this.list().map((l) => l.play()));
    this.playing = true;
    this.onchange();
  }

  pause() {
    this.list().forEach((l) => l.pause());
    this.playing = false;
    this.onchange();
  }

  async toggle() {
    if (this.playing) this.pause();
    else await this.play();
  }

  // The layer whose track name drives lock-screen metadata: the first playlist
  // layer that has tracks, since that is the one that actually changes.
  nowPlayingLayer() {
    const layers = this.list().filter((l) => l.fileIds.length > 0);
    return layers.find((l) => l.mode === 'playlist') || layers[0] || null;
  }

  snapshot() {
    return this.list().map((l) => l.snapshot());
  }
}
