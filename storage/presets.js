// A preset is a named snapshot of the layer setup: which files, loop vs playlist,
// volumes, mute states, order. Audio itself stays in the files store.

import * as db from './db.js';

export async function list() {
  const rows = await db.getAll('presets');
  return rows.sort((a, b) => b.savedAt - a.savedAt);
}

export async function save(name, layers) {
  const id = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const preset = {
    id,
    name,
    savedAt: Date.now(),
    layers: layers.map((l) => ({
      name: l.name,
      mode: l.mode,
      fileIds: [...l.fileIds],
      volume: l.volume,
      muted: l.muted,
    })),
  };
  await db.put('presets', preset);
  return preset;
}

export const get = (id) => db.get('presets', id);
export const remove = (id) => db.del('presets', id);
