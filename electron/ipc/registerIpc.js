import { app, dialog, ipcMain, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getMinecraftRoot, getInstanceDir } from '../services/paths.js';
import { getMainWindow } from '../services/windowManager.js';
import { checkForLauncherUpdate, downloadAndApplyUpdate } from '../services/updater.js';
import {
  readInstalledMods,
  readInstalledShaders,
  readInstalledResourcePacks,
  readInstalledDatapacks,
  toggleMod,
  setAllModsEnabled,
  deleteMod,
  deleteShader,
  deleteResourcePack,
  deleteDatapack,
  openContentFolder,
  importModFile,
  importContentFile,
  pickContentFiles,
  installModrinthProject,
  checkInstalledModsUpdates,
} from '../services/contentManager.js';
import {
  readInstalledVersions,
  installMinecraft,
  cancelInstall,
} from '../services/minecraftInstaller.js';
import {
  launchMinecraft,
  stopMinecraft,
} from '../services/minecraftRunner.js';
import { loadLauncherCatalog } from '../../src/lib/minecraftLauncher.js';
import { loadMinecraftNews, loadMinecraftArticle } from '../../src/lib/minecraftNews.js';
import { loadLauncherState, saveLauncherState } from '../../src/lib/launcherState.js';
import {
  getMicrosoftAuthState,
  loginMicrosoftInteractive,
  logoutMicrosoft,
} from '../../src/lib/microsoftAuth.js';
import {
  searchModrinthProjects,
  getModrinthProject,
  getModrinthProjectVersions,
} from '../../src/lib/modrinth.js';
import {
  readAllInstances,
  createInstance,
  updateInstance,
  deleteInstance,
  scanBaseDirectory,
  migrateBaseToInstance,
} from '../services/instanceManager.js';
import { getOfficialCosmetics, pickAndUploadOfficialSkin, setOfficialCape, getLocalCosmetics, pickLocalSkin } from '../services/cosmeticsManager.js';

const remoteImageCache = new Map();
let activeLoginController = null;
const MAX_REMOTE_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_DOMAINS = [
  'minecraft.net',
  'mojang.com',
  'modrinth.com',
  'ctfassets.net',
  'minotar.net',
  'mc-heads.net',
  'crafatar.com',
];

function isAllowedImageUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_IMAGE_DOMAINS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function registerAllIpc() {
  const sendToRenderer = (channel, payload) => {
    try {
      const win = getMainWindow();
      win?.webContents.send(channel, payload);
    } catch { }
  };

  const sendLog = (type, msg) => {
    sendToRenderer('minecraft:run-log', { type, msg });
  };

  // ── Window and Shell Controls ──
  ipcMain.handle('window:minimize', () => getMainWindow()?.minimize());
  ipcMain.handle('window:maximize', () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle('window:close', () => getMainWindow()?.close());
  ipcMain.handle('shell:open-external', async (_, rawUrl) => {
    try {
      const url = new URL(String(rawUrl || ''));
      if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) {
        return { error: 'Unsupported external URL.' };
      }
      await shell.openExternal(url.href);
      return { ok: true };
    } catch (error) {
      return { error: 'OpenExternalFailed', message: error?.message || String(error) };
    }
  });
  ipcMain.handle('media:fetch-image', async (_, rawUrl) => {
    if (typeof rawUrl !== 'string' || !isAllowedImageUrl(rawUrl)) {
      return { error: 'Image URL is not allowed.' };
    }
    if (remoteImageCache.has(rawUrl)) return { dataUrl: remoteImageCache.get(rawUrl) };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(rawUrl, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': `Blazzy-Client/${app.getVersion()}` },
      });
      if (!isAllowedImageUrl(response.url)) return { error: 'Image redirect is not allowed.' };
      if (!response.ok) return { error: `Image request failed (${response.status}).` };
      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!contentType.startsWith('image/')) return { error: 'Remote file is not an image.' };
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > MAX_REMOTE_IMAGE_BYTES) return { error: 'Remote image is too large.' };

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_REMOTE_IMAGE_BYTES) return { error: 'Remote image is too large.' };
      const dataUrl = `data:${contentType};base64,${bytes.toString('base64')}`;
      if (remoteImageCache.size >= 100) remoteImageCache.delete(remoteImageCache.keys().next().value);
      remoteImageCache.set(rawUrl, dataUrl);
      return { dataUrl };
    } catch (error) {
      return { error: error?.name === 'AbortError' ? 'Image request timed out.' : (error?.message || 'Image request failed.') };
    } finally {
      clearTimeout(timeout);
    }
  });

  // ── Directory and System Information ──
  ipcMain.handle('minecraft:open-root-directory', async () => {
    const minecraftRoot = getMinecraftRoot();
    try {
      await fs.promises.mkdir(minecraftRoot, { recursive: true });
      const result = await shell.openPath(minecraftRoot);
      if (result) {
        return { error: 'OpenPathFailed', message: result, path: minecraftRoot };
      }
      return { ok: true, path: minecraftRoot };
    } catch (error) {
      return { error: 'OpenPathFailed', message: error?.message || String(error), path: minecraftRoot };
    }
  });

  ipcMain.handle('minecraft:get-root', async () => ({ root: getMinecraftRoot() }));
  ipcMain.handle('minecraft:get-screenshots', async (_, instanceId = null) => {
    const screenshotsDir = path.join(getInstanceDir(instanceId), 'screenshots');
    await fs.promises.mkdir(screenshotsDir, { recursive: true });
    const names = (await fs.promises.readdir(screenshotsDir)).filter(name => /\.(png|jpe?g)$/i.test(name));
    const rows = await Promise.all(names.map(async name => {
      const filePath = path.join(screenshotsDir, name);
      const stat = await fs.promises.stat(filePath);
      return { name, path: filePath, modified: stat.mtimeMs, size: stat.size };
    }));
    const items = [];
    for (const row of rows.sort((a, b) => b.modified - a.modified).slice(0, 80)) {
      const bytes = await fs.promises.readFile(row.path);
      items.push({ ...row, dataUrl: `data:image/${row.name.toLowerCase().endsWith('.png') ? 'png' : 'jpeg'};base64,${bytes.toString('base64')}` });
    }
    return { items, path: screenshotsDir };
  });
  ipcMain.handle('minecraft:open-screenshots', async (_, instanceId = null) => {
    const screenshotsDir = path.join(getInstanceDir(instanceId), 'screenshots');
    await fs.promises.mkdir(screenshotsDir, { recursive: true });
    return { ok: !(await shell.openPath(screenshotsDir)), path: screenshotsDir };
  });
  ipcMain.handle('minecraft:open-screenshot', async (_, filePath) => {
    const resolved = path.resolve(String(filePath || ''));
    const allowedRoots = [getMinecraftRoot(), getInstanceDir(null)].map(root => path.resolve(root) + path.sep);
    if (!allowedRoots.some(root => resolved.startsWith(root)) || !/\.(png|jpe?g)$/i.test(resolved)) return { error: 'Invalid screenshot path.' };
    return { ok: !(await shell.openPath(resolved)) };
  });
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('system:get-info', async () => {
    const totalBytes = os.totalmem();
    const totalRamGb = Math.max(2, Math.round(totalBytes / (1024 * 1024 * 1024)));
    return {
      totalRamGb,
      platform: process.platform,
      arch: process.arch,
    };
  });

  // ── State and Settings ──
  ipcMain.handle('minecraft:get-state', async () => {
    const state = await loadLauncherState(app.getPath('userData'));
    return { ...state, minecraftRoot: getMinecraftRoot() };
  });

  ipcMain.handle('minecraft:save-state', async (_, state) => {
    if (state.settings && typeof state.settings === 'object') {
      state.settings.javaPath = state.settings.javaPath || '';
    }
    return saveLauncherState(app.getPath('userData'), state);
  });

  ipcMain.handle('minecraft:get-settings', async () => {
    const state = await loadLauncherState(app.getPath('userData'));
    return {
      keepOpen: state.settings?.keepOpen ?? false,
      showConsole: state.settings?.showConsole ?? true,
      autoUpdate: state.settings?.autoUpdate ?? true,
      showSnapshots: state.settings?.showSnapshots ?? false,
    };
  });

  ipcMain.handle('app:get-language', async () => {
    try {
      const state = await loadLauncherState(app.getPath('userData'));
      return state.settings?.language || 'en';
    } catch {
      return 'en';
    }
  });

  ipcMain.handle('app:set-language', async (_, language) => {
    try {
      const currentState = await loadLauncherState(app.getPath('userData'));
      await saveLauncherState(app.getPath('userData'), {
        ...currentState,
        settings: { ...currentState.settings, language: typeof language === 'string' && language.trim() ? language.trim() : 'en' },
      });
      return { ok: true };
    } catch (error) {
      return { error: 'SaveFailed', message: error?.message || String(error) };
    }
  });

  // ── Catalog and News ──
  ipcMain.handle('minecraft:get-catalog', async (_, options) => {
    const currentState = await loadLauncherState(app.getPath('userData'));
    const includeSnapshots = options?.includeSnapshots !== undefined
      ? Boolean(options.includeSnapshots)
      : (options?.showSnapshots !== undefined
        ? Boolean(options.showSnapshots)
        : currentState.settings?.showSnapshots === true);
    const catalog = await loadLauncherCatalog({ includeSnapshots });
    try {
      const nextSettings = { ...(currentState.settings || {}), showSnapshots: includeSnapshots };
      await saveLauncherState(app.getPath('userData'), {
        ...currentState,
        settings: nextSettings,
        versions: catalog.versions,
        installTargets: catalog.installTargets,
        latest: catalog.latest,
      });
    } catch { }
    return catalog;
  });

  ipcMain.handle('minecraft:get-news', async (_, options = {}) => {
    try {
      const limit = Number(options?.limit) > 0 ? Number(options.limit) : 60;
      return await loadMinecraftNews({ limit });
    } catch (error) {
      return { error: error?.message || 'Failed to load Minecraft news.', items: [], sourceUrl: 'https://www.minecraft.net/en-us/articles' };
    }
  });

  ipcMain.handle('minecraft:get-article', async (_, url) => {
    try {
      return await loadMinecraftArticle(url);
    } catch (error) {
      return { error: error?.message || 'Failed to load article content.', url };
    }
  });

  // ── Authentication ──
  ipcMain.handle('minecraft:get-auth-state', async (_, profileKey = 'default', options = {}) => {
    return getMicrosoftAuthState({
      profileKey,
      storageDir: app.getPath('userData'),
      forceRefresh: Boolean(options?.forceRefresh),
    });
  });

  ipcMain.handle('minecraft:login', async (_, profileKey = 'default') => {
    activeLoginController?.abort();
    const controller = new AbortController();
    activeLoginController = controller;
    try {
      return await loginMicrosoftInteractive({
        profileKey,
        storageDir: app.getPath('userData'),
        openExternal: url => shell.openExternal(url),
        abortSignal: controller.signal,
      });
    } catch (error) {
      if (error?.message === 'Login cancelled by user') {
        return { error: error.message, cancelled: true };
      }
      return { error: error?.message || 'Microsoft login failed.' };
    } finally {
      if (activeLoginController === controller) activeLoginController = null;
    }
  });

  ipcMain.handle('minecraft:login-cancel', async () => {
    if (!activeLoginController) return { ok: true, cancelled: false };
    activeLoginController.abort();
    activeLoginController = null;
    return { ok: true, cancelled: true };
  });

  ipcMain.handle('minecraft:logout', async (_, profileKey = 'default') => {
    return logoutMicrosoft({ profileKey, storageDir: app.getPath('userData') });
  });
  ipcMain.handle('minecraft:get-cosmetics', async (_, profileKey = 'default') => {
    try { return await getOfficialCosmetics(profileKey); }
    catch (error) { return { error: 'CosmeticsFailed', message: error?.message || String(error) }; }
  });
  ipcMain.handle('minecraft:update-skin', async (_, payload = {}) => {
    try { return await pickAndUploadOfficialSkin(payload); }
    catch (error) { return { error: 'SkinUpdateFailed', message: error?.message || String(error) }; }
  });
  ipcMain.handle('minecraft:set-cape', async (_, payload = {}) => {
    try { return await setOfficialCape(payload); }
    catch (error) { return { error: 'CapeUpdateFailed', message: error?.message || String(error) }; }
  });
  ipcMain.handle('minecraft:get-local-cosmetics', async (_, profileKey = 'default') => getLocalCosmetics(profileKey));
  ipcMain.handle('minecraft:update-local-skin', async (_, payload = {}) => pickLocalSkin(payload));

  // ── Instances ──
  ipcMain.handle('instances:get-all', async () => readAllInstances());
  ipcMain.handle('instances:create', async (_, payload) => createInstance(payload));
  ipcMain.handle('instances:update', async (_, { id, updates }) => updateInstance(id, updates));
  ipcMain.handle('instances:delete', async (_, id) => deleteInstance(id));
  ipcMain.handle('instances:scan-base', async () => scanBaseDirectory());
  ipcMain.handle('instances:migrate-base', async (_, payload) => migrateBaseToInstance(payload));
  ipcMain.handle('instances:pick-image', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win || undefined, {
      title: 'Select instance icon image',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    try {
      const filePath = result.filePaths[0];
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      const buf = await fs.promises.readFile(filePath);
      return { canceled: false, dataUri: `data:${mime};base64,${buf.toString('base64')}` };
    } catch (err) {
      return { canceled: true, error: err.message };
    }
  });

  // ── Content Management (Mods, Shaders, Resource Packs, Data Packs) ──
  ipcMain.handle('minecraft:get-installed-versions', async () => readInstalledVersions());
  ipcMain.handle('minecraft:get-installed-mods', async (_, instanceId) => readInstalledMods(instanceId));
  ipcMain.handle('minecraft:get-installed-shaders', async (_, instanceId) => readInstalledShaders(instanceId));
  ipcMain.handle('minecraft:get-installed-resourcepacks', async (_, instanceId) => readInstalledResourcePacks(instanceId));
  ipcMain.handle('minecraft:get-installed-datapacks', async (_, instanceId) => readInstalledDatapacks(instanceId));

  ipcMain.handle('minecraft:toggle-mod', async (_, { modId, enable, instanceId }) => toggleMod(modId, enable, instanceId));
  ipcMain.handle('minecraft:set-all-mods-enabled', async (_, { enable, instanceId }) => setAllModsEnabled(Boolean(enable), instanceId));
  ipcMain.handle('minecraft:delete-mod', async (_, { modId, instanceId }) => deleteMod(modId, instanceId));
  ipcMain.handle('minecraft:delete-shader', async (_, { fileName, instanceId }) => deleteShader(fileName, instanceId));
  ipcMain.handle('minecraft:delete-resourcepack', async (_, { fileName, instanceId }) => deleteResourcePack(fileName, instanceId));
  ipcMain.handle('minecraft:delete-datapack', async (_, { fileName, instanceId }) => deleteDatapack(fileName, instanceId));
  ipcMain.handle('minecraft:open-content-folder', async (_, folderType, instanceId) => openContentFolder(folderType, instanceId));
  ipcMain.handle('minecraft:install-mod-file', async (_, { sourcePath, instanceId }) => importModFile({ sourcePath }, instanceId));
  ipcMain.handle('minecraft:import-content-file', async (_, payload, instanceId) => importContentFile(payload, instanceId));

  ipcMain.handle('minecraft:pick-mod-files', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win || undefined, {
      title: 'Select mod files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Minecraft Mods', extensions: ['jar', 'olpkg'] }, { name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled) return { canceled: true, filePaths: [] };
    return { canceled: false, filePaths: result.filePaths || [] };
  });

  ipcMain.handle('minecraft:pick-content-files', async (_, type) => pickContentFiles(type));

  // ── Modrinth Integration ──
  ipcMain.handle('minecraft:modrinth-search', async (_, params) => searchModrinthProjects(params));
  ipcMain.handle('minecraft:modrinth-get-project', async (_, idOrSlug) => getModrinthProject(idOrSlug));
  ipcMain.handle('minecraft:modrinth-get-versions', async (_, params) => getModrinthProjectVersions(params));
  ipcMain.handle('minecraft:modrinth-install', async (_, payload) => installModrinthProject(payload, { onLog: sendLog }));
  ipcMain.handle('minecraft:check-mod-updates', async (_, params) => checkInstalledModsUpdates(params));

  // ── Updates ──
  ipcMain.handle('minecraft:check-update', async () => {
    return checkForLauncherUpdate({
      onEvent: sendToRenderer,
    });
  });

  ipcMain.handle('minecraft:apply-update', async (_, updatePayload) => {
    return downloadAndApplyUpdate(updatePayload, {
      onEvent: sendToRenderer,
    });
  });

  // ── Game Installation and Execution ──
  ipcMain.handle('minecraft:install', async (_, opts) => {
    try {
      return await installMinecraft(opts, {
        onLog: sendLog,
        onProgress: (p) => {
          sendToRenderer('minecraft:install-file-progress', p);
          sendToRenderer('minecraft:install-progress', p);
        },
        onComplete: (c) => sendToRenderer('minecraft:install-complete', c),
      });
    } catch (error) {
      const message = error?.message || String(error) || 'Installation failed.';
      sendLog('error', `Installation failed: ${message}`);
      sendToRenderer('minecraft:install-error', { message });
      return { error: 'InstallFailed', message };
    }
  });

  ipcMain.handle('minecraft:install-cancel', async (_, { installId }) => {
    const result = cancelInstall(installId);
    if (result.ok) {
      sendToRenderer('minecraft:install-cancelled', { installId });
    }
    return result;
  });

  ipcMain.handle('minecraft:run', async (_, opts) => {
    return launchMinecraft(opts, {
      onLog: sendLog,
      onAssetProgress: (p) => sendToRenderer('minecraft:asset-progress', p),
      onExit: (e) => sendToRenderer('minecraft:run-exit', e),
      onConflict: (c) => sendToRenderer('minecraft:mod-conflict', c),
    });
  });

  ipcMain.handle('minecraft:stop', async (_, { pid }) => stopMinecraft(pid));
}
