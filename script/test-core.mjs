import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';

import { loadLauncherState, normalizeProfile, saveLauncherState } from '../src/lib/launcherState.js';
import { cleanMinecraftVersion } from '../src/lib/modrinth.js';
import { createOfflineSession, formatFileSize, findModInList } from '../src/utils/formatters.js';
import {
  calculateSafeRamGb,
  applyPerformanceOptions,
  ensureBlazzyGridMenu,
  ensureBlazzyMenuPreset,
  selectRemoteAdapterEntry,
  ensureBlazzyMenuTheme,
  compareVersionTuples,
  extractNativeLibraries,
  makeOfflineUuid,
  mergeVersionMetadata,
  resolveMinecraftVersion,
  selectLoaderClasspath,
  splitCommandLine,
  stageModsForSafeMode,
  summarizeLaunchFailure,
  versionToTuple,
} from '../electron/services/minecraftRunner.js';
import {
  buildMavenArtifactInfo,
  ensureJarFile,
  ensureVanillaVersionInstalled,
  installMinecraft,
  isValidJarFile,
  readInstalledVersions,
  runCommand,
  rulesPassForCurrentSystem,
} from '../electron/services/minecraftInstaller.js';
import { extractJarMetadata, normalizeModFileName, readInstalledMods, toggleMod } from '../electron/services/contentManager.js';
import { getInstanceDir } from '../electron/services/paths.js';
import { normalizeLoader, resolveInstalledVersionForInstance } from '../src/utils/versionSelection.js';
import { expandJavaExecutableCandidate, requiredJavaForMinecraft } from '../electron/services/javaDetector.js';
import { chooseHudCompilerFamily } from '../electron/services/hudAdapterCompiler.js';

let checks = 0;
function check(name, callback) {
  callback();
  checks += 1;
  console.log(`✓ ${name}`);
}

async function checkAsync(name, callback) {
  await callback();
  checks += 1;
  console.log(`✓ ${name}`);
}

check('Minecraft and loader version parsing', () => {
  assert.equal(resolveMinecraftVersion('fabric-loader-0.16.10-1.21.4'), '1.21.4');
  assert.equal(cleanMinecraftVersion('Forge 54.0.1 - 1.21.4'), '1.21.4');
  assert.equal(resolveMinecraftVersion({ inheritsFrom: '1.21.11' }), '1.21.11');
});

check('Instances select only a compatible installed loader version', () => {
  const installed = [
    { id: '1.21.4', type: 'vanilla', mcVer: '1.21.4' },
    { id: 'fabric-loader-0.16.10-1.21.4', type: 'fabric', inheritsFrom: '1.21.4' },
    { id: 'neoforge-21.4.1', type: 'neoforge', mcVer: '1.21.4' },
  ];
  assert.equal(resolveInstalledVersionForInstance({ version: '1.21.4', loader: 'fabric' }, installed)?.id, 'fabric-loader-0.16.10-1.21.4');
  assert.equal(resolveInstalledVersionForInstance({ version: 'missing', loader: 'fabric' }, installed), null);
  assert.equal(normalizeLoader('NeoForge 21.4.1'), 'neoforge');
});

check('Java-compatible offline UUID generation', () => {
  assert.equal(makeOfflineUuid('Notch'), 'b50ad385-829d-3141-a216-7e7d7539ba7f');
  assert.deepEqual(createOfflineSession('Player'), { name: 'Player', username: 'Player', userType: 'legacy' });
});

check('Low-memory launch settings are clamped and failures are explained', () => {
  assert.equal(calculateSafeRamGb(8, 4 * 1024 ** 3), 2);
  assert.equal(calculateSafeRamGb(4, 16 * 1024 ** 3), 4);
  assert.match(summarizeLaunchFailure('Error occurred during initialization of VM\nCould not reserve enough space'), /Reduce the profile RAM/);
  assert.match(summarizeLaunchFailure('Incompatible mods found!'), /Mods tab/);
  assert.equal(
    summarizeLaunchFailure('java.lang.RuntimeException: launch failed\nCaused by: java.nio.file.AccessDeniedException: options.txt\n\t... 1 more'),
    'java.nio.file.AccessDeniedException: options.txt',
  );
});

await checkAsync('FPS Boost applies fast video settings without deleting custom options', async () => {
  const gameDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'blazzy-fps-options-'));
  try {
    const optionsPath = path.join(gameDir, 'options.txt');
    await fsp.writeFile(optionsPath, 'renderDistance:24\nenableVsync:true\nfov:0.5\n', 'utf8');
    await applyPerformanceOptions(gameDir);
    await fsp.mkdir(path.join(gameDir, 'mods'), { recursive: true });
    await fsp.writeFile(path.join(gameDir, 'mods', 'blazzy-menu-theme-1.0.0.jar'), 'legacy', 'utf8');
    assert.equal(await ensureBlazzyMenuTheme(gameDir), true);
    assert.equal(fs.existsSync(path.join(gameDir, 'mods', 'blazzy-menu-theme-1.0.0.jar')), false);
    const firstPreset = await ensureBlazzyMenuPreset(gameDir);
    assert.equal(firstPreset.mods_button_style, 'icon');
    assert.equal(firstPreset.game_menu_button_style, 'icon');
    assert.equal(firstPreset.show_libraries, false);
    await fsp.writeFile(path.join(gameDir, 'config', 'modmenu.json'), JSON.stringify({
      ...firstPreset,
      sorting: 'descending',
      custom_blazzy_setting: true,
    }), 'utf8');
    const preservedPreset = await ensureBlazzyMenuPreset(gameDir);
    assert.equal(preservedPreset.sorting, 'descending');
    assert.equal(preservedPreset.custom_blazzy_setting, true);
    const options = await fsp.readFile(optionsPath, 'utf8');
    assert.match(options, /^renderDistance:10$/m);
    assert.match(options, /^enableVsync:false$/m);
    assert.match(options, /^simulationDistance:6$/m);
    assert.match(options, /^maxFps:260$/m);
    assert.match(options, /^key_key\.modmenu\.open_menu:key\.keyboard\.unknown$/m);
    assert.match(options, /^key_key\.blazzy\.open_menu:key\.keyboard\.right\.shift$/m);
    assert.match(options, /^key_key\.fast-client-hud\.click_gui:key\.keyboard\.right\.shift$/m);
    assert.match(options, /^fov:0\.5$/m);
    const themeJar = path.join(gameDir, 'mods', 'blazzy-menu-theme-3.0.0.jar');
    assert.equal(isValidJarFile(themeJar), true);
    const themeZip = new AdmZip(themeJar);
    assert.ok(themeZip.getEntry('assets/minecraft/textures/gui/title/minecraft.png'));
    assert.ok(themeZip.getEntry('assets/minecraft/textures/gui/title/mojangstudios.png'));
    assert.ok(themeZip.getEntry('assets/minecraft/textures/gui/title/background/panorama_0.png'));
    assert.ok(themeZip.getEntry('assets/minecraft/textures/gui/sprites/widget/button.png'));
    assert.equal(await ensureBlazzyGridMenu(gameDir, '1.21.11'), true);
    const gridMenuJar = path.join(gameDir, 'mods', 'blazzy-grid-menu-1.21.11.jar');
    assert.equal(isValidJarFile(gridMenuJar), true);
    const gridMenuZip = new AdmZip(gridMenuJar);
    const gridMenuMetadata = JSON.parse(gridMenuZip.readAsText('fabric.mod.json'));
    assert.equal(gridMenuMetadata.id, 'blazzy_grid_menu');
    assert.ok(gridMenuZip.getEntry('gg/blazzy/menu/BlazzyDashboardScreen.class'));
    assert.equal(await ensureBlazzyGridMenu(gameDir, '1.21.4'), true);
    assert.equal(fs.existsSync(gridMenuJar), false);
    const legacyGridMenuJar = path.join(gameDir, 'mods', 'blazzy-grid-menu-1.21.4.jar');
    assert.equal(isValidJarFile(legacyGridMenuJar), true);
    const legacyMetadata = JSON.parse(new AdmZip(legacyGridMenuJar).readAsText('fabric.mod.json'));
    assert.equal(legacyMetadata.depends.minecraft, '>=1.21 <=1.21.5');
    assert.equal(await ensureBlazzyGridMenu(gameDir, '1.21.8'), true);
    assert.equal(fs.existsSync(legacyGridMenuJar), false);
    const middleGridMenuJar = path.join(gameDir, 'mods', 'blazzy-grid-menu-1.21.8.jar');
    const middleMetadata = JSON.parse(new AdmZip(middleGridMenuJar).readAsText('fabric.mod.json'));
    assert.equal(middleMetadata.depends.minecraft, '>=1.21.6 <=1.21.8');
    assert.equal(await ensureBlazzyGridMenu(gameDir, '1.21.10'), true);
    assert.equal(fs.existsSync(middleGridMenuJar), false);
    const recentGridMenuJar = path.join(gameDir, 'mods', 'blazzy-grid-menu-1.21.10.jar');
    const recentMetadata = JSON.parse(new AdmZip(recentGridMenuJar).readAsText('fabric.mod.json'));
    assert.equal(recentMetadata.depends.minecraft, '>=1.21.9 <=1.21.10');
    assert.equal(await ensureBlazzyGridMenu(gameDir, '26.2'), true);
    const modernGridMenuJar = path.join(gameDir, 'mods', 'blazzy-client-hud-26.2.jar');
    assert.equal(isValidJarFile(modernGridMenuJar), true);
    const modernMetadata = JSON.parse(new AdmZip(modernGridMenuJar).readAsText('fabric.mod.json'));
    assert.equal(modernMetadata.name, 'Blazzy Client HUD');
    assert.equal(modernMetadata.depends.minecraft, '~26.2');
    assert.equal(modernMetadata.depends.java, '>=25');
  } finally {
    await fsp.rm(gameDir, { recursive: true, force: true });
  }
});

check('Java paths and modern Minecraft requirements are normalized', () => {
  assert.equal(expandJavaExecutableCandidate('"/opt/java/bin/java"')[0], '/opt/java/bin/java');
  assert.equal(requiredJavaForMinecraft('1.21.4'), 21);
  assert.equal(requiredJavaForMinecraft('26.2'), 25);
  assert.equal(requiredJavaForMinecraft('1.20.1'), 17);
});

check('Remote HUD adapter catalog rejects unsafe or mismatched entries', () => {
  assert.deepEqual(selectRemoteAdapterEntry({ versions: { '1.22': {
    file: 'blazzy-grid-menu-1.22.jar',
    sha256: 'a'.repeat(64),
  } } }, '1.22'), { file: 'blazzy-grid-menu-1.22.jar', sha256: 'a'.repeat(64) });
  assert.equal(selectRemoteAdapterEntry({ versions: { '1.22': {
    file: '../evil.jar',
    sha256: 'a'.repeat(64),
  } } }, '1.22'), null);
  assert.equal(selectRemoteAdapterEntry({ versions: { '1.22': {
    file: 'blazzy-grid-menu-1.22.jar',
    sha256: 'bad',
  } } }, '1.22'), null);
});

check('Local HUD compiler selects only supported source families', () => {
  assert.equal(chooseHudCompilerFamily('1.21.4'), 'legacy');
  assert.equal(chooseHudCompilerFamily('1.21.10'), 'modern');
  assert.equal(chooseHudCompilerFamily('26.4'), 'official');
  assert.equal(chooseHudCompilerFamily('26w12a'), 'modern');
  assert.equal(chooseHudCompilerFamily('1.13.2'), null);
  assert.equal(chooseHudCompilerFamily('../1.21.4'), null);
});

await checkAsync('Missing Java spawn reports an actionable installer error', async () => {
  await assert.rejects(
    runCommand('/definitely-missing-blazzy-java', ['-version']),
    /Java executable was not found/,
  );
});

check('Quoted JVM and legacy game arguments', () => {
  assert.deepEqual(splitCommandLine('-Xmx4G -Dname="Blazzy Client" --path "C:\\Game Files\\MC"'), [
    '-Xmx4G', '-Dname=Blazzy Client', '--path', 'C:\\Game Files\\MC',
  ]);
  assert.deepEqual(splitCommandLine("--username 'Apple Skin'"), ['--username', 'Apple Skin']);
});

check('Child metadata overrides inherited libraries', () => {
  const merged = mergeVersionMetadata(
    { libraries: [{ name: 'base:one:1' }], arguments: { game: ['--base'] }, mainClass: 'Base' },
    { libraries: [{ name: 'child:two:2' }], arguments: { game: ['--child'] }, mainClass: 'Child' },
  );
  assert.deepEqual(merged.libraries.map(item => item.name), ['base:one:1', 'child:two:2']);
  assert.deepEqual(merged.arguments.game, ['--base', '--child']);
  assert.equal(merged.mainClass, 'Child');
  assert.equal(compareVersionTuples(versionToTuple('1.10.0'), versionToTuple('1.9.9')), 1);
});

check('Fabric classpath contains only the selected loader version', () => {
  const baseDir = path.join(os.tmpdir(), 'blazzy-loader-classpath');
  const oldLoader = path.join(baseDir, 'libraries', 'net', 'fabricmc', 'fabric-loader', '0.19.3', 'fabric-loader-0.19.3.jar');
  const selectedLoader = path.join(baseDir, 'libraries', 'net', 'fabricmc', 'fabric-loader', '0.20.1', 'fabric-loader-0.20.1.jar');
  const gameLibrary = path.join(baseDir, 'libraries', 'com', 'example', 'game.jar');
  const classpath = selectLoaderClasspath(
    [oldLoader, gameLibrary, selectedLoader],
    [{ name: 'net.fabricmc:fabric-loader:0.20.1' }],
    baseDir,
    'net.fabricmc.loader.impl.launch.knot.KnotClient',
  );
  assert.equal(classpath[0], selectedLoader);
  assert.equal(classpath.includes(oldLoader), false);
  assert.equal(classpath.filter(entry => entry.includes(`${path.sep}fabric-loader${path.sep}`)).length, 1);
});

check('Maven coordinates and platform rules', () => {
  assert.equal(buildMavenArtifactInfo('org.lwjgl:lwjgl:3.3.3:natives-windows').relativePath,
    'org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar');
  assert.equal(rulesPassForCurrentSystem([{ action: 'allow', os: { name: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux' } }]), true);
  assert.equal(rulesPassForCurrentSystem([{ action: 'allow', features: { demo_user: true } }], { demo_user: false }), false);
});

check('Path traversal is rejected for instances and imported names', () => {
  assert.throws(() => getInstanceDir('../outside'), /Invalid instance/);
  assert.equal(normalizeModFileName('../../sodium.jar'), 'sodium.jar');
});

check('Formatting and installed-mod matching helpers', () => {
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(findModInList([{ fileName: 'sodium-fabric-0.6.0.jar', modId: 'sodium' }], 'sodium')?.modId, 'sodium');
});

await checkAsync('State persistence, normalization, and backup recovery', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'blazzy-state-'));
  try {
    const profile = normalizeProfile({ id: 'p1', name: '   ', ram: 999 }, 0);
    assert.equal(profile.name, 'Default');
    assert.equal(profile.ram, 128);
    await saveLauncherState(dir, { profiles: [profile], activeProfileId: 'p1', settings: { launchBehavior: 'close' } });
    await saveLauncherState(dir, { profiles: [{ ...profile, name: 'Recovered' }], activeProfileId: 'p1', settings: { launchBehavior: 'hide' } });
    await fsp.writeFile(path.join(dir, 'launcher-state.json'), '{broken', 'utf8');
    const recovered = await loadLauncherState(dir);
    assert.equal(recovered.profiles[0].name, 'Default');
    assert.equal(recovered.settings.launchBehavior, 'close');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

await checkAsync('JAR validation, metadata reading, and safe native extraction', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'blazzy-native-'));
  try {
    const jarPath = path.join(dir, 'example.jar');
    const truncatedJarPath = path.join(dir, 'truncated.jar');
    const zip = new AdmZip();
    zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'apple-skin', name: 'Apple Skin', version: '1.0.0' })));
    zip.addFile('native/test-native.dll', Buffer.from('native'));
    zip.addFile('META-INF/signature.SF', Buffer.from('ignored'));
    zip.writeZip(jarPath);
    await fsp.writeFile(truncatedJarPath, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]));
    assert.equal(isValidJarFile(jarPath), true);
    assert.equal(isValidJarFile(truncatedJarPath), false);
    const originalFetch = globalThis.fetch;
    const validJarBytes = await fsp.readFile(jarPath);
    globalThis.fetch = async () => new Response(validJarBytes, { status: 200 });
    try {
      await ensureJarFile('https://test.invalid/icu4j.jar', truncatedJarPath, {
        expectedSize: validJarBytes.length,
        expectedSha1: createHash('sha1').update(validJarBytes).digest('hex'),
      });
      assert.equal(isValidJarFile(truncatedJarPath), true);
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(extractJarMetadata(jarPath)?.displayName, 'Apple Skin');
    const nativeDir = path.join(dir, 'natives');
    await extractNativeLibraries([{ path: jarPath, exclude: ['fabric.mod.json'] }], nativeDir);
    assert.equal(fs.existsSync(path.join(nativeDir, 'native', 'test-native.dll')), true);
    assert.equal(fs.existsSync(path.join(nativeDir, 'META-INF', 'signature.SF')), false);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

await checkAsync('Installed versions come from complete launchable folders only', async () => {
  const minecraftRoot = '/tmp/blazzy-client-test-home/.minecraft';
  const versionsDir = path.join(minecraftRoot, 'versions');
  await fsp.rm(minecraftRoot, { recursive: true, force: true });
  try {
    const baseDir = path.join(versionsDir, '1.21.4');
    const fabricId = 'fabric-loader-0.16.10-1.21.4';
    const fabricDir = path.join(versionsDir, fabricId);
    const staleDir = path.join(versionsDir, 'stale-version');
    await Promise.all([baseDir, fabricDir, staleDir].map(dir => fsp.mkdir(dir, { recursive: true })));

    const clientJar = new AdmZip();
    clientJar.addFile('net/minecraft/client/Main.class', Buffer.from('client'));
    clientJar.writeZip(path.join(baseDir, '1.21.4.jar'));
    await fsp.writeFile(path.join(baseDir, '1.21.4.json'), JSON.stringify({ id: '1.21.4', type: 'vanilla', mainClass: 'net.minecraft.client.Main' }));
    await fsp.writeFile(path.join(fabricDir, `${fabricId}.json`), JSON.stringify({ id: fabricId, type: 'fabric', inheritsFrom: '1.21.4', mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient' }));
    await fsp.writeFile(path.join(staleDir, 'stale-version.json'), JSON.stringify({ id: 'stale-version', type: 'vanilla' }));

    const versions = await readInstalledVersions();
    assert.equal(versions.some(version => version.id === '1.21.4'), true);
    assert.equal(versions.some(version => version.id === fabricId), true);
    assert.equal(versions.some(version => version.id === 'stale-version'), false);
  } finally {
    await fsp.rm(minecraftRoot, { recursive: true, force: true });
  }
});

await checkAsync('Fabric installation uses official profile data without spawning a Java installer', async () => {
  const minecraftRoot = '/tmp/blazzy-client-test-home/.minecraft';
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  const clientJar = new AdmZip();
  clientJar.addFile('net/minecraft/client/Main.class', Buffer.from('client'));
  const clientBytes = clientJar.toBuffer();
  globalThis.fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes('version_manifest_v2.json')) {
      return new Response(JSON.stringify({ versions: [{ id: '1.21.4', url: 'https://test.invalid/version.json' }] }), { status: 200 });
    }
    if (url.endsWith('/version.json')) {
      return new Response(JSON.stringify({
        id: '1.21.4',
        mainClass: 'net.minecraft.client.main.Main',
        downloads: { client: { url: 'https://test.invalid/client.jar' } },
        libraries: [],
      }), { status: 200 });
    }
    if (url.endsWith('/client.jar')) return new Response(clientBytes, { status: 200 });
    if (url.includes('/versions/loader/1.21.4/0.16.10/profile/json')) {
      return new Response(JSON.stringify({
        id: 'fabric-loader-0.16.10-1.21.4',
        inheritsFrom: '1.21.4',
        mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
        libraries: [{ name: 'net.fabricmc:fabric-loader:0.16.10', url: 'https://maven.fabricmc.net/' }],
      }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  await fsp.rm(minecraftRoot, { recursive: true, force: true });
  try {
    const result = await installMinecraft({ type: 'fabric', gameVersion: '1.21.4', loaderVersion: '0.16.10' });
    assert.equal(result.ok, true);
    assert.equal(result.id, 'fabric-loader-0.16.10-1.21.4');
    assert.equal(fs.existsSync(path.join(minecraftRoot, 'versions', result.id, `${result.id}.json`)), true);
    assert.equal(requestedUrls.some(url => url.includes('fabric-installer')), false);
  } finally {
    globalThis.fetch = originalFetch;
    await fsp.rm(minecraftRoot, { recursive: true, force: true });
  }
});

await checkAsync('Fresh Minecraft downloads fall back, retry partial files, and verify checksums', async () => {
  const minecraftRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'blazzy-fresh-install-'));
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  const clientJar = new AdmZip();
  clientJar.addFile('net/minecraft/client/Main.class', Buffer.from('verified-client'));
  const clientBytes = clientJar.toBuffer();
  const clientSha1 = createHash('sha1').update(clientBytes).digest('hex');
  let clientAttempts = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.startsWith('https://piston-meta.mojang.com/')) return new Response('temporary error', { status: 503 });
    if (url.startsWith('https://launchermeta.mojang.com/')) {
      return new Response(JSON.stringify({ versions: [{ id: '1.21.4', url: 'https://test.invalid/fresh-version.json' }] }), { status: 200 });
    }
    if (url.endsWith('/fresh-version.json')) {
      return new Response(JSON.stringify({
        id: '1.21.4',
        mainClass: 'net.minecraft.client.main.Main',
        downloads: { client: { url: 'https://piston-data.mojang.com/v1/objects/test/client.jar', size: clientBytes.length, sha1: clientSha1 } },
        libraries: [],
      }), { status: 200 });
    }
    if (url.endsWith('/client.jar')) {
      clientAttempts += 1;
      return new Response(clientAttempts === 1 ? clientBytes.subarray(0, 32) : clientBytes, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  try {
    const result = await ensureVanillaVersionInstalled(minecraftRoot, '1.21.4', 'fresh-install-test');
    assert.equal(isValidJarFile(result.jarPath), true);
    assert.equal(clientAttempts, 2);
    assert.equal(requestedUrls.some(url => url.startsWith('https://launchermeta.mojang.com/')), true);
    assert.equal((await fsp.readdir(path.dirname(result.jarPath))).some(name => name.includes('.part-')), false);
  } finally {
    globalThis.fetch = originalFetch;
    await fsp.rm(minecraftRoot, { recursive: true, force: true });
  }
});

await checkAsync('Instance mod folders load and toggle common disabled files', async () => {
  const instanceId = 'test-instance';
  const modsDir = '/tmp/blazzy-client-test-home/.minecraft/instances/test-instance/mods';
  await fsp.rm(path.dirname(modsDir), { recursive: true, force: true });
  try {
    await fsp.mkdir(modsDir, { recursive: true });
    const disabledPath = path.join(modsDir, 'apple-skin.jar.disabled');
    const jar = new AdmZip();
    jar.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'appleskin', name: 'AppleSkin', version: '3.0.6' })));
    jar.writeZip(disabledPath);
    const before = await readInstalledMods(instanceId);
    assert.equal(before[0]?.name, 'AppleSkin');
    assert.equal(before[0]?.enabled, false);
    assert.equal((await toggleMod(before[0].id, true, instanceId)).ok, true);
    assert.equal(fs.existsSync(path.join(modsDir, 'apple-skin.jar')), true);
  } finally {
    await fsp.rm(path.dirname(modsDir), { recursive: true, force: true });
  }
});

await checkAsync('Safe mode temporarily stages enabled mods and restores them', async () => {
  const gameDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'blazzy-safe-mode-'));
  try {
    const modsDir = path.join(gameDir, 'mods');
    await fsp.mkdir(modsDir, { recursive: true });
    await fsp.writeFile(path.join(modsDir, 'broken-mod.jar'), 'test');
    await fsp.writeFile(path.join(modsDir, 'disabled.olpkg'), 'test');
    const restore = await stageModsForSafeMode(gameDir);
    assert.equal(fs.existsSync(path.join(modsDir, 'broken-mod.jar')), false);
    assert.equal(fs.existsSync(path.join(modsDir, 'disabled.olpkg')), true);
    await restore();
    assert.equal(fs.existsSync(path.join(modsDir, 'broken-mod.jar')), true);
  } finally {
    await fsp.rm(gameDir, { recursive: true, force: true });
  }
});

console.log(`\n${checks} core feature checks passed.`);
