// One layer: a media element -> gain -> master. Either loops a single track or
// walks a playlist.
//
// Two things here are load-bearing on iOS and should not be "simplified":
//
// 1. HTMLAudioElement + createMediaElementSource, not AudioBufferSourceNode.
//    iOS ties background playback and the now-playing session to a real media
//    element; a pure buffer graph often gets no lock-screen presence at all.
//
// 2. ONE element per layer, reused for every track via `src` swapping. iOS grants
//    playback permission to an element once it has played inside a user gesture.
//    A fresh element created later — e.g. while the screen is locked — would be
//    blocked. Verified on-device: rollover to the next track works while locked.

import * as files from '../storage/files.js';

let seq = 0;

export class Layer {
  constructor(ctx, destination, state = {}) {
    this.id = state.id || `l_${++seq}_${Math.random().toString(36).slice(2, 6)}`;
    this.ctx = ctx;
    this.name = state.name || 'Layer';
    this.mode = state.mode === 'playlist' ? 'playlist' : 'loop';
    this.fileIds = state.fileIds ? [...state.fileIds] : [];
    this.volume = typeof state.volume === 'number' ? state.volume : 0.6;
    this.muted = !!state.muted;
    this.index = 0;
    this.error = null;
    this.onchange = () => {};

    this.el = new Audio();
    this.el.preload = 'metadata';
    this.el.playsInline = true;
    this.el.loop = this.mode === 'loop';

    this.gain = ctx.createGain();
    this.gain.gain.value = this.muted ? 0 : this.volume;
    this.source = ctx.createMediaElementSource(this.el);
    this.source.connect(this.gain).connect(destination);

    this.el.addEventListener('ended', () => this.advance());
    this.el.addEventListener('error', () => {
      const code = this.el.error && this.el.error.code;
      this.error = code === 4 ? 'Format not supported' : code === 3 ? 'Could not decode' : 'Load failed';
      this.onchange();
    });
    this.el.addEventListener('loadedmetadata', () => {
      this.error = null;
      this.onchange();
    });

    this.ready = this.setTracks(this.fileIds);
  }

  get currentFileId() {
    return this.fileIds[this.index] || null;
  }

  get currentName() {
    const m = this.currentFileId && files.meta(this.currentFileId);
    return m ? m.name : '';
  }

  async setTracks(fileIds) {
    this.fileIds = [...fileIds];
    if (this.index >= this.fileIds.length) this.index = 0;
    await this.loadCurrent();
    this.onchange();
  }

  async addTrack(fileId) {
    this.fileIds.push(fileId);
    if (this.fileIds.length === 1) await this.loadCurrent();
    this.onchange();
  }

  async removeTrack(pos) {
    const wasCurrent = pos === this.index;
    this.fileIds.splice(pos, 1);
    if (this.index >= this.fileIds.length) this.index = 0;
    if (wasCurrent) await this.loadCurrent();
    this.onchange();
  }

  async loadCurrent() {
    const id = this.currentFileId;
    if (!id) {
      this.el.removeAttribute('src');
      this.el.load();
      return;
    }
    const src = await files.url(id);
    if (!src) {
      this.error = 'File missing from storage';
      this.onchange();
      return;
    }
    this.el.src = src;
  }

  setMode(mode) {
    this.mode = mode === 'playlist' ? 'playlist' : 'loop';
    this.el.loop = this.mode === 'loop';
    this.onchange();
  }

  // Deliberately does not fire onchange: this runs on every slider tick, and the
  // view updates its own readout. Firing here would rebuild the list mid-drag.
  setVolume(v) {
    this.volume = v;
    if (!this.muted) this.gain.gain.value = v;
  }

  setMuted(m) {
    this.muted = m;
    this.gain.gain.value = m ? 0 : this.volume;
    this.onchange();
  }

  // The one place track progression is decided. If a future iOS regression breaks
  // advancing while locked, this is the single method to swap for pre-scheduled
  // sources or a pre-concatenated buffer.
  async advance() {
    if (this.mode !== 'playlist' || this.fileIds.length === 0) return;
    this.index = (this.index + 1) % this.fileIds.length;
    await this.loadCurrent();
    try {
      await this.el.play();
    } catch (e) {
      this.error = `Could not start next track: ${e.name}`;
    }
    this.onchange();
  }

  async play() {
    if (!this.currentFileId) return;
    try {
      await this.el.play();
      this.error = null;
    } catch (e) {
      this.error = e.name === 'NotAllowedError' ? 'Blocked — press play again' : `Playback failed: ${e.name}`;
    }
    this.onchange();
  }

  pause() {
    this.el.pause();
  }

  dispose() {
    this.el.pause();
    this.el.removeAttribute('src');
    try { this.source.disconnect(); } catch { /* already gone */ }
    try { this.gain.disconnect(); } catch { /* already gone */ }
  }

  snapshot() {
    return {
      id: this.id,
      name: this.name,
      mode: this.mode,
      fileIds: [...this.fileIds],
      volume: this.volume,
      muted: this.muted,
    };
  }
}
