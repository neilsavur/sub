// The audio library: uploaded files held as Blobs in IndexedDB, with object URLs
// minted lazily and cached so the same file used by two layers costs one URL.

import * as db from './db.js';

const urlCache = new Map(); // fileId -> object URL
let index = new Map();      // fileId -> metadata (no blob)

export async function load() {
  const rows = await db.getAll('files');
  index = new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, size: r.size, type: r.type, addedAt: r.addedAt }]));
  return list();
}

export function list() {
  return [...index.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function meta(id) {
  return index.get(id) || null;
}

export async function add(file) {
  const id = `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    name: file.name,
    size: file.size,
    type: file.type || '',
    addedAt: Date.now(),
    blob: file,
  };
  await db.put('files', record);
  index.set(id, { id, name: record.name, size: record.size, type: record.type, addedAt: record.addedAt });
  return index.get(id);
}

export async function remove(id) {
  await db.del('files', id);
  index.delete(id);
  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
}

export async function url(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const record = await db.get('files', id);
  if (!record) return null;
  const u = URL.createObjectURL(record.blob);
  urlCache.set(id, u);
  return u;
}

export function revokeAll() {
  urlCache.forEach(URL.revokeObjectURL);
  urlCache.clear();
}
