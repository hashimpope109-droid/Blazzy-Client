import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import AdmZip from 'adm-zip';

const javaVersionCache = new Map();

export function requiredJavaForMinecraft(version) {
  const value = String(version || '').trim();
  if (/^26\.(?:[2-9]|\d{2,})(?:\.|$)/.test(value)) return 25;
  if (/^26\./.test(value)) return 21;
  const match = value.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return 21;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3] || 0);
  if (major > 1) return 21;
  if (minor >= 21 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 18) return 17;
  if (minor === 17) return 16;
  return 8;
}

export function parseJavaMajorVersion(output) {
  const text = `${output || ''}`;
  const match = text.match(/version\s+"(?:(\d+)\.(\d+)\.|(\d+))(?:[^"]*)"/i);
  if (!match) return null;
  if (match[3]) return Number(match[3]);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major === 1 && Number.isFinite(minor)) return minor;
  return Number.isFinite(major) ? major : null;
}

export function resolveJavaCommand(javaPath) {
  if (javaPath && String(javaPath).trim()) return String(javaPath).trim();
  if (process.env.JAVA_HOME) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    return path.join(process.env.JAVA_HOME, 'bin', `java${ext}`);
  }
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

export function detectJavaMajor(javaCmd) {
  if (!javaCmd) return null;
  const normalized = String(javaCmd).trim();
  if (javaVersionCache.has(normalized)) {
    return javaVersionCache.get(normalized);
  }
  let result;
  try {
    result = spawnSync(normalized, ['-version'], { encoding: 'utf8', timeout: 4000 });
  } catch {
    javaVersionCache.set(normalized, null);
    return null;
  }
  if (result.error) {
    javaVersionCache.set(normalized, null);
    return null;
  }
  const version = parseJavaMajorVersion(`${result.stderr || ''}\n${result.stdout || ''}`);
  javaVersionCache.set(normalized, version);
  return version;
}

export function expandJavaExecutableCandidate(candidate) {
  if (!candidate) return [];
  const value = String(candidate).trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  if (!value) return [];
  const normalized = value.replace(/\/+$/g, '');
  const candidates = [normalized];
  const baseName = path.basename(normalized).toLowerCase();
  if (!baseName.endsWith('java') && !baseName.endsWith('java.exe')) {
    candidates.push(path.join(normalized, `java${process.platform === 'win32' ? '.exe' : ''}`));
    candidates.push(path.join(normalized, 'bin', `java${process.platform === 'win32' ? '.exe' : ''}`));
  }
  return candidates;
}

export function collectCommonJavaCandidates() {
  const candidates = [];
  const add = (value) => {
    if (!value) return;
    const normalized = String(value).trim();
    if (normalized) candidates.push(normalized);
  };
  const pathCandidates = process.platform === 'win32' ? ['java.exe', 'java'] : ['java'];
  for (const executable of pathCandidates) {
    const lookup = spawnSync(process.platform === 'win32' ? 'where' : 'which', [executable], { encoding: 'utf8' });
    if (!lookup.error && lookup.status === 0) {
      for (const line of String(lookup.stdout || '').split(/\r?\n/)) add(line);
    }
  }
  if (process.platform === 'darwin') {
    // 1. Query macOS /usr/libexec/java_home -V
    try {
      const jhLookup = spawnSync('/usr/libexec/java_home', ['-V'], { encoding: 'utf8' });
      const text = `${jhLookup.stderr || ''}\n${jhLookup.stdout || ''}`;
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/(\/[^\s]+(?:\/Contents\/Home)?)/);
        if (match && match[1]) {
          const homePath = match[1].trim();
          add(path.join(homePath, 'bin', 'java'));
        }
      }
    } catch { }

    // 2. Standard macOS JavaVirtualMachines and Homebrew directories
    const macJvmRoots = [
      '/Library/Java/JavaVirtualMachines',
      path.join(app.getPath('home'), 'Library', 'Java', 'JavaVirtualMachines'),
      '/opt/homebrew/opt',
      '/usr/local/opt',
    ];
    for (const root of macJvmRoots) {
      try {
        if (!fs.existsSync(root)) continue;
        const entries = fs.readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const entryPath = path.join(root, entry.name);
          const standardJava = path.join(entryPath, 'Contents', 'Home', 'bin', 'java');
          if (fs.existsSync(standardJava)) add(standardJava);
          const directJava = path.join(entryPath, 'bin', 'java');
          if (fs.existsSync(directJava)) add(directJava);
          const brewJvmJava = path.join(entryPath, 'libexec', 'openjdk.jdk', 'Contents', 'Home', 'bin', 'java');
          if (fs.existsSync(brewJvmJava)) add(brewJvmJava);
        }
      } catch { }
    }

    // 3. SDKMAN and ASDF on macOS
    const home = app.getPath('home');
    const sdkmanPath = path.join(home, '.sdkman', 'candidates', 'java');
    const asdfPath = path.join(home, '.asdf', 'installs', 'java');
    for (const managerDir of [sdkmanPath, asdfPath]) {
      try {
        if (fs.existsSync(managerDir)) {
          const entries = fs.readdirSync(managerDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              add(path.join(managerDir, entry.name, 'bin', 'java'));
              add(path.join(managerDir, entry.name, 'Contents', 'Home', 'bin', 'java'));
            }
          }
        }
      } catch { }
    }
  }
  if (process.platform === 'win32') {
    const roots = [
      process.env.JAVA_HOME,
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Microsoft',
      'C:\\Program Files\\Zulu',
      'C:\\Program Files\\Amazon Corretto',
      'C:\\Program Files\\BellSoft',
      'C:\\Program Files\\OpenLogic',
      'C:\\Program Files\\AdoptOpenJDK',
      'C:\\Program Files (x86)\\Eclipse Adoptium',
      'C:\\Program Files (x86)\\Java',
    ].filter(Boolean);
    for (const root of roots) {
      try {
        const entries = fs.readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const lower = entry.name.toLowerCase();
          if (!/(jdk|jre|java|temurin|adoptium|corretto|zulu|bellsoft|openlogic|microsoft)/.test(lower)) continue;
          add(path.join(root, entry.name, 'bin', 'java.exe'));
        }
      } catch { }
    }
  }
  return Array.from(new Set(candidates.flatMap(expandJavaExecutableCandidate)));
}

export function findJavaCommand(requiredMajor, preferredPath = '') {
  const preferredCandidates = expandJavaExecutableCandidate(preferredPath);
  const fallbackCandidates = collectCommonJavaCandidates();
  const allCandidates = Array.from(new Set([...preferredCandidates, ...fallbackCandidates]));
  let bestCandidate = null;
  let bestMajor = null;
  for (const candidate of allCandidates) {
    const major = detectJavaMajor(candidate);
    if (!major) continue;
    if (!bestCandidate || major > bestMajor) {
      bestCandidate = candidate;
      bestMajor = major;
    }
    if (!requiredMajor || major >= requiredMajor) {
      return { javaCmd: candidate, javaMajor: major };
    }
  }
  return { javaCmd: bestCandidate, javaMajor: bestMajor };
}

async function ensureManagedJavaImage(requiredMajor, imageType, onLog = null) {
  const targetMajor = Number(requiredMajor) || 21;
  if (process.platform !== 'win32') {
    throw new Error(`Java ${targetMajor} was not found. Install it or configure its path in Settings.`);
  }

  const normalizedImageType = imageType === 'jdk' ? 'jdk' : 'jre';
  const runtimeRoot = path.join(app.getPath('userData'), 'runtimes', `temurin-${normalizedImageType}-${targetMajor}`);
  const existing = findJavaInDirectory(runtimeRoot);
  if (existing && detectJavaMajor(existing) >= targetMajor) return existing;

  const architecture = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const metadataUrl = `https://api.adoptium.net/v3/assets/latest/${targetMajor}/hotspot?architecture=${architecture}&heap_size=normal&image_type=${normalizedImageType}&jvm_impl=hotspot&os=windows&vendor=eclipse`;
  onLog?.('info', `☕ Java ${targetMajor} ${normalizedImageType.toUpperCase()} is required. Downloading a verified package...`);

  const metadataResponse = await fetch(metadataUrl, {
    headers: { 'User-Agent': `BlazzyClient/${app.getVersion()} (Java runtime setup)` },
  });
  if (!metadataResponse.ok) throw new Error(`Java metadata request failed (${metadataResponse.status}).`);
  const metadata = await metadataResponse.json();
  const runtimePackage = metadata?.[0]?.binary?.package;
  if (!runtimePackage?.link || !runtimePackage?.checksum) {
    throw new Error(`No compatible Java ${targetMajor} runtime is available for this PC.`);
  }

  const archiveResponse = await fetch(runtimePackage.link, {
    headers: { 'User-Agent': `BlazzyClient/${app.getVersion()} (Java runtime setup)` },
  });
  if (!archiveResponse.ok) throw new Error(`Java runtime download failed (${archiveResponse.status}).`);
  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  const actualChecksum = crypto.createHash('sha256').update(archive).digest('hex');
  if (actualChecksum.toLowerCase() !== String(runtimePackage.checksum).toLowerCase()) {
    throw new Error('Java runtime security check failed (SHA-256 mismatch).');
  }

  const partialRoot = `${runtimeRoot}.partial`;
  await fs.promises.rm(partialRoot, { recursive: true, force: true });
  await fs.promises.mkdir(partialRoot, { recursive: true });
  try {
    new AdmZip(archive).extractAllTo(partialRoot, true);
    const extractedJava = findJavaInDirectory(partialRoot);
    if (!extractedJava || detectJavaMajor(extractedJava) < targetMajor) {
      throw new Error(`Downloaded runtime did not contain a working Java ${targetMajor} executable.`);
    }
    await fs.promises.rm(runtimeRoot, { recursive: true, force: true });
    await fs.promises.rename(partialRoot, runtimeRoot);
  } catch (error) {
    await fs.promises.rm(partialRoot, { recursive: true, force: true });
    throw error;
  }

  const installedJava = findJavaInDirectory(runtimeRoot);
  if (!installedJava) throw new Error('Java runtime installation did not complete.');
  javaVersionCache.delete(installedJava);
  onLog?.('info', `✅ Java ${targetMajor} runtime installed and verified.`);
  return installedJava;
}

export async function ensureManagedJava(requiredMajor, onLog = null) {
  return ensureManagedJavaImage(requiredMajor, 'jre', onLog);
}

export async function ensureManagedJdk(requiredMajor, onLog = null) {
  return ensureManagedJavaImage(requiredMajor, 'jdk', onLog);
}

function findJavaInDirectory(root) {
  if (!root || !fs.existsSync(root)) return null;
  const target = process.platform === 'win32' ? 'java.exe' : 'java';
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(candidate);
      else if (entry.name.toLowerCase() === target) return candidate;
    }
  }
  return null;
}
