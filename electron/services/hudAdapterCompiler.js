import { app } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { ensureManagedJdk } from './javaDetector.js';
import { isValidJarFile } from './minecraftInstaller.js';

const SOURCE_ROOT = fileURLToPath(new URL('../../fabric', import.meta.url));
const VERSION_PATTERN = /^(?:\d+\.\d+(?:\.\d+)?|\d{2}w\d{2}[a-z])$/i;

function compilerTemplateRoot(family) {
  if (app.isPackaged) return path.join(process.resourcesPath, 'adapter-compiler', family);
  if (family === 'official') return path.join(SOURCE_ROOT, 'blazzy-grid-menu-26.2');
  if (family === 'modern') return path.join(SOURCE_ROOT, 'blazzy-grid-menu');
  return path.join(SOURCE_ROOT, 'blazzy-grid-menu-1.21.4');
}

export function chooseHudCompilerFamily(gameVersion) {
  const version = String(gameVersion || '').trim();
  if (!VERSION_PATTERN.test(version)) return null;
  if (/^\d{2}w\d{2}[a-z]$/i.test(version)) return 'modern';
  const parts = version.split('.').map(Number);
  if (parts[0] >= 26) return 'official';
  if (parts[0] !== 1 || parts[1] < 21) return null;
  return (parts[2] || 0) <= 8 ? 'legacy' : 'modern';
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': `BlazzyClient/${app.getVersion()} local HUD compiler` } });
    if (!response.ok) throw new Error(`metadata request failed (${response.status})`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveFabricVersions(gameVersion, family) {
  const [loaders, apiResponse] = await Promise.all([
    fetchJson('https://meta.fabricmc.net/v2/versions/loader'),
    fetch('https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml'),
  ]);
  if (!apiResponse.ok) throw new Error(`Fabric API metadata request failed (${apiResponse.status}).`);
  const loader = loaders.find(item => item?.stable)?.version || loaders[0]?.version;
  const xml = await apiResponse.text();
  const apiVersions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(match => match[1]);
  const fabricApi = apiVersions.filter(version => version.endsWith(`+${gameVersion}`)).at(-1);
  if (!loader || !fabricApi) throw new Error(`Fabric has not published loader/API metadata for Minecraft ${gameVersion}.`);
  let yarn = null;
  if (family !== 'official') {
    const mappings = await fetchJson(`https://meta.fabricmc.net/v2/versions/yarn/${encodeURIComponent(gameVersion)}`);
    yarn = mappings[0]?.version || null;
    if (!yarn) throw new Error(`Fabric mappings are not available for Minecraft ${gameVersion}.`);
  }
  return { loader, fabricApi, yarn };
}

function runGradle(command, args, options, onLog) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true });
    const timeout = setTimeout(() => child.kill(), 15 * 60 * 1000);
    let tail = '';
    const capture = (kind, chunk) => {
      const text = chunk.toString();
      tail = `${tail}${text}`.slice(-12000);
      for (const line of text.split(/\r?\n/).filter(Boolean)) onLog?.(kind, `[HUD compiler] ${line}`);
    };
    child.stdout?.on('data', chunk => capture('info', chunk));
    child.stderr?.on('data', chunk => capture('warn', chunk));
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`HUD compilation failed with exit code ${code}.${tail ? ` ${tail.split(/\r?\n/).filter(Boolean).at(-1)}` : ''}`));
    });
  });
}

export async function compileHudAdapterLocally(gameVersion, onLog = null) {
  const version = String(gameVersion || '').trim();
  const family = chooseHudCompilerFamily(version);
  if (!family) throw new Error(`Local HUD compilation currently supports Minecraft 1.21+ Fabric versions; ${version} needs a separate legacy source port.`);
  if (process.platform !== 'win32') throw new Error('Local HUD compilation is currently packaged for Windows only.');

  const cacheRoot = path.join(app.getPath('userData'), 'adapter-compiler');
  const outputJar = path.join(cacheRoot, 'jars', `blazzy-grid-menu-${version}.jar`);
  if (isValidJarFile(outputJar)) return outputJar;

  onLog?.('info', `Preparing an exact Blazzy HUD build for Minecraft ${version}...`);
  const metadata = await resolveFabricVersions(version, family);
  const jdkMajor = family === 'official' ? 25 : 21;
  const javaExecutable = await ensureManagedJdk(jdkMajor, onLog);
  const javaHome = path.dirname(path.dirname(javaExecutable));
  const projectDir = path.join(cacheRoot, 'projects', version);
  await fs.promises.rm(projectDir, { recursive: true, force: true });
  await fs.promises.mkdir(path.dirname(projectDir), { recursive: true });
  await fs.promises.cp(compilerTemplateRoot(family), projectDir, {
    recursive: true,
    filter: source => !/(?:^|[\\/])(?:build|\.gradle)(?:[\\/]|$)/.test(source),
  });

  const modJsonPath = path.join(projectDir, 'src', 'main', 'resources', 'fabric.mod.json');
  const modJson = JSON.parse(await fs.promises.readFile(modJsonPath, 'utf8'));
  modJson.name = `Blazzy Client Modules (${version})`;
  modJson.depends.minecraft = version;
  await fs.promises.writeFile(modJsonPath, `${JSON.stringify(modJson, null, 2)}\n`, 'utf8');

  const gradle = process.platform === 'win32' ? path.join(projectDir, 'gradlew.bat') : path.join(projectDir, 'gradlew');
  const args = ['build', '--no-daemon', '--stacktrace', `-Pminecraft_version=${version}`, `-Ploader_version=${metadata.loader}`, `-Pfabric_version=${metadata.fabricApi}`];
  if (metadata.yarn) args.push(`-Pyarn_mappings=${metadata.yarn}`);
  await runGradle(gradle, args, {
    cwd: projectDir,
    env: { ...process.env, JAVA_HOME: javaHome, PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH || ''}` },
  }, onLog);

  const libsDir = path.join(projectDir, 'build', 'libs');
  const candidates = (await fs.promises.readdir(libsDir)).filter(file => file.endsWith('.jar') && !/-(?:sources|dev)\.jar$/.test(file));
  if (candidates.length === 0) throw new Error('HUD compiler completed without producing a JAR.');
  const builtJar = path.join(libsDir, candidates[0]);
  if (!isValidJarFile(builtJar)) throw new Error('HUD compiler produced an invalid JAR.');
  const AdmZip = (await import('adm-zip')).default;
  const builtMetadata = JSON.parse(new AdmZip(builtJar).readAsText('fabric.mod.json'));
  if (builtMetadata?.id !== 'blazzy_grid_menu' || builtMetadata?.depends?.minecraft !== version) {
    throw new Error('Compiled HUD metadata does not match the selected Minecraft version.');
  }
  await fs.promises.mkdir(path.dirname(outputJar), { recursive: true });
  await fs.promises.copyFile(builtJar, outputJar);
  const digest = crypto.createHash('sha256').update(await fs.promises.readFile(outputJar)).digest('hex');
  onLog?.('info', `Blazzy HUD compiled and verified for Minecraft ${version} (${digest.slice(0, 12)}).`);
  return outputJar;
}
