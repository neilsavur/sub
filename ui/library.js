// The audio library sheet: pick an existing file for a layer, upload new ones,
// or delete files you no longer want taking up storage.

import * as files from '../storage/files.js';

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

export function createLibrary({ onPicked, onChanged }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'sheet';
  dialog.innerHTML = `
    <form method="dialog" class="sheet-head">
      <h2>Audio library</h2>
      <button class="icon" value="cancel" aria-label="Close">✕</button>
    </form>
    <p class="sheet-sub"></p>
    <label class="upload">
      <input type="file" multiple hidden>
      <span>Upload audio files</span>
    </label>
    <ul class="library"></ul>
  `;

  const sub = dialog.querySelector('.sheet-sub');
  const input = dialog.querySelector('input[type=file]');
  const list = dialog.querySelector('.library');
  let pickMode = false;

  // No accept filter: the iOS Files picker greys out files whose type it does not
  // recognise, which blocks perfectly valid m4a/aiff/wav sources. Validate after.
  input.addEventListener('change', async () => {
    const chosen = [...input.files];
    input.value = '';
    if (!chosen.length) return;
    sub.textContent = `Adding ${chosen.length} file${chosen.length > 1 ? 's' : ''}…`;
    for (const f of chosen) {
      const ok = await isPlayable(f);
      if (!ok) {
        sub.textContent = `"${f.name}" could not be decoded and was skipped.`;
        continue;
      }
      await files.add(f);
    }
    sub.textContent = defaultSub();
    draw();
    onChanged();
  });

  function defaultSub() {
    return pickMode ? 'Tap a file to add it to the layer.' : 'Files are stored on this device.';
  }

  function draw() {
    list.replaceChildren();
    const all = files.list();
    if (!all.length) {
      const li = document.createElement('li');
      li.className = 'no-tracks';
      li.textContent = 'Nothing uploaded yet.';
      list.append(li);
      return;
    }
    all.forEach((f) => {
      const li = document.createElement('li');
      li.className = 'lib-item';

      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'lib-pick';
      pick.innerHTML = `<span class="lib-name"></span><span class="lib-size"></span>`;
      pick.querySelector('.lib-name').textContent = f.name;
      pick.querySelector('.lib-size').textContent = mb(f.size);
      pick.disabled = !pickMode;
      pick.addEventListener('click', () => {
        dialog.close();
        onPicked(f.id);
      });

      const kill = document.createElement('button');
      kill.type = 'button';
      kill.className = 'icon danger';
      kill.textContent = '🗑';
      kill.title = `Delete ${f.name}`;
      kill.setAttribute('aria-label', `Delete ${f.name}`);
      kill.addEventListener('click', async () => {
        if (!confirm(`Delete "${f.name}" from this device? Layers using it will lose the track.`)) return;
        await files.remove(f.id);
        draw();
        onChanged();
      });

      li.append(pick, kill);
      list.append(li);
    });
  }

  document.body.append(dialog);

  return {
    open({ picking = false } = {}) {
      pickMode = picking;
      dialog.querySelector('h2').textContent = picking ? 'Choose a track' : 'Audio library';
      sub.textContent = defaultSub();
      draw();
      dialog.showModal();
    },
    refresh: draw,
  };
}

// Cheap decode check so an unsupported file is caught at upload rather than
// silently failing later inside a layer.
function isPlayable(file) {
  return new Promise((resolve) => {
    const probe = new Audio();
    const url = URL.createObjectURL(file);
    const done = (ok) => {
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    probe.preload = 'metadata';
    probe.addEventListener('loadedmetadata', () => done(true), { once: true });
    probe.addEventListener('error', () => done(false), { once: true });
    setTimeout(() => done(true), 8000); // slow to read is not the same as broken
    probe.src = url;
  });
}
