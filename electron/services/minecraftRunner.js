import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import os from 'os';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { getMinecraftRoot, getInstanceDir } from './paths.js';
import {
  findJavaCommand,
  resolveJavaCommand,
  detectJavaMajor,
  collectCommonJavaCandidates,
  ensureManagedJava,
  requiredJavaForMinecraft,
} from './javaDetector.js';
import {
  ensureJarFile,
  getLibraryPathFromName,
  loadLocalVersionMetadata,
  loadMojangVersionMetadata,
  saveResponseBodyToFile,
  isValidJarFile,
  verifyJarFile,
  resolveLibraryArtifactCandidates,
  rulesPassForCurrentSystem,
} from './minecraftInstaller.js';
import { loadLauncherState } from '../../src/lib/launcherState.js';
import { getMainWindow } from './windowManager.js';
import { installModrinthProject } from './contentManager.js';
import { downloadFileToPath } from './updater.js';
import { compileHudAdapterLocally } from './hudAdapterCompiler.js';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

export const runningChildren = new Map();

export function calculateSafeRamGb(requestedRam, totalBytes = os.totalmem()) {
  const requested = Math.max(1, Number(requestedRam) || 4);
  const totalGb = Math.max(1, Number(totalBytes) / (1024 ** 3));
  const systemReserve = totalGb <= 4 ? 1.5 : Math.max(2, totalGb * 0.2);
  const safeMaximum = Math.max(1, Math.floor(totalGb - systemReserve));
  return Math.max(1, Math.min(requested, safeMaximum));
}

const FABRIC_PERFORMANCE_MODS = [
  { projectId: 'fabric-api', name: 'Fabric API' },
  { projectId: 'sodium', name: 'Sodium' },
  { projectId: 'lithium', name: 'Lithium' },
  { projectId: 'ferrite-core', name: 'FerriteCore' },
  { projectId: 'immediatelyfast', name: 'ImmediatelyFast' },
  { projectId: 'entityculling', name: 'Entity Culling' },
  { projectId: 'sodium-extra', name: 'Sodium Extra' },
  { projectId: 'reeses-sodium-options', name: "Reese's Sodium Options" },
  { projectId: 'zoomify', name: 'Zoom' },
  { projectId: 'appleskin', name: 'AppleSkin HUD' },
  { projectId: 'betterf3', name: 'BetterF3' },
  { projectId: 'dynamic-fps', name: 'Dynamic FPS' },
  { projectId: 'iris', name: 'Iris Shaders' },
  { projectId: 'mOgUt4GM', name: 'Blazzy Menu' },
];
const BLAZZY_MENU_THEME_JAR = fileURLToPath(new URL('../resources/blazzy-menu-theme.jar', import.meta.url));
const BLAZZY_GRID_MENU_1214_JAR = fileURLToPath(new URL('../resources/blazzy-grid-menu-1.21.4.jar', import.meta.url));
const BLAZZY_GRID_MENU_1218_JAR = fileURLToPath(new URL('../resources/blazzy-grid-menu-1.21.8.jar', import.meta.url));
const BLAZZY_GRID_MENU_12110_JAR = fileURLToPath(new URL('../resources/blazzy-grid-menu-1.21.10.jar', import.meta.url));
const BLAZZY_GRID_MENU_JAR = fileURLToPath(new URL('../resources/blazzy-grid-menu-1.21.11.jar', import.meta.url));
const BLAZZY_GRID_MENU_2612_JAR = fileURLToPath(new URL('../resources/blazzy-grid-menu-26.1.2.jar', import.meta.url));
const BLAZZY_CLIENT_HUD_262_JAR = fileURLToPath(new URL('../resources/blazzy-client-hud-26.2.jar', import.meta.url));
const BLAZZY_ADAPTER_CATALOG_URL = 'https://raw.githubusercontent.com/hashimpope109-droid/Blazzy-Client/main/build-output/adapter-catalog.json';
const BLAZZY_ADAPTER_BASE_URL = 'https://raw.githubusercontent.com/hashimpope109-droid/Blazzy-Client/main/build-output/adapters';

const BLAZZY_MOD_MENU_DEFAULTS = {
  sorting: 'ascending',
  count_libraries: false,
  compact_list: false,
  count_children: true,
  mods_button_style: 'icon',
  game_menu_button_style: 'icon',
  count_hidden_mods: false,
  mod_count_location: 'none',
  hide_mod_links: false,
  show_libraries: false,
  hide_mod_license: true,
  hide_badges: false,
  hide_mod_credits: true,
  easter_eggs: false,
  random_java_colors: false,
  translate_names: true,
  translate_descriptions: true,
  update_checker: true,
  button_update_badge: true,
  update_channel: 'release',
  quick_configure: true,
  modify_title_screen: true,
  modify_game_menu: true,
  hide_config_buttons: false,
  config_mode: false,
  disable_drag_and_drop: false,
  hidden_mods: [],
  hidden_configs: [],
  disable_update_checker: [],
};

export async function ensureBlazzyMenuTheme(gameDir, onLog = null) {
  const modsDir = path.join(gameDir, 'mods');
  const destination = path.join(modsDir, 'blazzy-menu-theme-3.0.0.jar');
  await fs.promises.mkdir(modsDir, { recursive: true });
  const sourceStats = await fs.promises.stat(BLAZZY_MENU_THEME_JAR).catch(() => null);
  const destinationStats = await fs.promises.stat(destination).catch(() => null);
  if (!sourceStats?.isFile()) return false;
  const existingThemes = await fs.promises.readdir(modsDir).catch(() => []);
  await Promise.all(existingThemes
    .filter(fileName => /^blazzy-menu-theme-.*\.jar$/i.test(fileName) && fileName !== path.basename(destination))
    .map(fileName => fs.promises.rm(path.join(modsDir, fileName), { force: true })));
  if (!destinationStats?.isFile() || destinationStats.size !== sourceStats.size) {
    await fs.promises.copyFile(BLAZZY_MENU_THEME_JAR, destination);
    onLog?.('info', 'Blazzy Minecraft UI installed: custom title, loading branding, controls, and Right Shift menu.');
  }
  return true;
}

export function selectRemoteAdapterEntry(catalog, gameVersion) {
  const version = String(gameVersion || '').trim();
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(version)) return null;
  const entry = catalog?.versions?.[version];
  if (!entry || typeof entry !== 'object') return null;
  const file = String(entry.file || '');
  const sha256 = String(entry.sha256 || '').toLowerCase();
  if (!/^blazzy-grid-menu-[\d.]+\.jar$/.test(file) || !/^[a-f0-9]{64}$/.test(sha256)) return null;
  return { file, sha256 };
}

async function downloadRemoteBlazzyAdapter(gameDir, gameVersion, onLog = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(BLAZZY_ADAPTER_CATALOG_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': `BlazzyClient/${app.getVersion()}` },
    });
    if (!response.ok) return null;
    const entry = selectRemoteAdapterEntry(await response.json(), gameVersion);
    if (!entry) return null;
    const cacheDir = path.join(gameDir, '.blazzy-adapters');
    const cachedPath = path.join(cacheDir, entry.file);
    const existing = await fs.promises.readFile(cachedPath).catch(() => null);
    if (existing && crypto.createHash('sha256').update(existing).digest('hex') === entry.sha256 && isValidJarFile(cachedPath)) {
      return { source: cachedPath, destinationName: entry.file };
    }
    const partialPath = `${cachedPath}.partial`;
    await downloadFileToPath(`${BLAZZY_ADAPTER_BASE_URL}/${encodeURIComponent(entry.file)}`, partialPath);
    const downloaded = await fs.promises.readFile(partialPath);
    const actualHash = crypto.createHash('sha256').update(downloaded).digest('hex');
    if (actualHash !== entry.sha256 || !isValidJarFile(partialPath)) {
      await fs.promises.rm(partialPath, { force: true });
      throw new Error('Downloaded auto adapter failed integrity verification.');
    }
    const metadata = JSON.parse(new AdmZip(partialPath).readAsText('fabric.mod.json'));
    if (metadata?.id !== 'blazzy_grid_menu' || metadata?.depends?.minecraft !== String(gameVersion)) {
      await fs.promises.rm(partialPath, { force: true });
      throw new Error('Downloaded auto adapter does not match this Minecraft version.');
    }
    await fs.promises.rename(partialPath, cachedPath);
    onLog?.('info', `Downloaded verified Blazzy HUD adapter for Minecraft ${gameVersion}.`);
    return { source: cachedPath, destinationName: entry.file };
  } finally {
    clearTimeout(timeout);
  }
}

export async function ensureBlazzyGridMenu(gameDir, gameVersion, onLog = null) {
  const modsDir = path.join(gameDir, 'mods');
  const version = String(gameVersion || '');
  const legacyVersions = new Set(['1.21', '1.21.1', '1.21.2', '1.21.3', '1.21.4', '1.21.5']);
  const middleVersions = new Set(['1.21.6', '1.21.7', '1.21.8']);
  const recentVersions = new Set(['1.21.9', '1.21.10']);
  let bundledJar = version === '26.2'
    ? BLAZZY_CLIENT_HUD_262_JAR
    : version === '26.1.2'
      ? BLAZZY_GRID_MENU_2612_JAR
    : version === '1.21.11'
      ? BLAZZY_GRID_MENU_JAR
      : recentVersions.has(version)
        ? BLAZZY_GRID_MENU_12110_JAR
        : middleVersions.has(version)
          ? BLAZZY_GRID_MENU_1218_JAR
          : legacyVersions.has(version) ? BLAZZY_GRID_MENU_1214_JAR : null;
  let destinationName = bundledJar
    ? version === '26.2'
      ? 'blazzy-client-hud-26.2.jar'
      : version === '26.1.2'
        ? 'blazzy-grid-menu-26.1.2.jar'
      : `blazzy-grid-menu-${version === '1.21.11'
        ? '1.21.11'
        : recentVersions.has(version)
          ? '1.21.10'
          : middleVersions.has(version) ? '1.21.8' : '1.21.4'}.jar`
    : null;
  if (!bundledJar) {
    const remote = await downloadRemoteBlazzyAdapter(gameDir, version, onLog).catch(error => {
      onLog?.('warn', `No verified auto-compiled Blazzy HUD adapter for Minecraft ${version}: ${error?.message || error}`);
      return null;
    });
    bundledJar = remote?.source || null;
    destinationName = remote?.destinationName || null;
  }
  if (!bundledJar) {
    const compiled = await compileHudAdapterLocally(version, onLog).catch(error => {
      onLog?.('warn', `Could not auto-compile the Blazzy HUD for Minecraft ${version}: ${error?.message || error}`);
      return null;
    });
    if (compiled) {
      bundledJar = compiled;
      destinationName = `blazzy-grid-menu-${version}.jar`;
    }
  }
  const destination = destinationName ? path.join(modsDir, destinationName) : null;
  await fs.promises.mkdir(modsDir, { recursive: true });
  const existingMenus = await fs.promises.readdir(modsDir).catch(() => []);
  await Promise.all(existingMenus
    .filter(fileName => (
      /^blazzy-grid-menu-.*\.jar$/i.test(fileName)
      || /^blazzy-client-hud-.*\.jar$/i.test(fileName)
      || /^fastclient-hud.*\.jar$/i.test(fileName)
    ) && fileName !== destinationName)
    .map(fileName => fs.promises.rm(path.join(modsDir, fileName), { force: true })));
  if (!bundledJar || !destination) return false;
  const sourceStats = await fs.promises.stat(bundledJar).catch(() => null);
  const destinationStats = await fs.promises.stat(destination).catch(() => null);
  if (!sourceStats?.isFile()) return false;
  if (!destinationStats?.isFile() || destinationStats.size !== sourceStats.size) {
    await fs.promises.copyFile(bundledJar, destination);
    onLog?.('info', version === '26.2'
      ? 'Blazzy Client full HUD installed. Press Right Shift in game to open it.'
      : 'Blazzy grid dashboard installed. Press Right Shift in game to open it.');
  }
  return true;
}

export async function ensureBlazzyMenuPreset(gameDir) {
  const configDir = path.join(gameDir, 'config');
  const configPath = path.join(configDir, 'modmenu.json');
  let existing = {};
  try {
    const parsed = JSON.parse(await fs.promises.readFile(configPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed;
  } catch {}
  const merged = { ...BLAZZY_MOD_MENU_DEFAULTS, ...existing };
  await fs.promises.mkdir(configDir, { recursive: true });
  await fs.promises.writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return merged;
}

export async function applyPerformanceOptions(gameDir) {
  const optionsPath = path.join(gameDir, 'options.txt');
  const desired = {
    enableVsync: 'false',
    maxFps: '260',
    graphicsMode: '0',
    renderDistance: '10',
    simulationDistance: '6',
    entityDistanceScaling: '0.75',
    particles: '1',
    mipmapLevels: '2',
    biomeBlendRadius: '0',
    clouds: 'false',
    renderClouds: 'false',
    ao: 'false',
    'key_key.modmenu.open_menu': 'key.keyboard.unknown',
    'key_key.blazzy.open_menu': 'key.keyboard.right.shift',
    'key_key.fast-client-hud.click_gui': 'key.keyboard.right.shift',
  };
  let lines = [];
  try {
    lines = (await fs.promises.readFile(optionsPath, 'utf8')).split(/\r?\n/).filter(Boolean);
  } catch {}
  const seen = new Set();
  const updated = lines.map((line) => {
    const separator = line.indexOf(':');
    if (separator <= 0) return line;
    const key = line.slice(0, separator);
    if (!(key in desired)) return line;
    seen.add(key);
    return `${key}:${desired[key]}`;
  });
  for (const [key, value] of Object.entries(desired)) {
    if (!seen.has(key)) updated.push(`${key}:${value}`);
  }
  await fs.promises.mkdir(gameDir, { recursive: true });
  await fs.promises.writeFile(optionsPath, `${updated.join('\n')}\n`, 'utf8');
  return desired;
}

export async function ensureFabricPerformanceMods({ gameVersion, gameDir, instanceId = null, onLog = null } = {}) {
  const markerPath = path.join(gameDir, '.blazzy-fps-boost.json');
  await ensureBlazzyMenuTheme(gameDir, onLog).catch(error => {
    onLog?.('warn', `Could not install the Blazzy menu theme: ${error?.message || error}`);
  });
  await ensureBlazzyMenuPreset(gameDir).catch(error => {
    onLog?.('warn', `Could not prepare the Blazzy menu layout: ${error?.message || error}`);
  });
  await ensureBlazzyGridMenu(gameDir, gameVersion, onLog).catch(error => {
    onLog?.('warn', `Could not install the Blazzy grid dashboard: ${error?.message || error}`);
  });
  try {
    const marker = JSON.parse(await fs.promises.readFile(markerPath, 'utf8'));
    if (marker?.gameVersion === gameVersion && marker?.packVersion === 8) return [];
  } catch {}

  const installedNow = [];
  const unavailable = [];
  for (const mod of FABRIC_PERFORMANCE_MODS) {
    try {
      const result = await installModrinthProject({
        projectId: mod.projectId,
        gameVersion,
        loader: 'fabric',
        projectType: 'mod',
        instanceId,
      }, { onLog });
      if (result?.ok) installedNow.push(mod.name);
    } catch (error) {
      unavailable.push(mod.name);
      onLog?.('warn', `FPS Boost: ${mod.name} is not available for Minecraft ${gameVersion}: ${error?.message || error}`);
    }
  }
  await fs.promises.writeFile(markerPath, JSON.stringify({
    packVersion: 8,
    gameVersion,
    installed: installedNow,
    unavailable,
    checkedAt: new Date().toISOString(),
  }, null, 2), 'utf8').catch(() => {});
  return installedNow;
}

export function diagnoseLaunchFailure(output) {
  const text = String(output || '').replace(/\r/g, '').trim();
  if (!text) return { reason: 'unknown', message: 'Minecraft closed before producing an error log.' };
  if (/could not reserve enough space|insufficient memory|outofmemoryerror/i.test(text)) {
    return { reason: 'memory', message: 'Minecraft could not reserve enough memory. Reduce the profile RAM setting and try again.' };
  }
  if (/unsupportedclassversionerror|class file version/i.test(text)) {
    return { reason: 'java', message: 'The selected Java version is incompatible with this Minecraft version.' };
  }
  if (/incompatible mods found|mod resolution failed|some of your mods are incompatible/i.test(text)) {
    return { reason: 'mods', message: 'One or more installed mods are incompatible with this Minecraft or loader version. Review the Mods tab or retry in safe mode.' };
  }
  if (/noclassdeffounderror|classnotfoundexception|could not find or load main class/i.test(text)) {
    const missingClass = [...text.matchAll(/(?:NoClassDefFoundError|ClassNotFoundException):\s*([^\n]+)/gi)].at(-1)?.[1]?.trim();
    return { reason: 'libraries', message: `A required game or loader library is missing${missingClass ? `: ${missingClass}` : ''}. Reinstall this version and try again.` };
  }
  const causedBy = [...text.matchAll(/^\s*Caused by:\s*(.+)$/gim)]
    .map(match => match[1].trim())
    .filter(Boolean)
    .at(-1);
  if (causedBy) return { reason: 'exception', message: causedBy.slice(0, 500) };
  const exceptionLine = text.split('\n')
    .map(line => line.trim())
    .filter(line => /(?:exception|error)(?::|\s)/i.test(line) && !/^\s*at\s/.test(line))
    .at(-1);
  if (exceptionLine) return { reason: 'exception', message: exceptionLine.slice(0, 500) };
  const usefulLines = text.split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^\s*at\s/.test(line) && !/^\.\.\.\s+\d+\s+more$/i.test(line) && !/^\[\d{2}:\d{2}:\d{2}/.test(line));
  return { reason: 'unknown', message: (usefulLines.at(-1) || text.slice(-500)).slice(0, 500) };
}

export function summarizeLaunchFailure(output) {
  return diagnoseLaunchFailure(output).message;
}

async function readLatestLaunchLog(gameDir) {
  const latestLog = path.join(gameDir, 'logs', 'latest.log');
  try {
    const stats = await fs.promises.stat(latestLog);
    if (!stats.isFile()) return '';
    const handle = await fs.promises.open(latestLog, 'r');
    try {
      const length = Math.min(stats.size, 64 * 1024);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, Math.max(0, stats.size - length));
      return buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return '';
  }
}

async function readLatestCrashReport(gameDir) {
  const crashDir = path.join(gameDir, 'crash-reports');
  try {
    const entries = await fs.promises.readdir(crashDir, { withFileTypes: true });
    const candidates = await Promise.all(entries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.txt'))
      .map(async entry => {
        const filePath = path.join(crashDir, entry.name);
        const stats = await fs.promises.stat(filePath);
        return { filePath, mtimeMs: stats.mtimeMs, size: stats.size };
      }));
    const newest = candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
    if (!newest || Date.now() - newest.mtimeMs > 10 * 60 * 1000) return '';
    const handle = await fs.promises.open(newest.filePath, 'r');
    try {
      const length = Math.min(newest.size, 128 * 1024);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, 0);
      return buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return '';
  }
}

export async function stageModsForSafeMode(gameDir, onLog = null) {
  const modsDir = path.join(gameDir, 'mods');
  const stagingDir = path.join(gameDir, '.blazzy-safe-mode', `mods-${Date.now()}`);
  let stagedFiles = [];
  try {
    const entries = await fs.promises.readdir(modsDir, { withFileTypes: true });
    stagedFiles = entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.jar')).map(entry => entry.name);
    if (stagedFiles.length === 0) return async () => {};
    await fs.promises.mkdir(stagingDir, { recursive: true });
    for (const fileName of stagedFiles) {
      await fs.promises.rename(path.join(modsDir, fileName), path.join(stagingDir, fileName));
    }
    onLog?.('warn', `Safe mode: temporarily disabled ${stagedFiles.length} mod${stagedFiles.length === 1 ? '' : 's'} for this launch.`);
  } catch (error) {
    onLog?.('error', `Could not prepare safe mode: ${error?.message || error}`);
    throw error;
  }

  let restored = false;
  return async () => {
    if (restored) return;
    restored = true;
    await fs.promises.mkdir(modsDir, { recursive: true });
    for (const fileName of stagedFiles) {
      const stagedPath = path.join(stagingDir, fileName);
      if (!fs.existsSync(stagedPath)) continue;
      try {
        await fs.promises.rename(stagedPath, path.join(modsDir, fileName));
      } catch (error) {
        onLog?.('error', `Could not restore safe-mode mod ${fileName}: ${error?.message || error}`);
      }
    }
    await fs.promises.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    onLog?.('info', 'Safe mode: restored your mods after Minecraft closed.');
  };
}

export function makeOfflineUuid(seed) {
  const bytes = crypto.createHash('md5').update(`OfflinePlayer:${seed}`, 'utf8').digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hash = bytes.toString('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

export function splitCommandLine(value) {
  const input = String(value || '').trim();
  if (!input) return [];
  const args = [];
  let current = '';
  let quote = '';
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '\\' && quote !== "'") {
      const next = input[index + 1];
      if (next && (next === quote || next === '\\' || (!quote && /\s/.test(next)))) {
        current += next;
        index += 1;
      } else {
        current += character;
      }
    } else if (quote) {
      if (character === quote) quote = '';
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += character;
    }
  }
  if (current) args.push(current);
  return args;
}

export async function extractNativeLibraries(nativeArchives, nativeDir) {
  await fs.promises.rm(nativeDir, { recursive: true, force: true });
  await fs.promises.mkdir(nativeDir, { recursive: true });
  const root = path.resolve(nativeDir);

  for (const archive of nativeArchives) {
    if (!archive?.path || !isValidJarFile(archive.path)) continue;
    const exclusions = Array.isArray(archive.exclude) ? archive.exclude : [];
    const zip = new AdmZip(archive.path);
    for (const entry of zip.getEntries()) {
      const entryName = String(entry.entryName || '').replace(/\\/g, '/');
      if (!entryName || entry.isDirectory || entryName.startsWith('META-INF/')) continue;
      if (exclusions.some(prefix => entryName.startsWith(String(prefix || '').replace(/\\/g, '/')))) continue;
      const outputPath = path.resolve(nativeDir, entryName);
      if (outputPath !== root && !outputPath.startsWith(`${root}${path.sep}`)) continue;
      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.promises.writeFile(outputPath, entry.getData());
    }
  }
}

export function resolveMinecraftVersion(versionCandidate) {
  if (!versionCandidate) return '';
  if (typeof versionCandidate === 'object') {
    const raw = versionCandidate.inheritsFrom || versionCandidate.mcVer || versionCandidate.minecraftVersion || versionCandidate.gameVersion || versionCandidate.baseVersion || versionCandidate.id || '';
    if (!raw || raw === versionCandidate) return '';
    return resolveMinecraftVersion(raw);
  }
  const str = String(versionCandidate).trim();
  if (!str || str.toLowerCase() === 'all' || str.toLowerCase() === 'auto') return '';

  const loaderMatch = str.match(/(?:fabric|quilt)-loader-[^-]+-(.+)$/i);
  if (loaderMatch) return loaderMatch[1];

  const spaceHyphenMatch = str.match(/(?:fabric|forge|neoforge|quilt)\s+[^\s-]+\s*-\s*(.+)/i);
  if (spaceHyphenMatch) return spaceHyphenMatch[1];

  const forgeMatch = str.match(/(\d+\.\d+(?:\.\d+)?)[-_](?:forge|neoforge)/i) || str.match(/(?:^|\b)(?:forge|neoforge)[-_](\d+\.\d+(?:\.\d+)?)/i);
  if (forgeMatch) return forgeMatch[1];

  const trailingMatch = str.match(/(?:^|[^0-9.])(\d+\.\d+(?:\.\d+)?)$/);
  if (trailingMatch && (str.includes('-') || str.includes('_') || str.includes(' '))) {
    return trailingMatch[1];
  }

  return str;
}

export function mergeVersionMetadata(baseVersionJson, customVersionJson) {
  if (!baseVersionJson) return customVersionJson || null;
  if (!customVersionJson) return baseVersionJson;

  const baseGameArgs = Array.isArray(baseVersionJson.arguments?.game)
    ? baseVersionJson.arguments.game
    : (baseVersionJson.arguments?.game ? [baseVersionJson.arguments.game] : []);
  const customGameArgs = Array.isArray(customVersionJson.arguments?.game)
    ? customVersionJson.arguments.game
    : (customVersionJson.arguments?.game ? [customVersionJson.arguments.game] : []);

  const baseJvmArgs = Array.isArray(baseVersionJson.arguments?.jvm)
    ? baseVersionJson.arguments.jvm
    : (baseVersionJson.arguments?.jvm ? [baseVersionJson.arguments.jvm] : []);
  const customJvmArgs = Array.isArray(customVersionJson.arguments?.jvm)
    ? customVersionJson.arguments.jvm
    : (customVersionJson.arguments?.jvm ? [customVersionJson.arguments.jvm] : []);

  return {
    ...baseVersionJson,
    ...customVersionJson,
    libraries: [...(baseVersionJson.libraries || []), ...(customVersionJson.libraries || [])],
    arguments: {
      game: [...baseGameArgs, ...customGameArgs],
      jvm: [...baseJvmArgs, ...customJvmArgs],
    },
    downloads: customVersionJson.downloads || baseVersionJson.downloads,
    assetIndex: customVersionJson.assetIndex || baseVersionJson.assetIndex,
    mainClass: customVersionJson.mainClass || baseVersionJson.mainClass,
    inheritsFrom: customVersionJson.inheritsFrom || baseVersionJson.inheritsFrom,
    minecraftArguments: customVersionJson.minecraftArguments || baseVersionJson.minecraftArguments,
    javaVersion: customVersionJson.javaVersion || baseVersionJson.javaVersion,
    assets: customVersionJson.assets || baseVersionJson.assets,
    type: customVersionJson.type || baseVersionJson.type,
  };
}

export function selectLoaderClasspath(classpathParts, libraries, baseDir, mainClass) {
  const main = String(mainClass || '');
  const loaderKey = main.includes('net.fabricmc.loader.impl.launch.knot.KnotClient')
    ? 'net.fabricmc:fabric-loader:'
    : main.includes('org.quiltmc.loader.impl.launch.knot.KnotClient')
      ? 'org.quiltmc:quilt-loader:'
      : '';
  if (!loaderKey) return [...classpathParts];

  const selectedLibrary = [...(libraries || [])].reverse().find((library) => getMavenLibraryKey(library?.name)?.key === loaderKey);
  if (!selectedLibrary) return [...classpathParts];
  const selectedPath = selectedLibrary?.downloads?.artifact?.path
    ? path.join(baseDir, 'libraries', selectedLibrary.downloads.artifact.path)
    : getLibraryPathFromName(selectedLibrary.name, baseDir);
  const loaderRoot = loaderKey.startsWith('net.fabricmc')
    ? path.join(baseDir, 'libraries', 'net', 'fabricmc', 'fabric-loader')
    : path.join(baseDir, 'libraries', 'org', 'quiltmc', 'quilt-loader');
  const normalizedRoot = `${path.resolve(loaderRoot)}${path.sep}`;
  const withoutLoaderDuplicates = classpathParts.filter((entry) => {
    const normalizedEntry = path.resolve(String(entry || ''));
    return normalizedEntry !== path.resolve(selectedPath) && !normalizedEntry.startsWith(normalizedRoot);
  });
  return [selectedPath, ...withoutLoaderDuplicates];
}

export async function findLocalVersionJar(versionDir, preferredNames = []) {
  if (!versionDir) return null;
  const preferred = new Set(
    preferredNames.filter(Boolean).map(value => String(value).trim()).flatMap(value => [value, `${value}.jar`])
  );
  try {
    const entries = await fs.promises.readdir(versionDir, { withFileTypes: true });
    const jarFiles = entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.jar')).map(entry => entry.name);
    for (const fileName of jarFiles) {
      if (preferred.has(fileName) || preferred.has(fileName.replace(/\.jar$/i, ''))) {
        const fullPath = path.join(versionDir, fileName);
        if (isValidJarFile(fullPath)) return fullPath;
        try { await fs.promises.unlink(fullPath); } catch { }
      }
    }
    for (const fileName of jarFiles.sort()) {
      const fullPath = path.join(versionDir, fileName);
      if (isValidJarFile(fullPath)) return fullPath;
      try { await fs.promises.unlink(fullPath); } catch { }
    }
    return null;
  } catch { return null; }
}

export function versionToTuple(version) {
  const value = String(version || '').trim();
  const lower = value.toLowerCase();
  let versionType = 2;
  if (lower.includes('alpha')) versionType = 0;
  else if (lower.includes('beta')) versionType = 1;
  const match = value.match(/(\d+(?:\.\d+)*)/);
  if (!match) return [versionType, 0];
  return [versionType, ...match[1].split('.').map(part => Number(part) || 0)];
}

export function compareVersionTuples(left, right) {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }
  return 0;
}

export function getMavenLibraryKey(name) {
  const parts = String(name || '').trim().split(':');
  if (parts.length < 3) return null;

  const group = parts[0] || '';
  const artifact = parts[1] || '';
  const version = parts[2] || '';
  const classifierPart = parts[3] || '';
  const classifier = classifierPart.includes('@') ? classifierPart.split('@')[0] : classifierPart;

  if (!group || !artifact || !version) return null;

  return {
    key: `${group}:${artifact}:${classifier || ''}`,
    version,
  };
}

export function parseFabricModConflict(logText) {
  if (!logText || typeof logText !== 'string') return null;
  const isConflict = logText.includes('Incompatible mods found!') ||
    logText.includes('net.fabricmc.loader.impl.FormattedException') ||
    logText.includes('Mod resolution failed') ||
    logText.includes('Some of your mods are incompatible');
  if (!isConflict) return null;

  let description = '';
  const match = logText.match(/(?:Incompatible mods found!|Some of your mods are incompatible[^\n]*)([\s\S]*?)(?=at net\.fabricmc\.loader|$)/i);
  if (match) {
    description = match[0].trim();
  } else {
    const fallback = logText.match(/FormattedException:([\s\S]*?)(?=at net\.fabricmc\.loader|$)/i);
    if (fallback) {
      description = fallback[0].trim();
    } else {
      const modRes = logText.match(/(?:Mod resolution failed[\s\S]*?)(?=\n\s*\n\s*\n|$)/i);
      if (modRes) {
        description = modRes[0].trim();
      }
    }
  }

  const suggestedUpdates = [];
  const fixMatches = logText.matchAll(/replace\s*\[\[([a-z0-9_-]+)[^\]]*\]\s*->\s*add:([a-z0-9_-]+)\s+([0-9a-z.+_-]+)/gi);
  for (const fm of fixMatches) {
    suggestedUpdates.push({
      oldModId: fm[1],
      modId: fm[2],
      targetVersion: fm[3],
    });
  }

  const textMatches = logText.matchAll(/(?:Cambia el mod|Replace mod)\s+'([^']+)'\s*\(([^)]+)\)[^\n]+?(?:la versión|version)\s+([0-9a-z.+_-]+)/gi);
  for (const tm of textMatches) {
    const cleanVersion = String(tm[3] || '').replace(/[.,;:!]+$/, '');
    if (!suggestedUpdates.some(u => u.modId.toLowerCase() === tm[2].toLowerCase())) {
      suggestedUpdates.push({
        displayName: tm[1],
        modId: tm[2],
        targetVersion: cleanVersion,
      });
    }
  }

  const compatFixes = [];
  const compatTargetMatches = logText.matchAll(/(?:Cambia el mod|Replace mod)\s+'([^']+)'\s*\(([^)]+)\)[^\n]+?(?:compatible con|compatible with):\s*\n\s*-\s*([a-z0-9_-]+)\s+([0-9a-z.+_-]+)/gi);
  for (const cm of compatTargetMatches) {
    const modId = cm[2].toLowerCase();
    const requiredBy = cm[3].toLowerCase();
    if (modId === 'sodium' && requiredBy === 'iris') {
      compatFixes.push({
        type: 'downgrade_to_compatible',
        modId: 'sodium',
        displayName: 'Sodium',
        targetVersion: '0.8.7',
        cascade: [
          { modId: 'sodium-extra', targetVersion: '0.8.3' },
          { modId: 'reeses-sodium-options', targetVersion: '2.1.0' },
        ]
      });
    }
  }

  const conflictingMods = [];
  const incompMatches = logText.matchAll(/['"]([^'"]+)['"]\s*\(([a-z0-9_-]+)\)[^\n]+?(?:no es compatible con|is incompatible with)[^\n]+?['"]([^'"]+)['"]\s*\(([a-z0-9_-]+)\)/gi);
  for (const im of incompMatches) {
    const modA = { name: im[1], id: im[2] };
    const modB = { name: im[3], id: im[4] };
    if (!conflictingMods.some(m => m.id.toLowerCase() === modA.id.toLowerCase())) {
      conflictingMods.push(modA);
    }
    if (!conflictingMods.some(m => m.id.toLowerCase() === modB.id.toLowerCase())) {
      conflictingMods.push(modB);
    }
  }

  return {
    isConflict: true,
    rawDescription: description || logText.slice(-1500),
    suggestedUpdates,
    conflictingMods,
    compatFixes,
  };
}

export async function launchMinecraft(opts, { onLog = null, onAssetProgress = null, onExit = null, onConflict = null } = {}) {
  const { profile, version: rawVersion, instanceId } = opts || {};
  const features = opts?.features || {};
  let version = rawVersion || profile?.version || null;
  if (typeof version === 'string') {
    version = { id: version, label: version, mcVer: version, type: 'vanilla' };
  }
  const rawId = String(version?.id || profile?.version || (typeof rawVersion === 'string' ? rawVersion : rawVersion?.id) || '').trim();
  const mcVer = resolveMinecraftVersion(version) || resolveMinecraftVersion(rawId) || rawId;
  const baseDir = getMinecraftRoot();
  const gameDir = instanceId ? getInstanceDir(instanceId) : baseDir;
  const versionDir = version?.path && String(version.path).trim()
    ? String(version.path).trim()
    : path.join(baseDir, 'versions', rawId || mcVer);

  let versionJson = version?.versionJson || null;
  if (!versionJson) versionJson = await loadLocalVersionMetadata(versionDir);
  if (!versionJson && rawId && rawId !== path.basename(versionDir)) {
    versionJson = await loadLocalVersionMetadata(path.join(baseDir, 'versions', rawId));
  }
  if (!versionJson && mcVer && mcVer !== rawId) {
    versionJson = await loadLocalVersionMetadata(path.join(baseDir, 'versions', mcVer));
  }

  const versionType = String(version?.type || '').toLowerCase();
  const inheritedVersionId = String(versionJson?.inheritsFrom || (versionType !== 'vanilla' && mcVer !== rawId ? mcVer : '')).trim();
  let inheritedVersionJson = null;

  if (inheritedVersionId) {
    const vanillaVersionDir = path.join(baseDir, 'versions', inheritedVersionId);
    inheritedVersionJson = await loadLocalVersionMetadata(vanillaVersionDir);
    if (!inheritedVersionJson) {
      try {
        inheritedVersionJson = await loadMojangVersionMetadata(inheritedVersionId);
      } catch (error) {
        if (versionType === 'vanilla') throw error;
      }
    }
  }

  let jarPath = null;
  if (inheritedVersionId) {
    const vanillaVersionDir = path.join(baseDir, 'versions', inheritedVersionId);
    jarPath = await findLocalVersionJar(vanillaVersionDir, [inheritedVersionId]);
  }
  if (!jarPath) {
    jarPath = await findLocalVersionJar(versionDir, [rawId, version?.id, version?.label, mcVer]);
  }
  if (!jarPath && mcVer && mcVer !== rawId) {
    const mcVerDir = path.join(baseDir, 'versions', mcVer);
    jarPath = await findLocalVersionJar(mcVerDir, [mcVer]);
  }

  if (!versionJson && (versionType === 'vanilla' || !versionType)) {
    try {
      versionJson = await loadMojangVersionMetadata(mcVer || rawId);
    } catch { }
  }

  if (!versionJson) {
    const customLabel = String(version?.label || version?.id || mcVer || 'custom version');
    return { error: 'CustomVersionMetadataMissing', message: `Could not read local launch metadata for '${customLabel}'.` };
  }

  versionJson = mergeVersionMetadata(inheritedVersionJson, versionJson);

  await fs.promises.mkdir(versionDir, { recursive: true });
  if (!jarPath) {
    const clientUrl = inheritedVersionJson?.downloads?.client?.url || versionJson?.downloads?.client?.url;

    if (inheritedVersionId) {
      const vanillaVersionDir = path.join(baseDir, 'versions', inheritedVersionId);
      await fs.promises.mkdir(vanillaVersionDir, { recursive: true });
      const vanillaJarPath = path.join(vanillaVersionDir, `${inheritedVersionId}.jar`);
      if (!clientUrl) throw new Error(`Could not find client download URL for ${inheritedVersionId}. Install vanilla ${inheritedVersionId} first or check your internet connection.`);
      onLog?.('info', `Downloading vanilla ${inheritedVersionId} client jar...`);
      await ensureJarFile(clientUrl, vanillaJarPath, { onLog });
      jarPath = vanillaJarPath;
    } else {
      if (!clientUrl) throw new Error(`Local client jar not found for ${String(version?.label || rawId || mcVer || 'version')}.`);
      const targetJarName = mcVer || rawId || 'version';
      const targetJarDir = path.join(baseDir, 'versions', targetJarName);
      await fs.promises.mkdir(targetJarDir, { recursive: true });
      const fallbackJarPath = path.join(targetJarDir, `${targetJarName}.jar`);
      await ensureJarFile(clientUrl, fallbackJarPath, { onLog });
      jarPath = fallbackJarPath;
    }
  }

  const libraries = versionJson?.libraries || [];
  const libsDir = path.join(baseDir, 'libraries');
  await fs.promises.mkdir(libsDir, { recursive: true });
  const classpathParts = [];
  const classpathLibraryEntries = new Map();

  onLog?.('info', 'Verifying game libraries...');

  const missingLibraries = [];
  const nativeArchives = [];
  for (const lib of libraries) {
    if (!rulesPassForCurrentSystem(lib?.rules, features)) continue;
    const artifact = lib?.downloads?.artifact || {};
    const resolvedLibraryPath = artifact?.path
      ? path.join(libsDir, artifact.path)
      : lib?.name
        ? getLibraryPathFromName(lib.name, baseDir)
        : null;

    const candidateUrls = [];
    if (lib?.downloads?.artifact?.url) candidateUrls.push(lib.downloads.artifact.url);
    candidateUrls.push(...resolveLibraryArtifactCandidates(lib));

    if (resolvedLibraryPath) {
      if (!await verifyJarFile(resolvedLibraryPath, artifact) && candidateUrls.length > 0) {
        if (fs.existsSync(resolvedLibraryPath)) {
          onLog?.('warn', `Repairing corrupt library: ${path.basename(resolvedLibraryPath)}`);
        }
        missingLibraries.push({
          urls: candidateUrls,
          path: resolvedLibraryPath,
          expectedSha1: artifact?.sha1 || '',
          expectedSize: artifact?.size || null,
        });
      }
      if (lib?.name) {
        const libraryKeyInfo = getMavenLibraryKey(lib.name);
        if (libraryKeyInfo) {
          // Version metadata is merged base-first and child-last. The child
          // entry must win even when its Maven version is numerically lower.
          classpathLibraryEntries.set(libraryKeyInfo.key, {
            path: resolvedLibraryPath,
            version: libraryKeyInfo.version,
          });
        } else {
          classpathParts.push(resolvedLibraryPath);
        }
      } else {
        classpathParts.push(resolvedLibraryPath);
      }
    }

    if (lib?.natives) {
      const platformKey = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
      const archToken = process.arch === 'x64' || process.arch === 'arm64' ? '64' : '32';
      const classifier = String(lib.natives[platformKey] || '').replace('${arch}', archToken);
      const nativeArtifact = classifier ? lib?.downloads?.classifiers?.[classifier] : null;
      const nativeUrl = nativeArtifact?.url || null;
      if (nativeUrl) {
        const nativeOut = nativeArtifact?.path
          ? path.join(libsDir, nativeArtifact.path)
          : getLibraryPathFromName(`${lib.name}:${classifier}`, baseDir);
        if (!await verifyJarFile(nativeOut, nativeArtifact)) {
          missingLibraries.push({
            urls: [nativeUrl],
            path: nativeOut,
            expectedSha1: nativeArtifact?.sha1 || '',
            expectedSize: nativeArtifact?.size || null,
          });
        }
        nativeArchives.push({ path: nativeOut, exclude: lib?.extract?.exclude || [] });
      }
    }
  }

  if (missingLibraries.length > 0) {
    onLog?.('info', `Downloading ${missingLibraries.length} missing libraries...`);
    let libIdx = 0;
    const libWorker = async () => {
      while (libIdx < missingLibraries.length) {
        const item = missingLibraries[libIdx++];
        if (!item) break;
        if (await verifyJarFile(item.path, { sha1: item.expectedSha1, size: item.expectedSize })) continue;
        try { await fs.promises.unlink(item.path); } catch { }
        let downloaded = false;
        for (const url of item.urls) {
          try {
            await ensureJarFile(url, item.path, {
              onLog,
              expectedSha1: item.expectedSha1,
              expectedSize: item.expectedSize,
            });
            downloaded = true;
            break;
          } catch { }
        }
        if (!downloaded) {
          onLog?.('stderr', `Library download failed for ${path.basename(item.path)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(16, missingLibraries.length) }, () => libWorker()));
    const libraryValidation = await Promise.all(missingLibraries.map(item => verifyJarFile(item.path, {
      sha1: item.expectedSha1,
      size: item.expectedSize,
    })));
    const unresolvedLibraries = missingLibraries.filter((item, index) => !libraryValidation[index]);
    if (unresolvedLibraries.length > 0) {
      const examples = unresolvedLibraries.slice(0, 3).map(item => path.basename(item.path)).join(', ');
      return {
        error: 'LibraryDownloadFailed',
        message: `Could not download ${unresolvedLibraries.length} required game ${unresolvedLibraries.length === 1 ? 'library' : 'libraries'}${examples ? `: ${examples}` : ''}.`,
      };
    }
    onLog?.('info', 'Libraries verified.');
  }

  const nativeVersionKey = String(rawId || mcVer || 'default').replace(/[^a-z0-9._-]/gi, '_');
  const nativeDir = path.join(baseDir, 'native-extract', nativeVersionKey);
  if (nativeArchives.length > 0) {
    onLog?.('info', 'Preparing native game libraries...');
    await extractNativeLibraries(nativeArchives, nativeDir);
  } else {
    await fs.promises.mkdir(nativeDir, { recursive: true });
  }

  for (const entry of classpathLibraryEntries.values()) {
    classpathParts.push(entry.path);
  }

  const assetIndexUrl = versionJson?.assetIndex?.url || null;
  if (assetIndexUrl) {
    try {
      const assetIndexId = String(versionJson?.assetIndex?.id || versionJson?.assets || 'legacy').trim();
      const assetsBase = path.join(baseDir, 'assets');
      const indexesDir = path.join(assetsBase, 'indexes');
      const objectsDir = path.join(assetsBase, 'objects');
      await fs.promises.mkdir(indexesDir, { recursive: true });
      await fs.promises.mkdir(objectsDir, { recursive: true });
      const indexPath = path.join(indexesDir, `${assetIndexId}.json`);

      let ai = null;
      if (fs.existsSync(indexPath)) {
        try {
          ai = JSON.parse(await fs.promises.readFile(indexPath, 'utf8'));
        } catch { }
      }

      if (!ai) {
        onLog?.('info', `Fetching asset index (${assetIndexId})...`);
        const aiRes = await fetch(assetIndexUrl);
        if (aiRes.ok) {
          ai = await aiRes.json();
          try {
            await fs.promises.writeFile(indexPath, JSON.stringify(ai, null, 2), 'utf8');
          } catch { }
        }
      }

      if (ai?.objects) {
        const objects = ai.objects;
        const keys = Object.keys(objects);
        const missing = [];
        for (const key of keys) {
          const hash = objects[key].hash;
          const expectedSize = Number(objects[key].size || 0);
          const sub = hash.slice(0, 2);
          const outDir = path.join(objectsDir, sub);
          const outPath = path.join(outDir, hash);
          const currentSize = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
          if (currentSize === 0 || (expectedSize > 0 && currentSize !== expectedSize)) {
            missing.push({ hash, sub, outDir, outPath });
          }
        }

        if (missing.length > 0) {
          onLog?.('info', `Downloading ${missing.length} game assets...`);
          let completed = 0;
          let lastPercent = 0;
          let assetIdx = 0;
          const failedAssets = [];
          const assetWorker = async () => {
            while (assetIdx < missing.length) {
              const item = missing[assetIdx++];
              if (!item) break;
              try {
                await fs.promises.mkdir(item.outDir, { recursive: true });
                const url = `https://resources.download.minecraft.net/${item.sub}/${item.hash}`;
                const r = await fetch(url);
                if (r.ok) {
                  await saveResponseBodyToFile(r, item.outPath);
                }
                const downloaded = await fs.promises.readFile(item.outPath);
                const downloadedHash = crypto.createHash('sha1').update(downloaded).digest('hex');
                if (downloadedHash !== item.hash) {
                  try { await fs.promises.unlink(item.outPath); } catch { }
                  throw new Error('SHA-1 mismatch');
                }
              } catch {
                failedAssets.push(item.hash);
              }
              completed++;
              const percent = Math.round((completed / missing.length) * 100);
              if (percent >= lastPercent + 25) {
                lastPercent = Math.floor(percent / 25) * 25;
                onLog?.('info', `Assets: ${percent}% (${completed}/${missing.length})`);
              }
              if (completed % 50 === 0 || completed === missing.length) {
                onAssetProgress?.({ total: missing.length, done: completed, percent });
              }
            }
          };
          await Promise.all(Array.from({ length: Math.min(24, missing.length) }, () => assetWorker()));
          if (failedAssets.length > 0) {
            return {
              error: 'AssetDownloadFailed',
              message: `Could not download ${failedAssets.length} required Minecraft ${failedAssets.length === 1 ? 'asset' : 'assets'}. Check your connection and try again.`,
            };
          }
          onLog?.('info', 'Game assets ready.');
        }
      }
    } catch (e) {
      onLog?.('stderr', `Asset download warning: ${e.message}`);
    }
  }

  if (jarPath) classpathParts.push(jarPath);
  const mainClass = versionJson?.mainClass || (versionJson?.minecraftArguments ? 'net.minecraft.client.main.Main' : null);
  if (!mainClass) return { error: 'NoMainClass', message: 'Could not determine main class for the version.' };

  const performanceMode = profile?.performanceMode !== false;
  if (performanceMode) {
    try {
      await applyPerformanceOptions(gameDir);
      onLog?.('info', '⚡ FPS Boost enabled: performance video settings and low-latency JVM tuning applied.');
    } catch (error) {
      onLog?.('warn', `FPS Boost could not update video settings: ${error?.message || error}`);
    }
    if (opts?.online !== false && !opts?.safeMode && String(mainClass).includes('net.fabricmc.loader.impl.launch.knot.KnotClient')) {
      const installedPerformanceMods = await ensureFabricPerformanceMods({ gameVersion: mcVer, gameDir, instanceId, onLog });
      if (installedPerformanceMods.length > 0) {
        onLog?.('success', `⚡ FPS Boost installed: ${installedPerformanceMods.join(', ')}.`);
      }
    }
  }

  const session = opts.session || {};
  const resolvedName = session.name || session.username || profile?.localName || profile?.name || 'Player';
  const normalizedSession = {
    name: resolvedName,
    uuid: session.uuid || session.id || makeOfflineUuid(resolvedName),
    accessToken: session.accessToken || session.access_token || '0',
    userType: session.userType || session.user_type || (session.accessToken && session.accessToken !== '0' ? 'msa' : 'legacy'),
  };

  const substitutions = {
    '${auth_player_name}': normalizedSession.name,
    '${auth_uuid}': normalizedSession.uuid,
    '${auth_access_token}': normalizedSession.accessToken,
    '${auth_session}': normalizedSession.accessToken,
    '${version_name}': versionJson?.id || mcVer,
    '${game_directory}': gameDir,
    '${assets_root}': path.join(baseDir, 'assets'),
    '${assets_index_name}': versionJson?.assets || '',
    '${user_type}': normalizedSession.userType,
    '${version_type}': versionJson?.type || 'release',
    '${user_properties}': '{}',
    '${auth_xuid}': String(session.xuid || ''),
    '${clientid}': String(session.clientId || session.client_id || ''),
  };

  let gameArgs = [];

  if (versionJson?.arguments?.game) {
    for (const arg of versionJson.arguments.game) {
      if (typeof arg === 'string') {
        let s = arg;
        for (const [k, v] of Object.entries(substitutions)) s = s.replaceAll(k, v);
        gameArgs.push(s);
      } else if (arg && typeof arg === 'object') {
        if (!rulesPassForCurrentSystem(arg.rules, features)) continue;
        const val = arg.value;
        if (Array.isArray(val)) {
          for (let part of val) {
            for (const [k, v] of Object.entries(substitutions)) part = part.replaceAll(k, v);
            gameArgs.push(part);
          }
        } else if (typeof val === 'string') {
          let s = val;
          for (const [k, v] of Object.entries(substitutions)) s = s.replaceAll(k, v);
          gameArgs.push(s);
        }
      }
    }
  } else if (versionJson?.minecraftArguments) {
    const parts = splitCommandLine(versionJson.minecraftArguments);
    for (let p of parts) {
      for (const [k, v] of Object.entries(substitutions)) p = p.replaceAll(k, v);
      if (!gameArgs.includes(p)) gameArgs.push(p);
    }
  } else {
    gameArgs.push('--username', normalizedSession.name);
    gameArgs.push('--version', versionJson?.id || mcVer);
    gameArgs.push('--gameDir', gameDir);
    gameArgs.push('--assetsDir', path.join(baseDir, 'assets'));
    gameArgs.push('--assetIndex', versionJson?.assets || 'legacy');
    gameArgs.push('--uuid', normalizedSession.uuid);
    gameArgs.push('--accessToken', normalizedSession.accessToken);
    gameArgs.push('--userType', normalizedSession.userType);
    gameArgs.push('--versionType', versionJson?.type || 'release');
  }

  if (!gameArgs.includes('--username')) gameArgs.push('--username', normalizedSession.name);
  if (!gameArgs.includes('--version')) gameArgs.push('--version', versionJson?.id || mcVer);
  if (!gameArgs.includes('--gameDir')) gameArgs.push('--gameDir', gameDir);
  if (!gameArgs.includes('--assetsDir')) gameArgs.push('--assetsDir', path.join(baseDir, 'assets'));
  if (!gameArgs.includes('--assetIndex')) gameArgs.push('--assetIndex', String(versionJson?.assets || versionJson?.assetIndex?.id || 'legacy'));
  if (!gameArgs.includes('--uuid')) gameArgs.push('--uuid', normalizedSession.uuid);
  if (!gameArgs.includes('--accessToken')) gameArgs.push('--accessToken', normalizedSession.accessToken);
  if (!gameArgs.includes('--userType')) gameArgs.push('--userType', normalizedSession.userType);
  if (!gameArgs.includes('--versionType')) gameArgs.push('--versionType', versionJson?.type || 'release');

  const selectedClasspathParts = selectLoaderClasspath(classpathParts, libraries, baseDir, mainClass);
  classpathParts.splice(0, classpathParts.length, ...selectedClasspathParts);

  const requestedRamGb = Number(profile?.ram || 4);
  const safeRamGb = calculateSafeRamGb(requestedRamGb);
  if (safeRamGb < requestedRamGb) {
    onLog?.('warn', `Requested ${requestedRamGb} GB RAM exceeds the safe limit for this PC. Launching with ${safeRamGb} GB.`);
  }

  const jvmArgs = [
    `-Djava.library.path=${nativeDir}`,
    `-DlibraryDirectory=${path.join(baseDir, 'libraries')}`,
    `-Xmx${safeRamGb}G`,
    '--add-exports', 'java.base/jdk.internal.ref=ALL-UNNAMED',
    '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
    '--add-opens', 'java.base/sun.nio.ch=ALL-UNNAMED',
    '--add-opens', 'java.base/java.util=ALL-UNNAMED',
    '--add-opens', 'java.base/java.util.concurrent=ALL-UNNAMED',
  ];

  const jvmSubstitutions = {
    ...substitutions,
    '${natives_directory}': nativeDir,
    '${launcher_name}': 'Blazzy Client',
    '${launcher_version}': app.getVersion(),
    '${classpath}': classpathParts.join(path.delimiter),
    '${classpath_separator}': path.delimiter,
    '${library_directory}': path.join(baseDir, 'libraries'),
  };

  if (versionJson?.arguments?.jvm) {
    for (const arg of versionJson.arguments.jvm) {
      if (typeof arg === 'string') {
        let s = arg;
        for (const [k, v] of Object.entries(jvmSubstitutions)) s = s.replaceAll(k, v);
        jvmArgs.push(s);
      } else if (arg && typeof arg === 'object') {
        if (!rulesPassForCurrentSystem(arg.rules, features)) continue;
        const val = arg.value;
        if (Array.isArray(val)) {
          for (let part of val) {
            for (const [k, v] of Object.entries(jvmSubstitutions)) part = part.replaceAll(k, v);
            jvmArgs.push(part);
          }
        } else if (typeof val === 'string') {
          let s = val;
          for (const [k, v] of Object.entries(jvmSubstitutions)) s = s.replaceAll(k, v);
          jvmArgs.push(s);
        }
      }
    }
  }

  const userArgs = [];
  if (profile?.jvmArguments) {
    const args = splitCommandLine(profile.jvmArguments);
    userArgs.push(...args);
  }
  if (opts?.jvmArguments) {
    const args = splitCommandLine(opts.jvmArguments);
    userArgs.push(...args);
  }

  const allCurrentArgs = [...jvmArgs, ...userArgs];
  const hasExplicitGC = allCurrentArgs.some(arg => /^-XX:\+(UseG1GC|UseZGC|UseParallelGC|UseSerialGC|UseConcMarkSweepGC|UseShenandoahGC)/i.test(arg));

  const hasUserXmx = userArgs.some(arg => arg.startsWith('-Xmx'));
  let finalJvmArgs = [...jvmArgs];
  if (hasUserXmx) {
    finalJvmArgs = jvmArgs.filter(arg => !arg.startsWith('-Xmx'));
  }

  for (const arg of userArgs) {
    if (!finalJvmArgs.includes(arg)) finalJvmArgs.push(arg);
  }
  jvmArgs.length = 0;
  jvmArgs.push(...finalJvmArgs);

  if (process.platform === 'darwin' && !jvmArgs.includes('-XstartOnFirstThread')) {
    jvmArgs.push('-XstartOnFirstThread');
  }

  let configuredJavaPath = '';
  let javaPathSource = '';

  if (profile?.javaPath && String(profile.javaPath).trim()) {
    configuredJavaPath = String(profile.javaPath).trim();
    javaPathSource = 'profile';
  } else if (opts?.javaPath && String(opts.javaPath).trim()) {
    configuredJavaPath = String(opts.javaPath).trim();
    javaPathSource = 'opts';
  } else {
    try {
      const launcherState = await loadLauncherState(app.getPath('userData'));
      if (launcherState.settings?.javaPath && String(launcherState.settings.javaPath).trim()) {
        configuredJavaPath = String(launcherState.settings.javaPath).trim();
        javaPathSource = 'global';
      }
    } catch (error) {
      console.warn('Failed to load saved Java path:', error);
    }
  }

  const requiredJavaMajor = Number(versionJson?.javaVersion?.majorVersion || 0) || requiredJavaForMinecraft(mcVer);

  async function findCompatibleJava() {
    if (requiredJavaMajor) {
      const compatibleJava = findJavaCommand(requiredJavaMajor, '');
      if (compatibleJava?.javaCmd && compatibleJava.javaMajor >= requiredJavaMajor) {
        return { javaCmd: compatibleJava.javaCmd, javaMajor: compatibleJava.javaMajor, source: 'auto-detected (compatible)' };
      }
    }
    const allCandidates = collectCommonJavaCandidates();
    let bestCandidate = null;
    let bestMajor = 0;
    for (const candidate of allCandidates) {
      const major = detectJavaMajor(candidate);
      if (major && major > bestMajor) {
        bestMajor = major;
        bestCandidate = candidate;
      }
    }
    if (bestCandidate) {
      return { javaCmd: bestCandidate, javaMajor: bestMajor, source: 'auto-detected (best available)' };
    }
    return { javaCmd: resolveJavaCommand(''), javaMajor: detectJavaMajor(resolveJavaCommand('')), source: 'system default' };
  }

  let finalJavaCmd;
  let detectedJavaMajor;

  if (configuredJavaPath) {
    if (fs.existsSync(configuredJavaPath)) {
      detectedJavaMajor = detectJavaMajor(configuredJavaPath);
      if (requiredJavaMajor && detectedJavaMajor && detectedJavaMajor >= requiredJavaMajor) {
        finalJavaCmd = configuredJavaPath;
        onLog?.('info', `✅ Using configured Java ${detectedJavaMajor} from ${javaPathSource} (meets requirement Java ${requiredJavaMajor}+)`);
      } else if (requiredJavaMajor && detectedJavaMajor && detectedJavaMajor < requiredJavaMajor) {
        onLog?.('warn', `⚠️ Configured Java ${detectedJavaMajor} from ${javaPathSource} does NOT meet requirement (needs ${requiredJavaMajor}+). Looking for compatible Java...`);
        const compatible = await findCompatibleJava();
        if (compatible.javaCmd && compatible.javaMajor >= requiredJavaMajor) {
          finalJavaCmd = compatible.javaCmd;
          detectedJavaMajor = compatible.javaMajor;
          onLog?.('info', `✅ Found compatible Java ${detectedJavaMajor} from ${compatible.source} (will be used instead of configured Java)`);
        } else {
          finalJavaCmd = configuredJavaPath;
          onLog?.('error', `❌ No compatible Java found. Using configured Java ${detectedJavaMajor} (may not work properly).`);
        }
      } else {
        finalJavaCmd = configuredJavaPath;
        onLog?.('info', `✅ Using configured Java ${detectedJavaMajor || '?'} from ${javaPathSource}`);
      }
    } else {
      onLog?.('warn', `⚠️ Configured Java path not found: ${configuredJavaPath}. Looking for compatible Java...`);
      const compatible = await findCompatibleJava();
      if (compatible.javaCmd) {
        finalJavaCmd = compatible.javaCmd;
        detectedJavaMajor = compatible.javaMajor;
        onLog?.('info', `✅ Using ${compatible.source} Java ${detectedJavaMajor} from ${finalJavaCmd}`);
      } else {
        finalJavaCmd = resolveJavaCommand('');
        detectedJavaMajor = detectJavaMajor(finalJavaCmd);
        onLog?.('warn', `⚠️ Using system default Java ${detectedJavaMajor || '?'} from ${finalJavaCmd}`);
      }
    }
  } else {
    const compatible = await findCompatibleJava();
    if (compatible.javaCmd) {
      finalJavaCmd = compatible.javaCmd;
      detectedJavaMajor = compatible.javaMajor;
      if (detectedJavaMajor) {
        onLog?.('info', `✅ Using ${compatible.source} Java ${detectedJavaMajor} from ${finalJavaCmd}`);
      } else {
        onLog?.('warn', `⚠️ Found ${finalJavaCmd}, but its Java version could not be verified. Preparing a compatible runtime...`);
      }
    } else {
      finalJavaCmd = resolveJavaCommand('');
      detectedJavaMajor = detectJavaMajor(finalJavaCmd);
      onLog?.('warn', `⚠️ Using system default Java ${detectedJavaMajor || '?'} from ${finalJavaCmd}`);
    }
  }

  if (requiredJavaMajor && detectedJavaMajor && detectedJavaMajor < requiredJavaMajor) {
    onLog?.('error', `⚠️ Java ${detectedJavaMajor} is older than required ${requiredJavaMajor}. Game may not work correctly.`);
  }

  if (!detectedJavaMajor || (requiredJavaMajor && detectedJavaMajor < requiredJavaMajor)) {
    try {
      finalJavaCmd = await ensureManagedJava(requiredJavaMajor, onLog);
      detectedJavaMajor = detectJavaMajor(finalJavaCmd);
    } catch (error) {
      const message = error?.message || `Java ${requiredJavaMajor} setup failed.`;
      onLog?.('error', `❌ ${message}`);
      return { ok: false, error: 'JavaSetupFailed', message };
    }
  }

  if (!hasExplicitGC) {
    const gcFlags = performanceMode ? [
        '-XX:+IgnoreUnrecognizedVMOptions',
        '-XX:+UnlockExperimentalVMOptions',
        '-XX:+UseG1GC',
        '-XX:+ParallelRefProcEnabled',
        '-XX:MaxGCPauseMillis=50',
        '-XX:+DisableExplicitGC',
        '-XX:G1NewSizePercent=20',
        '-XX:G1ReservePercent=20',
        '-XX:InitiatingHeapOccupancyPercent=15',
        '-XX:+PerfDisableSharedMem',
        '-Dfile.encoding=UTF-8',
      ] : [
        '-XX:+IgnoreUnrecognizedVMOptions',
        '-XX:+UseG1GC',
        '-XX:+ParallelRefProcEnabled',
        '-XX:MaxGCPauseMillis=200',
        '-XX:+DisableExplicitGC',
      ];
    for (const flag of gcFlags) {
      if (!jvmArgs.includes(flag)) jvmArgs.push(flag);
    }
  }

  let sanitizedJvmArgs = [...jvmArgs];
  if (detectedJavaMajor && detectedJavaMajor < 9) {
    const cleaned = [];
    for (let i = 0; i < sanitizedJvmArgs.length; i++) {
      const current = sanitizedJvmArgs[i];
      if (current === '--add-opens' || current === '--add-exports') {
        i++;
        continue;
      }
      cleaned.push(current);
    }
    sanitizedJvmArgs = cleaned;
  }

  const cleanedJvmArgs = [];
  for (let i = 0; i < sanitizedJvmArgs.length; i++) {
    const current = sanitizedJvmArgs[i];
    if (current === '-cp' || current === '-classpath') {
      i++;
      continue;
    }
    cleanedJvmArgs.push(current);
  }

  const classpath = classpathParts.join(path.delimiter);
  const args = [...cleanedJvmArgs, '-cp', classpath, mainClass, ...gameArgs];

  let restoreSafeModeMods = async () => {};
  if (opts?.safeMode) {
    try {
      restoreSafeModeMods = await stageModsForSafeMode(gameDir, onLog);
    } catch (error) {
      return { ok: false, error: 'SafeModeFailed', message: error?.message || 'Could not temporarily disable mods.' };
    }
  }

  let child;
  try {
    child = spawn(finalJavaCmd, args, { cwd: baseDir });
  } catch (e) {
    await restoreSafeModeMods();
    onLog?.('error', `Failed to launch Java: ${finalJavaCmd}. Error: ${e?.message || e}. Make sure Java is installed.`);
    return { ok: false, error: 'JavaNotFound', message: `Java not found at ${finalJavaCmd}` };
  }

  const spawnError = await new Promise(resolve => {
    child.once('spawn', () => resolve(null));
    child.once('error', resolve);
  });
  if (spawnError) {
    await restoreSafeModeMods();
    onLog?.('error', `Failed to launch Java: ${spawnError?.message || spawnError}`);
    return { ok: false, error: 'JavaLaunchFailed', message: spawnError?.message || String(spawnError) };
  }

  runningChildren.set(child.pid, child);

  const mainWindow = getMainWindow();
  const settings = await loadLauncherState(app.getPath('userData'));
  const rawBehavior = settings?.settings?.launchBehavior;
  const launchBehavior = (rawBehavior === 'keepOpen' || rawBehavior === 'hide' || rawBehavior === 'close')
    ? rawBehavior
    : (settings?.settings?.keepOpen ? 'keepOpen' : 'hide');

  if (launchBehavior === 'close' && !opts?.safeMode) {
    // True 0 MB Mode: Spawn lightweight native background supervisor and quit Electron completely
    const targetPid = child.pid;
    const execPath = process.execPath;
    const isWin = process.platform === 'win32';
    const isDarwin = process.platform === 'darwin';

    try {
      if (isDarwin || process.platform === 'linux') {
        const appBundlePath = isDarwin && execPath.includes('.app')
          ? `${execPath.split('.app')[0]}.app`
          : execPath;
        const launchCmd = isDarwin && execPath.includes('.app')
          ? `open "${appBundlePath}"`
          : `"${execPath}"`;
        const shScript = `while kill -0 ${targetPid} 2>/dev/null; do sleep 1; done; ${launchCmd}`;
        const supervisor = spawn('/bin/sh', ['-c', shScript], {
          detached: true,
          stdio: 'ignore',
        });
        supervisor.unref();
      } else if (isWin) {
        const escapedPath = execPath.replace(/'/g, "''");
        const psScript = `while (Get-Process -Id ${targetPid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 1 }; Start-Process -FilePath '${escapedPath}'`;
        const supervisor = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript], {
          detached: true,
          stdio: 'ignore',
        });
        supervisor.unref();
      }

      setTimeout(() => {
        app.exit(0);
      }, 500);
    } catch {
      try { mainWindow?.hide(); } catch {}
    }
  } else if (launchBehavior === 'hide' && mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.hide();
      mainWindow.webContents.setAudioMuted(true);
      mainWindow.webContents.setBackgroundThrottling(true);
      if (typeof global.gc === 'function') {
        try { global.gc(); } catch { }
      }
      try {
        mainWindow.webContents.session.clearCache();
      } catch { }
    } catch { }
  }

  child.on('error', (err) => {
    restoreSafeModeMods().catch(() => {});
    onLog?.('error', `Java process error: ${err?.message || err}. Make sure Java is installed and accessible.`);
    runningChildren.delete(child.pid);
    onExit?.({ code: -1 });
  });

  let processOutput = '';

  child.stdout.on('data', chunk => {
    const text = String(chunk);
    processOutput = (processOutput + text).slice(-2_000_000);
    onLog?.('stdout', text);
  });
  child.stderr.on('data', chunk => {
    const text = String(chunk);
    processOutput = (processOutput + text).slice(-2_000_000);
    onLog?.('stderr', text);
  });
  child.on('close', async code => {
    runningChildren.delete(child.pid);
    await restoreSafeModeMods();
    if (code !== 0) {
      const [latestLog, crashReport] = await Promise.all([readLatestLaunchLog(gameDir), readLatestCrashReport(gameDir)]);
      const combinedOutput = `${processOutput}\n${latestLog}\n${crashReport}`.trim();
      const diagnosis = diagnoseLaunchFailure(combinedOutput);
      onLog?.('error', `Minecraft exited with code ${code}: ${diagnosis.message}`);
      onExit?.({ code, message: diagnosis.message, reason: diagnosis.reason });
    } else {
      onExit?.({ code });
    }

    if (code !== 0) {
      const conflict = parseFabricModConflict(`${processOutput}\n${await readLatestLaunchLog(gameDir)}\n${await readLatestCrashReport(gameDir)}`);
      if (conflict) {
        onConflict?.(conflict);
      }
    }

    if (!runningChildren.size && mainWindow && mainWindow.isDestroyed?.() === false) {
      const currentSettings = await loadLauncherState(app.getPath('userData'));
      const currentBehavior = currentSettings?.settings?.launchBehavior || (currentSettings?.settings?.keepOpen ? 'keepOpen' : 'hide');
      if (currentBehavior === 'hide') {
        try {
          mainWindow.webContents.setBackgroundThrottling(false);
          mainWindow.webContents.setAudioMuted(false);
          mainWindow.show();
          mainWindow.focus();
        } catch { }
      }
    }
  });

  return { ok: true, pid: child.pid };
}

export function stopMinecraft(pid) {
  const child = runningChildren.get(pid);
  if (!child) return { error: 'NotFound', message: `No running process with pid ${pid}` };
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        detached: true,
        stdio: 'ignore',
      });
      killer.unref();
    } else {
      child.kill('SIGTERM');
    }
    runningChildren.delete(pid);
    return { ok: true };
  } catch (error) {
    return { error: 'KillFailed', message: error?.message || String(error) };
  }
}
