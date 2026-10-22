export const BLAZZY_SUPPORTED_VERSIONS = [
  { id: '1.21.4', purpose: 'PvP' },
  { id: '1.21.11', purpose: 'Modded' },
  { id: '26.1.2', purpose: 'SMP & Survival' },
  { id: '26.3', purpose: 'Latest Modern' },
];

export function baseMinecraftVersion(value) {
  const text = String(value?.mcVer || value?.inheritsFrom || value?.id || value || '');
  return BLAZZY_SUPPORTED_VERSIONS.find(item => text === item.id || text.includes(item.id))?.id || text;
}

export function isBlazzySupportedVersion(value) {
  return BLAZZY_SUPPORTED_VERSIONS.some(item => item.id === baseMinecraftVersion(value));
}

export function blazzyVersionLabel(value) {
  const id = baseMinecraftVersion(value);
  const supported = BLAZZY_SUPPORTED_VERSIONS.find(item => item.id === id);
  return supported ? `${id} — ${supported.purpose}` : String(value?.label || value?.id || value || id);
}
