const electronStub = `
export const app = {
  getPath(name) {
    if (name === 'home') return '/tmp/blazzy-client-test-home';
    if (name === 'appData' || name === 'userData') return '/tmp/blazzy-client-test-data';
    return '/tmp/blazzy-client-test-data';
  },
  getVersion() { return 'test'; },
  exit() {},
};
export class BrowserWindow {
  static getAllWindows() { return []; }
}
export const Menu = { buildFromTemplate() { return {}; }, setApplicationMenu() {} };
export const screen = { getPrimaryDisplay() { return { workAreaSize: { width: 1920, height: 1080 } }; } };
export const shell = { openExternal: async () => {}, openPath: async () => '' };
export const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };
export const ipcMain = { handle() {}, removeHandler() {} };
export const safeStorage = {
  isEncryptionAvailable() { return false; },
  encryptString(value) { return Buffer.from(value); },
  decryptString(value) { return Buffer.from(value).toString('utf8'); },
};
`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: `data:text/javascript,${encodeURIComponent(electronStub)}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
