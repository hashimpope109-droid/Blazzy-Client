import { resolveMinecraftVersion } from '../lib/minecraftLauncher.js';

export function normalizeLoader(value) {
  const lower = String(value || '').toLowerCase();
  if (lower.includes('neoforge')) return 'neoforge';
  if (lower.includes('fabric')) return 'fabric';
  if (lower.includes('quilt')) return 'quilt';
  if (lower.includes('forge')) return 'forge';
  return 'vanilla';
}

export function resolveInstalledVersionForInstance(instance, installedVersions = []) {
  if (!instance || !Array.isArray(installedVersions)) return null;
  const requested = String(instance.version || '').trim();
  const requestedLoader = normalizeLoader(instance.loader || requested);
  const exact = installedVersions.find(version => String(version.id) === requested);
  if (exact && normalizeLoader(exact.type || exact.id) === requestedLoader) return exact;

  const requestedGameVersion = resolveMinecraftVersion(requested);
  const compatible = installedVersions.filter(version => {
    const gameVersion = resolveMinecraftVersion(version.inheritsFrom || version.mcVer || version.id);
    return gameVersion === requestedGameVersion;
  });
  return compatible.find(version => normalizeLoader(version.type || version.id) === requestedLoader)
    || (requestedLoader === 'vanilla'
      ? compatible.find(version => normalizeLoader(version.type || version.id) === 'vanilla')
      : null)
    || null;
}
