const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let state;
let toastTimer;

function toast(message, error = false) {
  const node = $('#toast');
  node.textContent = message;
  node.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.className = 'toast', 3200);
}

function showPage(id) {
  $$('.page').forEach(page => page.classList.toggle('active', page.id === id));
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === id));
}

function applyState() {
  const name = state.profile?.username || 'Player';
  $('#username').value = name;
  $('#sidebarName').textContent = name;
  $('#avatarLetter').textContent = name[0].toUpperCase();
  $('#memory').value = state.settings.memory;
  $('#memoryValue').textContent = `${state.settings.memory} MB`;
  $('#javaPath').value = state.settings.javaPath || '';
  $('#motion').checked = state.settings.motion !== false;
  $('#closeOnLaunch').checked = !!state.settings.closeOnLaunch;
  document.body.classList.toggle('reduce-motion', state.settings.motion === false);
  const equipped = $(`.cosmetic-card[data-cosmetic="${state.cosmetic}"]`) || $('.cosmetic-card');
  equipCard(equipped, false);
}

async function loadVersions() {
  try {
    const versions = await window.blazzy.getVersions();
    $('#versionSelect').innerHTML = versions.map(v => `<option value="${v}">${v}</option>`).join('');
    $('#playSubtitle').textContent = `${versions[0]} · Fabric-ready`;
  } catch (error) {
    $('#versionSelect').innerHTML = '<option value="1.21.4">1.21.4</option><option value="1.21.1">1.21.1</option>';
    toast(`Version service: ${error.message}`, true);
  }
}

async function launchGame() {
  const button = $('#playButton');
  button.disabled = true;
  $('#progressWrap').classList.remove('hidden');
  $('#playSubtitle').textContent = 'Preparing Minecraft…';
  try {
    await window.blazzy.launch({ version: $('#versionSelect').value });
    $('#playSubtitle').textContent = 'Minecraft is running';
    toast('Minecraft launched successfully.');
  } catch (error) {
    $('#playSubtitle').textContent = 'Ready to play';
    $('#progressWrap').classList.add('hidden');
    toast(error.message, true);
  } finally { button.disabled = false; }
}

async function searchMods(query) {
  const grid = $('#modGrid');
  const version = $('#versionSelect').value;
  grid.innerHTML = '<div class="empty-state"><span>◆</span><h3>Searching Modrinth…</h3></div>';
  try {
    const mods = await window.blazzy.searchMods(query, version);
    if (!mods.length) throw new Error('No compatible mods found.');
    grid.innerHTML = mods.map(mod => `<article class="mod-card">
      <img src="${mod.icon || '../assets/logo.png'}" alt="">
      <div><h3>${escapeHtml(mod.title)}</h3><p>${escapeHtml(mod.description)}</p><div class="mod-meta">by ${escapeHtml(mod.author)} · ${compact(mod.downloads)} downloads</div></div>
      <button data-install="${mod.id}">INSTALL FOR ${version}</button>
    </article>`).join('');
    $$('[data-install]').forEach((button, index) => button.addEventListener('click', () => installMod(button, mods[index])));
  } catch (error) {
    grid.innerHTML = `<div class="empty-state"><span>!</span><h3>${escapeHtml(error.message)}</h3><p>Try another search or check your connection.</p></div>`;
  }
}

async function installMod(button, mod) {
  button.disabled = true; button.textContent = 'DOWNLOADING…';
  try {
    const result = await window.blazzy.installMod(mod, $('#versionSelect').value);
    button.textContent = 'INSTALLED ✓';
    toast(`${result.filename} installed.`);
  } catch (error) { button.disabled = false; button.textContent = 'TRY AGAIN'; toast(error.message, true); }
}

function equipCard(card, persist = true) {
  if (!card || card.classList.contains('locked')) return;
  $$('.cosmetic-card').forEach(item => { item.classList.remove('active'); if (!item.classList.contains('locked')) item.querySelector('small').textContent = 'OWNED'; });
  card.classList.add('active'); card.querySelector('small').textContent = 'EQUIPPED';
  const name = card.dataset.name;
  $('#previewName').textContent = name.toUpperCase(); $('#equippedText').textContent = name;
  $('.cape').style.background = card.dataset.cosmetic === 'void-cape' ? 'linear-gradient(145deg,#a75cff,#35105f 55%,#08030d)' : '';
  if (persist) window.blazzy.saveCosmetic(card.dataset.cosmetic).then(next => state = next);
}

function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value || ''; return div.innerHTML; }
function compact(number) { return Intl.NumberFormat('en', { notation: 'compact' }).format(number); }

async function init() {
  state = await window.blazzy.getState();
  applyState(); loadVersions();
  $$('.nav-item,[data-page]').forEach(item => item.addEventListener('click', () => showPage(item.dataset.page)));
  $('#minimize').addEventListener('click', window.blazzy.minimize);
  $('#close').addEventListener('click', window.blazzy.close);
  $('#playButton').addEventListener('click', launchGame);
  $('#versionSelect').addEventListener('change', e => $('#playSubtitle').textContent = `${e.target.value} · Fabric-ready`);
  $('#searchButton').addEventListener('click', () => searchMods($('#modSearch').value));
  $('#modSearch').addEventListener('keydown', e => { if (e.key === 'Enter') searchMods(e.target.value); });
  $$('.quick-tags button').forEach(button => button.addEventListener('click', () => { $('#modSearch').value = button.dataset.query; searchMods(button.dataset.query); }));
  $('#openMods').addEventListener('click', () => window.blazzy.openModsFolder());
  $$('.cosmetic-card').forEach(card => card.addEventListener('click', () => equipCard(card)));
  $('#memory').addEventListener('input', e => $('#memoryValue').textContent = `${e.target.value} MB`);
  $('#saveSettings').addEventListener('click', async () => {
    try {
      await window.blazzy.saveProfile({ username: $('#username').value });
      state = await window.blazzy.saveSettings({ memory: Number($('#memory').value), javaPath: $('#javaPath').value.trim(), motion: $('#motion').checked, closeOnLaunch: $('#closeOnLaunch').checked });
      applyState(); toast('Settings saved.');
    } catch (error) { toast(error.message, true); }
  });
  window.blazzy.onProgress(data => {
    const percent = data.total ? Math.round((data.task / data.total) * 100) : 5;
    $('#progressBar').style.width = `${Math.max(4, percent)}%`;
    $('#progressText').textContent = `Downloading game files · ${percent}%`;
  });
  window.blazzy.onLog(message => { if (/exited/i.test(message)) { $('#playSubtitle').textContent = 'Ready to play'; $('#progressWrap').classList.add('hidden'); } });
}

init().catch(error => toast(error.message, true));
