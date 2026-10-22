import { app, BrowserWindow, dialog, Menu } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createMainWindow } from './services/windowManager.js';
import { registerAllIpc } from './ipc/registerIpc.js';
import { checkForLauncherUpdate } from './services/updater.js';
import { loadLauncherState } from '../src/lib/launcherState.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = Boolean(process.defaultApp || process.argv.includes('--dev') || process.env.OPENLAUNCHER_DEV === '1');

// Only load dotenv during development to save production cold startup time
if (isDev) {
  import('dotenv').then(dotenv => dotenv.default.config()).catch(() => {});
}

app.setName('Blazzy Client');

function writeStartupError(error) {
  const message = error?.stack || error?.message || String(error);
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'startup.log'), `[${new Date().toISOString()}] ${message}\n`);
  } catch { }
  return message;
}

process.on('uncaughtException', (error) => {
  const message = writeStartupError(error);
  if (app.isReady()) dialog.showErrorBox('Blazzy Client could not start', `${message}\n\nA diagnostic log was saved in the Blazzy Client data folder.`);
});

process.on('unhandledRejection', (error) => {
  writeStartupError(error);
});

// Electron & Chromium engine optimizations (Ultra low RAM, disk cache, background processes)
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128 --expose-gc');
app.commandLine.appendSwitch('renderer-process-limit', '1');
app.commandLine.appendSwitch('disk-cache-size', '16777216');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-speech-api');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-print-preview');
app.commandLine.appendSwitch('disable-features', 'Autofill,CalculateNativeWinOcclusion,InterestFeedContentSuggestions,MediaSessionService,Translate,PreloadMediaEngagementData');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-background-timer-throttling');

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const mainWin = BrowserWindow.getAllWindows()[0];
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });
}

async function init() {
  Menu.setApplicationMenu(null);

  registerAllIpc();

  const mainWindow = await createMainWindow({
    isDev,
    electronDir: __dirname,
  });

  // Auto-check for updates if enabled in settings
  setTimeout(async () => {
    try {
      const state = await loadLauncherState(app.getPath('userData'));
      if (state.settings?.autoUpdate !== false) {
        checkForLauncherUpdate({
          onEvent: (channel, payload) => {
            try { mainWindow?.webContents.send(channel, payload); } catch { }
          },
        }).catch((err) => {
          console.warn('Auto update check error:', err?.message || err);
        });
      }
    } catch { }
  }, 3000);
}

app.whenReady().then(init).catch((error) => {
  const message = writeStartupError(error);
  dialog.showErrorBox('Blazzy Client could not start', `${message}\n\nA diagnostic log was saved in the Blazzy Client data folder.`);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow({ isDev, electronDir: __dirname });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
