const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blazzy', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveProfile: (profile) => ipcRenderer.invoke('profile:save', profile),
  getVersions: () => ipcRenderer.invoke('minecraft:versions'),
  launch: (options) => ipcRenderer.invoke('minecraft:launch', options),
  stop: () => ipcRenderer.invoke('minecraft:stop'),
  searchMods: (query, version) => ipcRenderer.invoke('mods:search', { query, version }),
  installMod: (mod, version) => ipcRenderer.invoke('mods:install', { mod, version }),
  openModsFolder: () => ipcRenderer.invoke('mods:open-folder'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  saveCosmetic: (cosmetic) => ipcRenderer.invoke('cosmetic:save', cosmetic),
  onProgress: (callback) => ipcRenderer.on('launch:progress', (_event, data) => callback(data)),
  onLog: (callback) => ipcRenderer.on('launch:log', (_event, data) => callback(data)),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close')
});
