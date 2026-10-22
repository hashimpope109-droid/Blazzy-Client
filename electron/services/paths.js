import { app } from 'electron';
import path from 'path';

export function getMinecraftRoot() {
  if (process.platform === 'win32') {
    const appDataDir = process.env.APPDATA || app.getPath('appData');
    return path.join(appDataDir, '.minecraft');
  }
  if (process.platform === 'darwin') {
    return path.join(app.getPath('home'), 'Library', 'Application Support', 'minecraft');
  }
  return path.join(app.getPath('home'), '.minecraft');
}

export function getInstancesDir() {
  return path.join(getMinecraftRoot(), 'instances');
}

export function getInstanceDir(instanceId) {
  if (!instanceId) return getMinecraftRoot();
  const safeId = String(instanceId).trim();
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(safeId)) {
    throw new Error('Invalid instance identifier.');
  }
  return path.join(getInstancesDir(), safeId);
}

export function getMinecraftRoots() {
  return [getMinecraftRoot()];
}
