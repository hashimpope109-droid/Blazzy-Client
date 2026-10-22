const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const childProcess = require('child_process');
const AdmZip = require('adm-zip');
const { Client, Authenticator } = require('minecraft-launcher-core');

let win;
let gameProcess;
const launcher = new Client();
const dataDir = () => path.join(app.getPath('appData'), '.blazzy-client');
const stateFile = () => path.join(dataDir(), 'state.json');
const defaultState = {
  profile: { username: 'Player', mode: 'offline' },
  settings: { memory: 4096, closeOnLaunch: false, motion: true, javaPath: '' },
  cosmetic: 'ember-cape'
};

function readState() {
  try { return { ...defaultState, ...JSON.parse(fs.readFileSync(stateFile(), 'utf8')) }; }
  catch { return defaultState; }
}

function writeState(next) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(next, null, 2));
  return next;
}

function updateState(part) { return writeState({ ...readState(), ...part }); }

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 780, minWidth: 1020, minHeight: 650,
    frame: false, backgroundColor: '#080808', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'BlazzyClient/0.1 (launcher)' } });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

async function prepareFabric(root, minecraftVersion) {
  const loaders = await fetchJson('https://meta.fabricmc.net/v2/versions/loader');
  const loader = loaders.find(item => item.stable && compareVersions(item.version, '0.16.0') >= 0);
  if (!loader) throw new Error('No supported Fabric loader (0.16+) is available.');
  const profile = await fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(minecraftVersion)}/${encodeURIComponent(loader.version)}/profile/json`);
  const id = profile.id || `fabric-loader-${loader.version}-${minecraftVersion}`;
  const folder = path.join(root, 'versions', id);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${id}.json`), JSON.stringify(profile, null, 2));
  return { id, loader: loader.version };
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number); const b = right.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] || 0) - (b[i] || 0);
    if (difference) return difference;
  }
  return 0;
}

async function resolveJava(customPath) {
  if (customPath) {
    if (!fs.existsSync(customPath)) throw new Error('The configured Java path does not exist.');
    return customPath;
  }
  const executable = process.platform === 'win32' ? 'javaw.exe' : 'java';
  const systemJava = childProcess.spawnSync(process.platform === 'win32' ? 'java.exe' : 'java', ['-version'], { windowsHide: true });
  if (!systemJava.error && systemJava.status === 0) return process.platform === 'win32' ? 'javaw.exe' : 'java';
  if (process.platform !== 'win32') throw new Error('Java 21 is required. Install it or select its path in Settings.');

  const runtimeRoot = path.join(dataDir(), 'runtime');
  const existing = findFile(runtimeRoot, executable);
  if (existing) return existing;
  win?.webContents.send('launch:log', 'Downloading a verified Java 21 runtime for first launch…');
  const assets = await fetchJson('https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse');
  const pkg = assets[0]?.binary?.package;
  if (!pkg?.link || !pkg?.checksum) throw new Error('Java 21 download metadata is unavailable.');
  const response = await fetch(pkg.link, { headers: { 'User-Agent': 'BlazzyClient/0.1 (launcher)' } });
  if (!response.ok) throw new Error(`Java 21 download failed (${response.status}).`);
  const archive = Buffer.from(await response.arrayBuffer());
  const digest = crypto.createHash('sha256').update(archive).digest('hex');
  if (digest.toLowerCase() !== pkg.checksum.toLowerCase()) throw new Error('Java 21 checksum verification failed.');
  fs.mkdirSync(runtimeRoot, { recursive: true });
  new AdmZip(archive).extractAllTo(runtimeRoot, true);
  const installed = findFile(runtimeRoot, executable);
  if (!installed) throw new Error('Java 21 was downloaded but could not be prepared.');
  return installed;
}

function findFile(root, filename) {
  if (!fs.existsSync(root)) return null;
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(candidate);
      else if (entry.name.toLowerCase() === filename.toLowerCase()) return candidate;
    }
  }
  return null;
}

ipcMain.handle('state:get', () => readState());
ipcMain.handle('profile:save', (_e, profile) => {
  const username = String(profile.username || '').trim().replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
  if (username.length < 3) throw new Error('Username must be 3-16 letters, numbers, or underscores.');
  return updateState({ profile: { username, mode: 'offline' } });
});
ipcMain.handle('settings:save', (_e, settings) => updateState({ settings: { ...readState().settings, ...settings } }));
ipcMain.handle('cosmetic:save', (_e, cosmetic) => updateState({ cosmetic: String(cosmetic) }));

ipcMain.handle('minecraft:versions', async () => {
  const manifest = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  return manifest.versions
    .filter(v => v.type === 'release' && /^1\.(2[1-9]|[3-9]\d)(\.|$)/.test(v.id))
    .slice(0, 30).map(v => v.id);
});

ipcMain.handle('mods:search', async (_e, { query, version }) => {
  const facets = JSON.stringify([[`versions:${version}`], ['categories:fabric'], ['project_type:mod']]);
  const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query || '')}&limit=24&facets=${encodeURIComponent(facets)}`;
  const data = await fetchJson(url);
  return data.hits.map(hit => ({
    id: hit.project_id, slug: hit.slug, title: hit.title, description: hit.description,
    icon: hit.icon_url, downloads: hit.downloads, author: hit.author
  }));
});

ipcMain.handle('mods:install', async (_e, { mod, version }) => {
  const versions = await fetchJson(`https://api.modrinth.com/v2/project/${encodeURIComponent(mod.id)}/version?loaders=[%22fabric%22]&game_versions=[%22${encodeURIComponent(version)}%22]`);
  if (!versions.length) throw new Error('No compatible Fabric file found.');
  const file = versions[0].files.find(f => f.primary) || versions[0].files[0];
  const folder = path.join(dataDir(), 'minecraft', 'mods');
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, path.basename(file.filename));
  const response = await fetch(file.url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  return { filename: file.filename };
});

ipcMain.handle('mods:open-folder', () => {
  const folder = path.join(dataDir(), 'minecraft', 'mods');
  fs.mkdirSync(folder, { recursive: true });
  return shell.openPath(folder);
});

ipcMain.handle('minecraft:launch', async (_e, options) => {
  if (gameProcess) throw new Error('Minecraft is already running.');
  const state = readState();
  const username = state.profile.username;
  const root = path.join(dataDir(), 'minecraft');
  const javaPath = await resolveJava(state.settings.javaPath);
  win?.webContents.send('launch:log', 'Preparing the latest stable Fabric 0.16+ profile…');
  const fabric = await prepareFabric(root, options.version);
  const launchOptions = {
    authorization: Authenticator.getAuth(username),
    root,
    version: { number: options.version, type: 'release', custom: fabric.id },
    memory: { max: `${state.settings.memory || 4096}M`, min: '1024M' },
    javaPath,
    overrides: { detached: false },
    customArgs: ['--userType', 'legacy']
  };
  launcher.removeAllListeners();
  launcher.on('debug', data => win?.webContents.send('launch:log', String(data)));
  launcher.on('data', data => win?.webContents.send('launch:log', String(data)));
  launcher.on('progress', data => win?.webContents.send('launch:progress', data));
  launcher.on('close', code => {
    gameProcess = null;
    win?.webContents.send('launch:log', `Minecraft exited with code ${code}`);
    if (win && !win.isVisible()) win.show();
  });
  gameProcess = await launcher.launch(launchOptions);
  if (state.settings.closeOnLaunch) win.hide();
  return { started: true, session: crypto.randomUUID(), fabric: fabric.loader };
});

ipcMain.handle('minecraft:stop', () => {
  if (gameProcess?.kill) gameProcess.kill();
  gameProcess = null;
  return true;
});
ipcMain.on('window:minimize', () => win?.minimize());
ipcMain.on('window:close', () => win?.close());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
