import { app, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { getMicrosoftAuthState } from '../../src/lib/microsoftAuth.js';
import { getMainWindow } from './windowManager.js';
import { getMinecraftRoot, getInstancesDir } from './paths.js';

const PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile';

async function getAccessToken(profileKey) {
  const auth = await getMicrosoftAuthState({
    profileKey: String(profileKey || 'default'),
    storageDir: app.getPath('userData'),
    forceRefresh: true,
  });
  const accessToken = auth?.access_token || auth?.accessToken;
  if (!auth?.loggedIn || !accessToken) {
    throw new Error('Sign in with a Microsoft account that owns Minecraft Java Edition.');
  }
  return accessToken;
}

async function minecraftProfileRequest(profileKey, suffix = '', options = {}) {
  const accessToken = await getAccessToken(profileKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${PROFILE_URL}${suffix}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      const details = await response.text().catch(() => '');
      throw new Error(`Minecraft profile request failed (${response.status})${details ? `: ${details.slice(0, 180)}` : ''}`);
    }
    if (response.status === 204) return null;
    return response.json().catch(() => null);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getOfficialCosmetics(profileKey) {
  const profile = await minecraftProfileRequest(profileKey);
  return {
    ok: true,
    name: profile?.name || '',
    id: profile?.id || '',
    skins: Array.isArray(profile?.skins) ? profile.skins : [],
    capes: Array.isArray(profile?.capes) ? profile.capes : [],
  };
}

export async function pickAndUploadOfficialSkin({ profileKey, variant = 'classic' } = {}) {
  const result = await dialog.showOpenDialog(getMainWindow() || undefined, {
    title: 'Choose a Minecraft skin',
    properties: ['openFile'],
    filters: [{ name: 'Minecraft Skin PNG', extensions: ['png'] }],
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  const filePath = result.filePaths[0];
  const bytes = await fs.promises.readFile(filePath);
  if (bytes.length < 24 || bytes.length > 5 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    return { error: 'InvalidSkin', message: 'Choose a valid PNG skin smaller than 5 MB.' };
  }
  const form = new FormData();
  form.append('variant', variant === 'slim' ? 'slim' : 'classic');
  form.append('file', new Blob([bytes], { type: 'image/png' }), path.basename(filePath));
  await minecraftProfileRequest(profileKey, '/skins', { method: 'POST', body: form });
  return getOfficialCosmetics(profileKey);
}

export async function setOfficialCape({ profileKey, capeId = '' } = {}) {
  if (capeId) {
    await minecraftProfileRequest(profileKey, '/capes/active', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capeId: String(capeId) }),
    });
  } else {
    await minecraftProfileRequest(profileKey, '/capes/active', { method: 'DELETE' });
  }
  return getOfficialCosmetics(profileKey);
}

const localCosmeticsPath = () => path.join(app.getPath('userData'), 'blazzy-local-cosmetics.json');

export async function getLocalCosmetics(profileKey = 'default') {
  let store = {};
  try { store = JSON.parse(await fs.promises.readFile(localCosmeticsPath(), 'utf8')); } catch { }
  return { ok: true, local: true, profileKey, ...(store[String(profileKey)] || {}) };
}

export async function pickLocalSkin({ profileKey = 'default', variant = 'classic' } = {}) {
  const result = await dialog.showOpenDialog(getMainWindow() || undefined, {
    title: 'Choose a local Blazzy skin', properties: ['openFile'], filters: [{ name: 'Minecraft Skin PNG', extensions: ['png'] }],
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  const bytes = await fs.promises.readFile(result.filePaths[0]);
  if (bytes.length < 24 || bytes.length > 5 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    return { error: 'InvalidSkin', message: 'Choose a valid PNG skin smaller than 5 MB.' };
  }
  let store = {};
  try { store = JSON.parse(await fs.promises.readFile(localCosmeticsPath(), 'utf8')); } catch { }
  const key = String(profileKey).replace(/[^a-z0-9_-]/gi, '_');
  const skinDir = path.join(app.getPath('userData'), 'local-cosmetics');
  await fs.promises.mkdir(skinDir, { recursive: true });
  const skinPath = path.join(skinDir, `${key}.png`);
  await fs.promises.writeFile(skinPath, bytes);
  store[String(profileKey)] = { skinPath, skinDataUrl: `data:image/png;base64,${bytes.toString('base64')}`, variant: variant === 'slim' ? 'slim' : 'classic', updatedAt: Date.now() };
  await fs.promises.writeFile(localCosmeticsPath(), JSON.stringify(store, null, 2));
  const syncRoots = [getMinecraftRoot()];
  try {
    for (const name of await fs.promises.readdir(getInstancesDir())) syncRoots.push(path.join(getInstancesDir(), name));
  } catch { }
  await Promise.all(syncRoots.map(async root => {
    const targetDir = path.join(root, 'config', 'blazzy-client', 'cosmetics');
    await fs.promises.mkdir(targetDir, { recursive: true });
    await fs.promises.writeFile(path.join(targetDir, `${key}.png`), bytes);
    await fs.promises.writeFile(path.join(targetDir, `${key}.json`), JSON.stringify({ profileKey: String(profileKey), variant, skin: `${key}.png` }, null, 2));
  }));
  return getLocalCosmetics(profileKey);
}
