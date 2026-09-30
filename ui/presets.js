// Preset sheet: save the current layer setup under a name, load one back, delete.

import * as presets from '../storage/presets.js';

export function createPresets({ onLoad, getSnapshot }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'sheet';
  dialog.innerHTML = `
    <form method="dialog" class="sheet-head">
      <h2>Presets</h2>
      <button class="icon" value="cancel" aria-label="Close">✕</button>
    </form>
    <p class="sheet-sub">A preset remembers which files each layer uses, loop or playlist, and the volumes.</p>
    <div class="save-row">
      <input type="text" class="preset-name" placeholder="Name this setup" aria-label="Preset name">
      <button type="button" class="save">Save</button>
    </div>
    <ul class="preset-list"></ul>
  `;

  const nameInput = dialog.querySelector('.preset-name');
  const saveBtn = dialog.querySelector('.save');
  const list = dialog.querySelector('.preset-list');
  const sub = dialog.querySelector('.sheet-sub');

  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    const layers = getSnapshot();
    if (!layers.length) {
      sub.textContent = 'Nothing to save — add a layer first.';
      return;
    }
    await presets.save(name, layers);
    nameInput.value = '';
    sub.textContent = `Saved "${name}".`;
    await draw();
  });

  async function draw() {
    const all = await presets.list();
    list.replaceChildren();
    if (!all.length) {
      const li = document.createElement('li');
      li.className = 'no-tracks';
      li.textContent = 'No presets saved yet.';
      list.append(li);
      return;
    }
    all.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'lib-item';

      const load = document.createElement('button');
      load.type = 'button';
      load.className = 'lib-pick';
      load.innerHTML = `<span class="lib-name"></span><span class="lib-size"></span>`;
      load.querySelector('.lib-name').textContent = p.name;
      load.querySelector('.lib-size').textContent = `${p.layers.length} layer${p.layers.length === 1 ? '' : 's'}`;
      load.addEventListener('click', () => {
        dialog.close();
        onLoad(p);
      });

      const kill = document.createElement('button');
      kill.type = 'button';
      kill.className = 'icon danger';
      kill.textContent = '🗑';
      kill.title = `Delete preset ${p.name}`;
      kill.setAttribute('aria-label', `Delete preset ${p.name}`);
      kill.addEventListener('click', async () => {
        if (!confirm(`Delete the preset "${p.name}"? Your audio files are not affected.`)) return;
        await presets.remove(p.id);
        await draw();
      });

      li.append(load, kill);
      list.append(li);
    });
  }

  document.body.append(dialog);

  return {
    async open() {
      sub.textContent = 'A preset remembers which files each layer uses, loop or playlist, and the volumes.';
      await draw();
      dialog.showModal();
    },
  };
}
