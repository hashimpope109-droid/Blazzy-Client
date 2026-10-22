import { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';
import {
  INSTALL_TARGETS,
  getVersionById,
  loadLauncherCatalog,
  resolveMinecraftVersion,
  formatVersionLabel,
} from './lib/minecraftLauncher';
import { loadMinecraftNews } from './lib/minecraftNews';
import {
  searchModrinthProjects,
} from './lib/modrinth';
import { useI18n } from './context/I18nContext';
import logoIcon from '/icon.webp';
import { launcher } from './services/launcherClient';
import { ICONS } from './constants/icons';
import {
  Icon,
  MicrosoftLogo,
  RemoteImage,
  Toast,
} from './components/common/CommonComponents';
import {
  ProfileCardActions,
} from './components/cards/Cards';
import { ModConflictModal } from './components/modals/ModConflictModal';
import { ProjectDetailView } from './components/views/ProjectDetailView';
import { ArticleDetailView } from './components/views/ArticleDetailView';
import { NewsTab } from './components/views/tabs/NewsTab';
import { ExploreTab } from './components/views/tabs/ExploreTab';
import { ModsTab } from './components/views/tabs/ModsTab';
import { ShadersTab } from './components/views/tabs/ShadersTab';
import { ResourcePacksTab } from './components/views/tabs/ResourcePacksTab';
import { DatapacksTab } from './components/views/tabs/DatapacksTab';
import { ConsoleTab } from './components/views/tabs/ConsoleTab';
import { InstancesTab } from './components/views/tabs/InstancesTab';
import { useToasts } from './hooks/useToasts';
import { useLauncherLogs } from './hooks/useLauncherLogs';
import {
  ProfileModal,
  InstallModal,
  SettingsModal,
  AboutModal,
  LoginLoadingModal,
  UpdateModal,
} from './components/modals/LauncherModals';
import { InstanceModal } from './components/modals/InstanceModal';
import { AccountModal } from './components/modals/AccountModal';
import { MigrateInstanceModal } from './components/modals/MigrateInstanceModal';
import { ConfirmModal } from './components/modals/ConfirmModal';
import { CosmeticsModal } from './components/modals/CosmeticsModal';
import { ScreenshotsModal } from './components/modals/ScreenshotsModal';
import { getInstanceIconSrc } from './constants/instanceIcons';
import {
  createOfflineSession,
  getMcHeadsAvatarUrl,
  findModInList,
} from './utils/formatters';
import { normalizeLoader, resolveInstalledVersionForInstance } from './utils/versionSelection';
import { isBlazzySupportedVersion } from './utils/blazzySupport';

const APP_SOURCE_URL = 'https://github.com/hashimpope109-droid/Blazzy-Client';
const APP_RELEASES_URL = 'https://github.com/hashimpope109-droid/Blazzy-Client/releases/latest';

function requireSuccessfulResult(result, fallbackMessage) {
  if (result?.error) {
    throw new Error(result.message || String(result.error) || fallbackMessage);
  }
  return result;
}

const minecraftLoginWithAbort = async (profileKey) => {
  if (typeof window !== 'undefined' && window.launcher?.minecraftLogin) {
    return await window.launcher.minecraftLogin(profileKey);
  }
  return await launcher.minecraftLogin(profileKey);
};

export default function App() {
  const { language, setLanguage, t } = useI18n();
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [activeTab, setActiveTab] = useState('news');
  const [exploreType, setExploreType] = useState('mods'); // 'mods' | 'shaders' | 'resourcepacks' | 'datapacks'
  const [modSearch, setModSearch] = useState('');
  const [shaderSearch, setShaderSearch] = useState('');
  const [resourcePackSearch, setResourcePackSearch] = useState('');
  const [datapackSearch, setDatapackSearch] = useState('');

  const [versionCatalog, setVersionCatalog] = useState([]);
  const [installedVersions, setInstalledVersions] = useState([]);
  const [installTargets, setInstallTargets] = useState(INSTALL_TARGETS);
  const [mods, setMods] = useState([]);
  const [shaders, setShaders] = useState([]);
  const [resourcePacks, setResourcePacks] = useState([]);
  const [datapacks, setDatapacks] = useState([]);
  const [modrinthQueries, setModrinthQueries] = useState({ mods: '', shaders: '', resourcepacks: '', datapacks: '' });
  const [modrinthCategories, setModrinthCategories] = useState({ mods: 'all', shaders: 'all', resourcepacks: 'all', datapacks: 'all' });

  const modrinthQuery = modrinthQueries[exploreType] || '';
  const modrinthCategory = modrinthCategories[exploreType] || 'all';

  const setModrinthQuery = (val) => {
    setModrinthQueries(prev => ({
      ...prev,
      [exploreType]: typeof val === 'function' ? val(prev[exploreType] || '') : val,
    }));
  };

  const setModrinthCategory = (val) => {
    setModrinthCategories(prev => ({
      ...prev,
      [exploreType]: typeof val === 'function' ? val(prev[exploreType] || 'all') : val,
    }));
  };

  const [modrinthSort, setModrinthSort] = useState('relevance');
  const [modrinthLoaderFilter, setModrinthLoaderFilter] = useState('auto');
  const [modrinthVersionFilter, setModrinthVersionFilter] = useState('auto');
  const [modrinthResults, setModrinthResults] = useState([]);
  const [modrinthTotalHits, setModrinthTotalHits] = useState(0);
  const [modrinthLoading, setModrinthLoading] = useState(false);
  const [modrinthLoadingMore, setModrinthLoadingMore] = useState(false);
  const [modrinthInstalling, setModrinthInstalling] = useState({});
  const [selectedModDetail, setSelectedModDetail] = useState(null); // null | { project, initialTab: 'overview' | 'versions' }
  const [selectedArticle, setSelectedArticle] = useState(null); // null | { title, url, summary, image, author, published }
  const [installingVersionId, setInstallingVersionId] = useState(null);
  const [modUpdates, setModUpdates] = useState({});
  const [checkingModUpdates, setCheckingModUpdates] = useState(false);
  const [updatingMods, setUpdatingMods] = useState(new Set());
  const [modConflict, setModConflict] = useState(null);
  const {
    logs,
    setLogs,
    addLog,
    logFilter,
    setLogFilter,
    autoScroll,
    setAutoScroll,
  } = useLauncherLogs();
  const { toasts, pushToast, dismissToast } = useToasts();
  const [newsItems, setNewsItems] = useState([]);
  const [newsSourceUrl, setNewsSourceUrl] = useState('https://www.minecraft.net/en-us/articles');
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState('');
  const [gameState, setGameState] = useState('idle'); // idle | loading | running
  const [progress, setProgress] = useState(0);
  const [runPid, setRunPid] = useState(null);
  const [installId, setInstallId] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [updateState, setUpdateState] = useState({ phase: 'idle', progress: 0, message: '' });
  const [updateModalInfo, setUpdateModalInfo] = useState(null);
  const [instances, setInstances] = useState([]);
  const [activeInstanceId, setActiveInstanceId] = useState(null);
  const [instanceEditor, setInstanceEditor] = useState(null); // null | { mode: 'create' | 'edit', instance: null }
  const [migrateModalOpen, setMigrateModalOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [cosmeticsModalOpen, setCosmeticsModalOpen] = useState(false);
  const [screenshotsModalOpen, setScreenshotsModalOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null); // null | { title, message, confirmText, cancelText, danger, onConfirm }
  const [modal, setModal] = useState(null); // null | 'newProfile' | 'install-minecraft' | 'install-fabric' | 'install-forge' | 'settings' | 'about'
  const [profileEditor, setProfileEditor] = useState(null); // null | { mode: 'new' | 'edit', profileId: number | null }
  const [account, setAccount] = useState({ name: '', loggedIn: false, profileKey: 'default', kind: 'none', session: null });
  const [authRefreshing, setAuthRefreshing] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [showBetaInfo, setShowBetaInfo] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [systemTotalRam, setSystemTotalRam] = useState(
    typeof launcher?.systemTotalRamGb === 'number' && launcher.systemTotalRamGb > 0
      ? launcher.systemTotalRamGb
      : null
  );
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [settings, setSettings] = useState({
    keepOpen: false, launchBehavior: 'hide', showConsole: true, autoUpdate: true, showSnapshots: false, showUnsupportedVersions: false, javaPath: '', minecraftRoot: '', language,
  });
  const consoleRef = useRef(null);
  const modrinthSentinelRef = useRef(null);
  const betaInfoRef = useRef(null);
  const loginAbortControllerRef = useRef(null);
  const handlePlayRef = useRef(null);
  const initialLanguageRef = useRef(language);
  const saveQueueRef = useRef(Promise.resolve());
  const modrinthLoadingRef = useRef(false);
  const modrinthLoadingMoreRef = useRef(false);
  const modrinthResultsLengthRef = useRef(0);

  useEffect(() => {
    if (!showBetaInfo) return;
    const handleClickOutside = (e) => {
      if (betaInfoRef.current && !betaInfoRef.current.contains(e.target)) {
        setShowBetaInfo(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setShowBetaInfo(false);
    };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showBetaInfo]);

  const activeProfile = profiles.find(p => p.id === activeProfileId) || profiles[0] || null;
  const activeInstance = instances.find(instance => instance.id === activeInstanceId) || null;
  const activeInstanceVersion = resolveInstalledVersionForInstance(activeInstance, installedVersions);
  const activeProfileVersion = activeProfile?.version
    ? installedVersions.find(v => v.id === activeProfile.version) || null
    : null;
  const activeVersion = activeInstanceVersion || activeProfileVersion || installedVersions[0] || null;
  const selectedInstalledVersionId = activeInstance
    ? (activeInstanceVersion?.id || '')
    : (activeProfileVersion?.id || '');

  const stateRef = useRef({ profiles, activeProfileId, activeInstanceId, instances, mods, shaders, resourcePacks, datapacks, logs, settings, versionCatalog, installTargets });
  useEffect(() => {
    stateRef.current = { profiles, activeProfileId, activeInstanceId, instances, mods, shaders, resourcePacks, datapacks, logs, settings, versionCatalog, installTargets };
  }, [profiles, activeProfileId, activeInstanceId, instances, mods, shaders, resourcePacks, datapacks, logs, settings, versionCatalog, installTargets]);



  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
    };
    const handleOffline = () => {
      setIsOnline(false);
      pushToast({
        tone: 'warning',
        title: t('offline.badge'),
        message: t('offline.noConnectionToast'),
      });
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [t, pushToast]);

  // Listen for the native macOS "About" menu item which sends this event
  // from the main process via mainWindow.webContents.send('app:show-about').
  useEffect(() => {
    if (typeof launcher?.on !== 'function') return;
    const unsub = launcher.on('app:show-about', () => setModal('about'));
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  const loadNews = useCallback(async () => {
    setNewsLoading(true);
    setNewsError('');
    try {
      let payload = null;
      if (typeof launcher?.minecraftGetNews === 'function') {
        payload = await launcher.minecraftGetNews({ limit: 60 });
      }
      if (!payload || !payload.items || payload.items.length === 0) {
        payload = await loadMinecraftNews({ limit: 60 });
      }

      if (!payload) {
        setNewsError(t('news.errorNoNewsFound'));
        return;
      }
      if (payload.error && (!payload.items || payload.items.length === 0)) {
        setNewsError(payload.error);
        return;
      }
      if (Array.isArray(payload)) {
        setNewsItems(payload);
        return;
      }
      const items = Array.isArray(payload.items) ? payload.items : [];
      setNewsItems(items);
      if (payload.sourceUrl) {
        setNewsSourceUrl(payload.sourceUrl);
      }
    } catch (error) {
      try {
        const fallbackPayload = await loadMinecraftNews({ limit: 60 });
        if (fallbackPayload?.items?.length > 0) {
          setNewsItems(fallbackPayload.items);
          return;
        }
      } catch { }
      setNewsError(error?.message || t('news.errorNoNewsFound'));
    } finally {
      setNewsLoading(false);
    }
  }, [t]);
  const loadNewsRef = useRef(loadNews);
  useEffect(() => {
    loadNewsRef.current = loadNews;
  }, [loadNews]);

  useEffect(() => {
    if (autoScroll && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const persistState = useCallback((updates = {}) => {
    const currentState = stateRef.current;
    const nextState = {
      profiles: updates.profiles !== undefined ? updates.profiles : currentState.profiles,
      activeProfileId: updates.activeProfileId !== undefined ? updates.activeProfileId : currentState.activeProfileId,
      activeInstanceId: updates.activeInstanceId !== undefined ? updates.activeInstanceId : currentState.activeInstanceId,
      mods: updates.mods !== undefined ? updates.mods : currentState.mods,
      shaders: updates.shaders !== undefined ? updates.shaders : currentState.shaders,
      resourcePacks: updates.resourcePacks !== undefined ? updates.resourcePacks : currentState.resourcePacks,
      datapacks: updates.datapacks !== undefined ? updates.datapacks : currentState.datapacks,
      logs: updates.logs !== undefined ? updates.logs : currentState.logs,
      versions: updates.versions !== undefined ? updates.versions : currentState.versionCatalog,
      installTargets: updates.installTargets !== undefined ? updates.installTargets : currentState.installTargets,
      settings: updates.settings !== undefined ? updates.settings : currentState.settings,
    };
    stateRef.current = { ...currentState, ...nextState, versionCatalog: nextState.versions, logs: nextState.logs };
    if (nextState.activeInstanceId !== undefined) {
      try {
        if (nextState.activeInstanceId) {
          localStorage.setItem('openlauncher_active_instance', nextState.activeInstanceId);
        } else {
          localStorage.removeItem('openlauncher_active_instance');
        }
      } catch { }
    }
    saveQueueRef.current = saveQueueRef.current
      .catch(() => {})
      .then(() => launcher.minecraftSaveState?.(nextState));
  }, []);

  // Event listeners for installation and launcher lifecycle + state hydration
  useEffect(() => {
    const installProgressOff = launcher.on?.('minecraft:install-progress', (p) => {
      if (typeof p?.percent === 'number' && Number.isFinite(p.percent)) setProgress(p.percent);
      if (p?.message) addLog('info', p.message);
      if (p?.installId) setInstallId(p.installId);
    });

    const installFileOff = launcher.on?.('minecraft:install-file-progress', (f) => {
      if (typeof f?.percent === 'number' && Number.isFinite(f.percent)) {
        setProgress(f.percent);
      }
    });

    const installCompleteOff = launcher.on?.('minecraft:install-complete', (r) => {
      addLog('success', `Installation completed: ${r?.version || r?.label || 'version'}`);
      setProgress(100);
      setInstallId(null);
      launcher.minecraftGetInstalledVersions?.().then((versions) => {
        if (Array.isArray(versions)) {
          setInstalledVersions(versions);
          const installedVersion = versions.find(version => version.id === r?.id)
            || versions.find(version => r?.path && String(r.path).replace(/\\/g, '/').startsWith(String(version.path || '').replace(/\\/g, '/')))
            || null;
          const currentProfiles = stateRef.current.profiles;
          const curActiveId = stateRef.current.activeProfileId;
          const curActiveProfile = currentProfiles.find(p => p.id === curActiveId);
          const currentInstanceId = stateRef.current.activeInstanceId;
          if (installedVersion && currentInstanceId) {
            launcher.updateInstance?.(currentInstanceId, {
              version: installedVersion.id,
              loader: normalizeLoader(installedVersion.type || installedVersion.id),
            }).then(() => launcher.getInstances?.()).then(updated => {
              if (Array.isArray(updated)) setInstances(updated);
            }).catch(() => {});
          } else if (installedVersion || (versions.length > 0 && !curActiveProfile?.version)) {
            const selectedId = installedVersion?.id || versions[0].id;
            const nextProfiles = currentProfiles.map(p => p.id === curActiveId ? { ...p, version: selectedId } : p);
            setProfiles(nextProfiles);
            persistState({ profiles: nextProfiles });
          }
        }
      });
    });

    const installErrorOff = launcher.on?.('minecraft:install-error', (e) => {
      addLog('error', `Installation error: ${e?.message || e}`);
      setInstallId(null);
    });

    const installCancelledOff = launcher.on?.('minecraft:install-cancelled', (e) => {
      addLog('info', `Installation cancelled: ${e?.message || 'user cancelled'}`);
      setInstallId(null);
    });

    const updateAvailableOff = launcher.on?.('minecraft:update-available', (info) => {
      if (info?.available) {
        setUpdateModalInfo(info);
      }
    });

    const updateStatusOff = launcher.on?.('minecraft:update-status', (u) => {
      if (u?.phase) {
        setUpdateState(prev => ({
          ...prev,
          phase: u.phase,
          message: u.message || '',
          currentVersion: u.currentVersion,
          latestVersion: u.latestVersion,
        }));
      }
    });

    const updateProgressOff = launcher.on?.('minecraft:update-progress', (u) => {
      if (typeof u?.percent === 'number') {
        setUpdateState(prev => ({
          ...prev,
          phase: u.phase || 'downloading',
          progress: u.percent,
          assetName: u.assetName,
        }));
      }
    });

    const updateCompleteOff = launcher.on?.('minecraft:update-complete', () => {
      setUpdateState(prev => ({
        ...prev,
        phase: 'complete',
        message: 'Update ready',
      }));
    });

    const runLogOff = launcher.on?.('minecraft:run-log', (l) => {
      const type = l?.type === 'stderr' || l?.type === 'error' ? 'error' : l?.type === 'warn' ? 'warn' : 'info';
      addLog(type, l?.msg || '');
    });

    const assetProgressOff = launcher.on?.('minecraft:asset-progress', (a) => {
      if (typeof a?.percent === 'number' && Number.isFinite(a.percent)) {
        setProgress(a.percent);
      }
    });

    const runExitOff = launcher.on?.('minecraft:run-exit', (s) => {
      const exitMessage = s?.message ? `: ${s.message}` : '';
      addLog(s?.code === 0 ? 'info' : 'error', `Game process exited with code ${s?.code}${exitMessage}`);
      if (s?.code !== 0) {
        pushToast({
          tone: 'error',
          title: `Minecraft exited with code ${s?.code}`,
          message: s?.message || 'Open Console to view the launch error.',
        });
        if (s?.reason === 'mods') {
          setConfirmDialog({
            title: 'Launch without mods?',
            message: `${s.message}\n\nBlazzy Client can temporarily disable this instance's mods, launch Minecraft once, and restore every mod after the game closes.`,
            confirmText: 'Retry in safe mode',
            cancelText: 'Open Mods tab',
            danger: false,
            onConfirm: () => {
              setConfirmDialog(null);
              handlePlayRef.current?.(stateRef.current.activeInstanceId, { safeMode: true });
            },
            onCancel: () => setActiveTab('mods'),
          });
        }
      }
      setGameState('idle');
      setRunPid(null);
    });

    const modConflictOff = launcher.on?.('minecraft:mod-conflict', (conflictData) => {
      setModConflict(conflictData);
    });

    const openAboutOff = launcher.on?.('app:open-about', () => {
      setModal('about');
    });

    const initializeLauncher = async () => {
      try {
        const state = await launcher.minecraftGetState();
        if (state?.profiles && Array.isArray(state.profiles) && state.profiles.length > 0) {
          setProfiles(state.profiles);
          const activeId = state.activeProfileId && state.profiles.some(p => p.id === state.activeProfileId)
            ? state.activeProfileId
            : state.profiles[0].id;
          setActiveProfileId(activeId);
        } else {
          const defaultProfile = {
            id: 'default',
            name: 'Default',
            localName: 'Player',
            version: null,
            ram: 4,
            performanceMode: true,
            jvmArguments: '',
            javaPath: '',
          };
          setProfiles([defaultProfile]);
          setActiveProfileId('default');
        }

        if (state?.settings) {
          setSettings(prev => ({
            ...prev,
            ...state.settings,
            language: state.settings.language || initialLanguageRef.current,
          }));
        }

        if (state?.mods && Array.isArray(state.mods)) {
          setMods(state.mods);
        }

        if (state?.shaders && Array.isArray(state.shaders)) {
          setShaders(state.shaders);
        }

        if (state?.resourcePacks && Array.isArray(state.resourcePacks)) {
          setResourcePacks(state.resourcePacks);
        }

        if (state?.datapacks && Array.isArray(state.datapacks)) {
          setDatapacks(state.datapacks);
        }

        if (state?.logs && Array.isArray(state.logs)) {
          setLogs(state.logs);
        }

        const rootRes = await launcher.minecraftGetRoot?.();
        if (rootRes?.root) {
          setSettings(prev => ({ ...prev, minecraftRoot: rootRes.root }));
        }

        const [instVers, instMods, instShaders, instPacks, instDatapacks, loadedInstances] = await Promise.all([
          launcher.minecraftGetInstalledVersions ? launcher.minecraftGetInstalledVersions().catch(() => []) : [],
          launcher.minecraftGetInstalledMods ? launcher.minecraftGetInstalledMods().catch(() => []) : [],
          launcher.minecraftGetInstalledShaders ? launcher.minecraftGetInstalledShaders().catch(() => []) : [],
          launcher.minecraftGetInstalledResourcePacks ? launcher.minecraftGetInstalledResourcePacks().catch(() => []) : [],
          launcher.minecraftGetInstalledDatapacks ? launcher.minecraftGetInstalledDatapacks().catch(() => []) : [],
          launcher.getInstances ? launcher.getInstances().catch(() => []) : [],
        ]);

        const targetInstanceIdCandidate = state?.activeInstanceId || (() => {
          try { return localStorage.getItem('openlauncher_active_instance'); } catch { return null; }
        })();

        let resolvedActiveInstanceId = null;
        if (Array.isArray(loadedInstances)) {
          setInstances(loadedInstances);
          if (targetInstanceIdCandidate && loadedInstances.some(inst => inst.id === targetInstanceIdCandidate)) {
            resolvedActiveInstanceId = targetInstanceIdCandidate;
          } else {
            // Deleted externally or invalid ID -> fallback to Global (.minecraft)
            resolvedActiveInstanceId = null;
          }
          setActiveInstanceId(resolvedActiveInstanceId);
        }

        if (Array.isArray(instVers)) setInstalledVersions(instVers);
        if (Array.isArray(instMods)) setMods(instMods);
        if (Array.isArray(instShaders)) setShaders(instShaders);
        if (Array.isArray(instPacks)) setResourcePacks(instPacks);
        if (Array.isArray(instDatapacks)) setDatapacks(instDatapacks);

        let snapshot = null;
        if (launcher.minecraftGetCatalog) {
          snapshot = await launcher.minecraftGetCatalog({ includeSnapshots: state?.settings?.showSnapshots === true });
        }
        if (!snapshot || !snapshot.versions || snapshot.versions.length === 0) {
          snapshot = await loadLauncherCatalog({ includeSnapshots: state?.settings?.showSnapshots === true });
        }

        if (snapshot?.versions?.length > 0) {
          setVersionCatalog(snapshot.versions);
        }
        if (snapshot?.installTargets) {
          setInstallTargets(snapshot.installTargets);
        }

        if (state?.settings?.autoUpdate !== false) {
          launcher.minecraftCheckUpdate?.()
            .then(res => {
              if (res?.available) {
                setUpdateModalInfo(res);
              }
            })
            .catch(() => { });
        }
      } catch (err) {
        console.error('Failed to initialize launcher state:', err);
      }
    };

    launcher.getAppVersion?.()
      .then(ver => {
        if (ver) setAppVersion(String(ver));
      })
      .catch(() => { });

    launcher.getSystemInfo?.()
      .then(info => {
        if (info?.totalRamGb && info.totalRamGb > 0) {
          setSystemTotalRam(info.totalRamGb);
        }
      })
      .catch(() => { });

    initializeLauncher();
    loadNewsRef.current();

    return () => {
      installProgressOff?.();
      installFileOff?.();
      installCompleteOff?.();
      installErrorOff?.();
      installCancelledOff?.();
      updateAvailableOff?.();
      updateStatusOff?.();
      updateProgressOff?.();
      updateCompleteOff?.();
      runLogOff?.();
      assetProgressOff?.();
      runExitOff?.();
      modConflictOff?.();
      openAboutOff?.();
    };
  }, [addLog, persistState, pushToast, setLogs]);

  const handleOpenNewsSource = () => {
    launcher.openExternal?.(newsSourceUrl).catch(() => { });
  };

  const handleOpenNewsArticle = (item) => {
    if (typeof item === 'string') {
      const existing = newsItems.find(n => n.url === item);
      setSelectedArticle(existing || { url: item, title: 'Minecraft News' });
    } else {
      setSelectedArticle(item);
    }
  };

  const handleOpenSourceCode = () => {
    launcher.openExternal?.(APP_SOURCE_URL).catch(() => { });
  };

  const handleOpenReleases = () => {
    launcher.openExternal?.(APP_RELEASES_URL).catch(() => { });
  };

  // Account sync with active profile
  useEffect(() => {
    if (!activeProfile) return;
    const profileKey = String(activeProfile.id || 'default');
    let isMounted = true;
    setAuthRefreshing(true);

    launcher.minecraftGetAuthState(profileKey)
      .then(auth => {
        if (!isMounted) return;
        if (auth?.loggedIn && auth.name) {
          setAccount({
            name: auth.name,
            loggedIn: true,
            profileKey,
            kind: 'microsoft',
            session: auth,
          });
          if (activeProfile.skinName !== auth.name || activeProfile.microsoftAccount !== auth.name) {
            setProfiles(prev => {
              const next = prev.map(p => p.id === profileKey ? { ...p, skinName: auth.name, microsoftAccount: auth.name, localName: auth.name } : p);
              persistState({ profiles: next, activeProfileId: profileKey });
              return next;
            });
          }
        } else if (auth?.hasStoredToken && (auth?.name || activeProfile.skinName || activeProfile.microsoftAccount)) {
          // Token is stored on disk but we had a transient error (e.g. offline) -> keep Microsoft identity
          const savedName = auth.name || activeProfile.skinName || activeProfile.microsoftAccount || 'Player';
          setAccount({
            name: savedName,
            loggedIn: true,
            profileKey,
            kind: 'microsoft',
            session: auth?.access_token ? auth : createOfflineSession(savedName),
          });
        } else {
          const fallbackName = String(activeProfile.skinName || activeProfile.localName || activeProfile.name || '').trim();
          if (fallbackName) {
            setAccount({
              name: fallbackName,
              loggedIn: true,
              profileKey,
              kind: 'local',
              session: createOfflineSession(fallbackName),
            });
          } else {
            setAccount({ name: '', loggedIn: false, profileKey, kind: 'none', session: null });
          }
        }
      })
      .catch(() => {
        if (!isMounted) return;
        const fallbackName = String(activeProfile.skinName || activeProfile.localName || activeProfile.name || '').trim();
        setAccount({
          name: fallbackName,
          loggedIn: Boolean(fallbackName),
          profileKey,
          kind: fallbackName ? 'local' : 'none',
          session: fallbackName ? createOfflineSession(fallbackName) : null,
        });
      })
      .finally(() => {
        if (isMounted) setAuthRefreshing(false);
      });

    return () => { isMounted = false; };
  }, [activeProfile, persistState]);

  const handleSaveProfile = (profileData) => {
    setProfiles(prev => {
      let next;
      const targetId = profileData.id || `profile-${Date.now()}`;
      if (profileData.id) {
        next = prev.map(p => p.id === profileData.id ? { ...p, ...profileData } : p);
      } else {
        const newProfile = { ...profileData, id: targetId };
        next = [...prev, newProfile];
        setActiveProfileId(targetId);
      }
      persistState({
        profiles: next,
        activeProfileId: profileData.id ? activeProfileId : targetId,
      });
      return next;
    });
  };

  const handleDeleteProfile = (profileId) => {
    setProfiles(prev => {
      const next = prev.filter(p => p.id !== profileId);
      let nextActiveId = activeProfileId;
      if (next.length === 0) {
        const defaultProfile = {
          id: 'default',
          name: 'Default',
          localName: 'Player',
          version: null,
          ram: 4,
          performanceMode: true,
          jvmArguments: '',
          javaPath: '',
        };
        next.push(defaultProfile);
        nextActiveId = 'default';
      } else if (activeProfileId === profileId) {
        nextActiveId = next[0].id;
      }
      if (nextActiveId !== activeProfileId) {
        setActiveProfileId(nextActiveId);
      }
      persistState({
        profiles: next,
        activeProfileId: nextActiveId,
      });
      return next;
    });
  };

  const handleDuplicateProfile = (profileId, e) => {
    e?.stopPropagation();
    const sourceProfile = profiles.find(p => p.id === profileId);
    if (!sourceProfile) return;
    const newId = `profile-${Date.now()}`;
    const duplicatedProfile = {
      ...sourceProfile,
      id: newId,
      name: `${sourceProfile.name} (Copy)`,
    };
    setProfiles(prev => {
      const next = [...prev, duplicatedProfile];
      setActiveProfileId(newId);
      persistState({
        profiles: next,
        activeProfileId: newId,
      });
      return next;
    });
  };

  const handleInstall = async (type, opts) => {
    if (!isOnline) {
      pushToast({
        tone: 'error',
        title: t('install.minecraft') || 'Install',
        message: t('offline.installRequiresInternet'),
      });
      return;
    }
    setLogs([]);
    persistState({ logs: [] });
    const installPayload = typeof opts === 'string' ? { version: opts } : (opts || {});
    addLog('info', `Starting ${type} installation...`);
    setActiveTab('console');
    setProgress(0);
    try {
      const res = await launcher.minecraftInstall({
        type,
        ...installPayload,
        javaPath: activeInstance?.javaPath || activeProfile?.javaPath || settings.javaPath || '',
      });
      if (res?.error) {
        addLog('error', `Installation failed: ${res.message || res.error}`);
        pushToast({
          tone: 'error',
          title: 'Installation failed',
          message: res.message || String(res.error),
        });
      } else {
        const versions = await launcher.minecraftGetInstalledVersions?.();
        if (Array.isArray(versions)) setInstalledVersions(versions);
      }
    } catch (e) {
      addLog('error', `Install launch failed: ${e?.message || e}`);
    } finally {
      setInstallId(null);
    }
  };

  const handleCancelInstall = async () => {
    if (!installId) return;
    try {
      await launcher.minecraftInstallCancel({ installId });
    } catch (e) {
      addLog('error', `Failed to cancel install: ${e?.message || e}`);
    } finally {
      setInstallId(null);
    }
  };

  const handlePlay = async (instanceIdOverride = undefined, launchOptions = {}) => {
    if (gameState === 'running') {
      if (runPid) {
        try {
          requireSuccessfulResult(await launcher.minecraftStop({ pid: runPid }), 'Failed to stop Minecraft.');
          setGameState('idle');
          setRunPid(null);
        } catch (e) {
          addLog('error', `Failed to stop game: ${e?.message || e}`);
        }
      }
      return;
    }

    if (!activeProfile) return;
    setLogs([]);
    persistState({ logs: [] });
    setGameState('loading');
    setProgress(0);
    if (settings.showConsole !== false) {
      setActiveTab('console');
    }
    addLog('info', `Launching profile: ${activeProfile.name}`);

    try {
      let runSession = account.session;
      if (account.kind === 'microsoft' && launcher.minecraftGetAuthState) {
        try {
          const profileKey = String(activeProfile.id || 'default');
          const freshAuth = await launcher.minecraftGetAuthState(profileKey);
          if (freshAuth?.loggedIn && freshAuth?.access_token) {
            runSession = freshAuth;
            setAccount(prev => ({ ...prev, session: freshAuth }));
          }
        } catch {
          // Keep existing session if offline or transient error
        }
      }

      const launchInstanceId = instanceIdOverride === undefined ? activeInstanceId : instanceIdOverride;
      const activeInst = instances.find(i => i.id === launchInstanceId) || null;
      const resolvedInstanceVersion = resolveInstalledVersionForInstance(activeInst, installedVersions);
      if (activeInst && !resolvedInstanceVersion) {
        addLog('error', `Instance '${activeInst.name}' requires ${activeInst.loader || 'Minecraft'} ${activeInst.version}, but that version is not installed.`);
        pushToast({
          tone: 'error',
          title: t('install.installVersion'),
          message: `Install or select a valid ${activeInst.loader || 'Minecraft'} version for ${activeInst.name}.`,
        });
        setGameState('idle');
        setActiveTab('instances');
        return;
      }
      const targetVersion = activeInst
        ? resolvedInstanceVersion
        : (activeProfileVersion || installedVersions[0] || null);
      if (!activeInst && activeProfile?.version && !activeProfileVersion) {
        addLog('error', `Profile '${activeProfile.name}' requires ${activeProfile.version}, but that version is not installed.`);
        pushToast({
          tone: 'error',
          title: t('install.installVersion'),
          message: `Install ${activeProfile.version} or select an installed version for this profile.`,
        });
        setGameState('idle');
        setModal('install');
        return;
      }
      if (!targetVersion) {
        setGameState('idle');
        setModal('install');
        return;
      }

      const runProfile = {
        ...activeProfile,
        ram: activeInst?.ram || activeProfile.ram,
        performanceMode: activeInst?.performanceMode ?? activeProfile.performanceMode ?? true,
        jvmArguments: activeInst?.jvmArguments || activeProfile.jvmArguments,
        javaPath: activeInst?.javaPath || activeProfile.javaPath,
      };

      const runOpts = {
        profile: runProfile,
        version: targetVersion,
        instanceId: launchInstanceId,
        session: runSession || createOfflineSession(activeProfile.localName || 'Player'),
        online: isOnline,
        safeMode: launchOptions.safeMode === true,
      };
      const res = await launcher.minecraftRun(runOpts);
      if (res?.error) {
        addLog('error', `Launch failed: ${res.message || res.error}`);
        setGameState('idle');
        return;
      }
      if (res?.pid) {
        setRunPid(res.pid);
        setGameState('running');
        addLog('success', `Minecraft process started (PID: ${res.pid})`);
        if (activeInst?.id) {
          launcher.updateInstance?.(activeInst.id, { lastPlayed: Date.now() })
            .then(() => launcher.getInstances?.())
            .then(updated => { if (Array.isArray(updated)) setInstances(updated); })
            .catch(() => { });
        }
      } else {
        addLog('error', 'Minecraft did not return a process ID. Check the console log and try again.');
        setGameState('idle');
      }
    } catch (e) {
      addLog('error', `Launch exception: ${e?.message || e}`);
      setGameState('idle');
    }
  };
  useEffect(() => {
    handlePlayRef.current = handlePlay;
  });

  const handleSettingChange = (key, val) => {
    setSettings(prev => {
      const next = { ...prev, [key]: val };
      persistState({
        profiles,
        mods,
        logs,
        versions: versionCatalog,
        installTargets,
        settings: next,
      });
      if (key === 'showSnapshots') {
        const refreshCatalog = async () => {
          let catalog;
          if (launcher.minecraftGetCatalog) {
            catalog = await launcher.minecraftGetCatalog({ includeSnapshots: Boolean(val), showSnapshots: Boolean(val) });
          } else {
            catalog = await loadLauncherCatalog({ includeSnapshots: Boolean(val) });
          }
          if (catalog?.versions) setVersionCatalog(catalog.versions);
          if (catalog?.installTargets) setInstallTargets(catalog.installTargets);
        };
        refreshCatalog().catch((err) => console.error('Failed to refresh catalog on setting change:', err));
      }
      return next;
    });
  };

  const handleEnvironmentVersionChange = async (versionId) => {
    if (gameState === 'running' || !versionId) return;
    const selectedVersion = installedVersions.find(version => version.id === versionId);
    if (!selectedVersion) return;
    if (activeInstanceId) {
      try {
        const result = await launcher.updateInstance(activeInstanceId, {
          version: selectedVersion.id,
          loader: normalizeLoader(selectedVersion.type || selectedVersion.id),
        });
        requireSuccessfulResult(result, 'Could not update instance version.');
        const updated = await launcher.getInstances();
        if (Array.isArray(updated)) setInstances(updated);
      } catch (error) {
        pushToast({ tone: 'error', title: t('instances.settings'), message: error?.message || 'Could not update instance version.' });
      }
      return;
    }
    if (!activeProfileId) return;
    setProfiles(previous => {
      const nextProfiles = previous.map(profile =>
        profile.id === activeProfileId ? { ...profile, version: selectedVersion.id } : profile
      );
      persistState({ profiles: nextProfiles });
      return nextProfiles;
    });
  };

  const handleLogin = async () => {
    if (!isOnline) {
      pushToast({
        tone: 'error',
        title: t('account.loginWithMicrosoft'),
        message: t('offline.loginRequiresInternet'),
      });
      return;
    }
    const profileKey = String(activeProfile?.id || 'default');
    setLoginLoading(true);
    addLog('info', t('account.loginWithMicrosoft') + '...');
    const abortController = new AbortController();
    loginAbortControllerRef.current = abortController;

    try {
      const accountInfo = await minecraftLoginWithAbort(profileKey);
      if (accountInfo?.error) {
        if (accountInfo.cancelled) {
          addLog('info', t('account.loginCancelled'));
        } else {
          addLog('error', `Login failed: ${accountInfo.error}`);
          pushToast({
            tone: 'error',
            title: t('account.loginWithMicrosoft'),
            message: accountInfo.error,
          });
        }
        return;
      }

      if (accountInfo?.name) {
        setAccount({
          name: accountInfo.name,
          loggedIn: true,
          profileKey,
          kind: 'microsoft',
          session: accountInfo,
        });
        setProfiles(prev => {
          const next = prev.map(p => {
            if (p.id === profileKey) {
              return {
                ...p,
                skinName: accountInfo.name,
                microsoftAccount: accountInfo.name,
                localName: accountInfo.name,
              };
            }
            return p;
          });
          persistState({ profiles: next, activeProfileId: profileKey });
          return next;
        });
        addLog('success', `Logged in as ${accountInfo.name}`);
        pushToast({
          tone: 'success',
          title: t('account.loginWithMicrosoft'),
          message: t('messages.loginSuccess', { name: accountInfo.name }),
        });
      } else {
        addLog('error', 'Login did not return account information.');
      }
    } catch (error) {
      if (error?.name === 'AbortError' || error?.message?.includes('cancelled')) {
        addLog('info', t('account.loginCancelled'));
      } else {
        addLog('error', `Login failed: ${error?.message || error}`);
        pushToast({
          tone: 'error',
          title: t('account.loginWithMicrosoft'),
          message: error?.message || t('messages.loginFailed', { error: '' }),
        });
      }
    } finally {
      setLoginLoading(false);
      loginAbortControllerRef.current = null;
    }
  };

  const handleLogout = async () => {
    const profileKey = String(activeProfile?.id || 'default');
    try {
      await launcher.minecraftLogout(profileKey);
      const fallbackName = (activeProfile?.name && activeProfile?.name !== 'Default') ? activeProfile.name : 'Player';
      setProfiles(prev => {
        const next = prev.map(p => {
          if (p.id === profileKey) {
            return {
              ...p,
              microsoftAccount: '',
              skinName: '',
              localName: fallbackName,
            };
          }
          return p;
        });
        persistState({ profiles: next, activeProfileId: profileKey });
        return next;
      });
      setAccount({
        name: fallbackName,
        loggedIn: Boolean(fallbackName),
        profileKey,
        kind: fallbackName ? 'local' : 'none',
        session: fallbackName ? createOfflineSession(fallbackName) : null,
      });
      addLog('info', 'Logged out from Microsoft.');
      pushToast({
        tone: 'info',
        title: t('account.logout'),
        message: t('messages.logoutSuccess'),
      });
    } catch (e) {
      addLog('error', `Logout failed: ${e?.message || e}`);
    }
  };

  const handleModToggle = async (modId) => {
    const targetMod = mods.find(m => m.id === modId);
    if (!targetMod) return;
    const nextState = !targetMod.enabled;
    try {
      requireSuccessfulResult(await launcher.minecraftToggleMod(modId, nextState, activeInstanceId), 'Failed to toggle mod.');
      loadMods();
    } catch (e) {
      addLog('error', `Failed to toggle mod: ${e?.message || e}`);
    }
  };

  const handleSetAllModsEnabled = async (enable) => {
    try {
      requireSuccessfulResult(await launcher.minecraftSetAllModsEnabled(enable, activeInstanceId), 'Failed to update mods.');
      loadMods();
    } catch (e) {
      addLog('error', `Failed to set all mods enabled: ${e?.message || e}`);
    }
  };

  const handleModDelete = async (modId) => {
    try {
      requireSuccessfulResult(await launcher.minecraftDeleteMod(modId, activeInstanceId), 'Failed to delete mod.');
      loadMods();
    } catch (e) {
      addLog('error', `Failed to delete mod: ${e?.message || e}`);
    }
  };

  const handleAddModClick = async () => {
    try {
      const picked = await launcher.minecraftPickModFiles?.();
      const filePaths = Array.isArray(picked) ? picked : (picked?.filePaths || []);
      if (filePaths.length > 0) {
        for (const filePath of filePaths) {
          requireSuccessfulResult(await launcher.minecraftInstallModFile(filePath, activeInstanceId), `Failed to import ${filePath}.`);
        }
        loadMods();
        pushToast({ tone: 'success', title: t('sidebar.modManager'), message: t('mods.modsImportedSuccess', { count: filePaths.length }) });
      }
    } catch (e) {
      addLog('error', `Failed to add mod: ${e?.message || e}`);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer?.files || []).filter(file => {
      const name = file.name.toLowerCase();
      return name.endsWith('.jar') || name.endsWith('.olpkg') || name.endsWith('.zip');
    });
    if (files.length === 0) return;

    const targetType = activeTab === 'shaders' ? 'shaders' : activeTab === 'resourcepacks' ? 'resourcepacks' : activeTab === 'datapacks' ? 'datapacks' : (activeTab === 'explore' ? exploreType : 'mods');

    addLog('info', t('mods.importingCount', { count: files.length }));
    try {
      if (targetType === 'shaders') {
        let imported = 0;
        for (const file of files) {
          if (!file.name.toLowerCase().endsWith('.zip')) continue;
          const filePath = launcher.getPathForFile?.(file) || file.path || '';
          if (!filePath) throw new Error(`Could not access ${file.name}`);
          const res = await launcher.minecraftImportContentFile?.({ type: 'shader', sourcePath: filePath, fileName: file.name }, activeInstanceId);
          requireSuccessfulResult(res, `Failed to import ${file.name}.`);
          if (res?.ok) imported++;
        }
        if (imported > 0) {
          loadShaders();
          pushToast({ tone: 'success', title: t('mods.contentTypeShaders'), message: t('mods.shadersImportedSuccess', { count: imported }) });
        }
      } else if (targetType === 'resourcepacks') {
        let imported = 0;
        for (const file of files) {
          if (!file.name.toLowerCase().endsWith('.zip')) continue;
          const filePath = launcher.getPathForFile?.(file) || file.path || '';
          if (!filePath) throw new Error(`Could not access ${file.name}`);
          const res = await launcher.minecraftImportContentFile?.({ type: 'resourcepack', sourcePath: filePath, fileName: file.name }, activeInstanceId);
          requireSuccessfulResult(res, `Failed to import ${file.name}.`);
          if (res?.ok) imported++;
        }
        if (imported > 0) {
          loadResourcePacks();
          pushToast({ tone: 'success', title: t('mods.contentTypeResourcePacks'), message: t('mods.resourcePacksImportedSuccess', { count: imported }) });
        }
      } else if (targetType === 'datapacks') {
        let imported = 0;
        for (const file of files) {
          if (!file.name.toLowerCase().endsWith('.zip')) continue;
          const filePath = launcher.getPathForFile?.(file) || file.path || '';
          if (!filePath) throw new Error(`Could not access ${file.name}`);
          const res = await launcher.minecraftImportContentFile?.({ type: 'datapack', sourcePath: filePath, fileName: file.name }, activeInstanceId);
          requireSuccessfulResult(res, `Failed to import ${file.name}.`);
          if (res?.ok) imported++;
        }
        if (imported > 0) {
          loadDatapacks();
          pushToast({ tone: 'success', title: t('mods.contentTypeDatapacks'), message: t('mods.datapacksImportedSuccess', { count: imported }) });
        }
      } else {
        for (const file of files) {
          const filePath = launcher.getPathForFile?.(file) || file.path || '';
          if (!filePath) throw new Error(`Could not access ${file.name}`);
          requireSuccessfulResult(await launcher.minecraftInstallModFile(filePath, activeInstanceId), `Failed to import ${file.name}.`);
        }
        loadMods();
        pushToast({ tone: 'success', title: t('sidebar.modManager'), message: t('mods.modsImportedSuccess', { count: files.length }) });
      }
    } catch (err) {
      addLog('error', `Error importing files: ${err?.message || err}`);
    }
  };

  // ── Load installed content ──
  const loadMods = useCallback(async () => {
    try {
      const list = await launcher.minecraftGetInstalledMods?.(activeInstanceId);
      if (Array.isArray(list)) {
        setMods(list);
        if (activeInstanceId) {
          setInstances(previous => previous.map(instance =>
            instance.id === activeInstanceId ? { ...instance, modsCount: list.length } : instance
          ));
        }
        persistState({ mods: list });
      }
    } catch (error) {
      addLog('error', `Failed to load mods: ${error?.message || error}`);
    }
  }, [activeInstanceId, addLog, persistState]);

  const loadShaders = useCallback(async () => {
    try {
      const list = await launcher.minecraftGetInstalledShaders?.(activeInstanceId);
      if (Array.isArray(list)) {
        setShaders(list);
        persistState({ shaders: list });
      }
    } catch { }
  }, [activeInstanceId, persistState]);

  const loadResourcePacks = useCallback(async () => {
    try {
      const list = await launcher.minecraftGetInstalledResourcePacks?.(activeInstanceId);
      if (Array.isArray(list)) {
        setResourcePacks(list);
        persistState({ resourcePacks: list });
      }
    } catch { }
  }, [activeInstanceId, persistState]);

  const loadDatapacks = useCallback(async () => {
    try {
      const list = await launcher.minecraftGetInstalledDatapacks?.(activeInstanceId);
      if (Array.isArray(list)) {
        setDatapacks(list);
        persistState({ datapacks: list });
      }
    } catch { }
  }, [activeInstanceId, persistState]);

  // Synchronize content whenever activeInstanceId changes
  useEffect(() => {
    setMods([]);
    setShaders([]);
    setResourcePacks([]);
    setDatapacks([]);
    loadMods();
    loadShaders();
    loadResourcePacks();
    loadDatapacks();
  }, [activeInstanceId, loadMods, loadShaders, loadResourcePacks, loadDatapacks]);

  useEffect(() => {
    const refreshInstalledContent = async () => {
      const [versions, refreshedInstances] = await Promise.all([
        launcher.minecraftGetInstalledVersions?.().catch(() => []),
        launcher.getInstances?.().catch(() => []),
      ]);
      if (Array.isArray(versions)) setInstalledVersions(versions);
      if (Array.isArray(refreshedInstances)) setInstances(refreshedInstances);
      loadMods();
      loadShaders();
      loadResourcePacks();
      loadDatapacks();
    };
    window.addEventListener('focus', refreshInstalledContent);
    return () => window.removeEventListener('focus', refreshInstalledContent);
  }, [loadMods, loadShaders, loadResourcePacks, loadDatapacks]);

  const handleDeleteShader = async (shader) => {
    try {
      const res = await launcher.minecraftDeleteShader?.(shader.fileName, activeInstanceId);
      requireSuccessfulResult(res, 'Delete failed.');
      if (res?.ok) {
        loadShaders();
        pushToast({ tone: 'success', title: t('mods.deleteShader'), message: `${shader.name || shader.fileName} removed.` });
      }
    } catch (err) {
      pushToast({ tone: 'error', title: t('mods.deleteShader'), message: err?.message || 'Delete failed.' });
    }
  };

  const handleDeleteResourcePack = async (pack) => {
    try {
      const res = await launcher.minecraftDeleteResourcePack?.(pack.fileName, activeInstanceId);
      requireSuccessfulResult(res, 'Delete failed.');
      if (res?.ok) {
        loadResourcePacks();
        pushToast({ tone: 'success', title: t('mods.deleteResourcePack'), message: `${pack.name || pack.fileName} removed.` });
      }
    } catch (err) {
      pushToast({ tone: 'error', title: t('mods.deleteResourcePack'), message: err?.message || 'Delete failed.' });
    }
  };

  const handleDeleteDatapack = async (pack) => {
    try {
      const res = await launcher.minecraftDeleteDatapack?.(pack.fileName, activeInstanceId);
      requireSuccessfulResult(res, 'Delete failed.');
      if (res?.ok) {
        loadDatapacks();
        pushToast({ tone: 'success', title: t('mods.deleteDatapack'), message: `${pack.name || pack.fileName} removed.` });
      }
    } catch (err) {
      pushToast({ tone: 'error', title: t('mods.deleteDatapack'), message: err?.message || 'Delete failed.' });
    }
  };

  const handleOpenContentFolder = async (type) => {
    try {
      const targetType = type || (activeTab === 'shaders' ? 'shaders' : activeTab === 'resourcepacks' ? 'resourcepacks' : activeTab === 'datapacks' ? 'datapacks' : 'mods');
      requireSuccessfulResult(await launcher.minecraftOpenContentFolder?.(targetType, activeInstanceId), 'Could not open content folder.');
    } catch (error) {
      pushToast({ tone: 'error', title: t('sidebar.modManager'), message: error?.message || 'Could not open content folder.' });
    }
  };

  const handleAddContentClick = async (type) => {
    try {
      const targetType = type || (activeTab === 'shaders' ? 'shaders' : activeTab === 'resourcepacks' ? 'resourcepacks' : activeTab === 'datapacks' ? 'datapacks' : 'mods');
      if (targetType === 'shaders' || targetType === 'shader') {
        const res = await launcher.minecraftPickContentFiles?.('shader');
        if (res?.filePaths?.length > 0) {
          for (const fp of res.filePaths) {
            requireSuccessfulResult(await launcher.minecraftImportContentFile?.({ type: 'shader', sourcePath: fp }, activeInstanceId), `Failed to import ${fp}.`);
          }
          loadShaders();
          pushToast({ tone: 'success', title: t('mods.contentTypeShaders'), message: t('mods.shadersImportedSuccess', { count: res.filePaths.length }) });
        }
      } else if (targetType === 'resourcepacks' || targetType === 'resourcepack') {
        const res = await launcher.minecraftPickContentFiles?.('resourcepack');
        if (res?.filePaths?.length > 0) {
          for (const fp of res.filePaths) {
            requireSuccessfulResult(await launcher.minecraftImportContentFile?.({ type: 'resourcepack', sourcePath: fp }, activeInstanceId), `Failed to import ${fp}.`);
          }
          loadResourcePacks();
          pushToast({ tone: 'success', title: t('mods.contentTypeResourcePacks'), message: t('mods.resourcePacksImportedSuccess', { count: res.filePaths.length }) });
        }
      } else if (targetType === 'datapacks' || targetType === 'datapack') {
        const res = await launcher.minecraftPickContentFiles?.('datapack');
        if (res?.filePaths?.length > 0) {
          for (const fp of res.filePaths) {
            requireSuccessfulResult(await launcher.minecraftImportContentFile?.({ type: 'datapack', sourcePath: fp }, activeInstanceId), `Failed to import ${fp}.`);
          }
          loadDatapacks();
          pushToast({ tone: 'success', title: t('mods.contentTypeDatapacks'), message: t('mods.datapacksImportedSuccess', { count: res.filePaths.length }) });
        }
      } else {
        await handleAddModClick();
      }
    } catch (error) {
      pushToast({ tone: 'error', title: t('sidebar.modManager'), message: error?.message || 'Import failed.' });
    }
  };

  // ── Modrinth Search & Install logic ──
  const instanceLoader = String(activeInstance?.loader || '').toLowerCase();
  const profileLoader = String(activeInstance
    ? (activeInstanceVersion?.type || activeInstance.loader || activeInstance.version || '')
    : (activeProfileVersion?.type || activeProfile?.version || '')).toLowerCase();
  const currentLoader = instanceLoader || (profileLoader.includes('fabric') ? 'fabric' : profileLoader.includes('neoforge') ? 'neoforge' : profileLoader.includes('forge') ? 'forge' : profileLoader.includes('quilt') ? 'quilt' : '');
  const rawMcVer = activeInstance?.version || activeProfileVersion?.inheritsFrom || activeProfileVersion?.mcVer || activeVersion?.inheritsFrom || activeVersion?.mcVer || activeProfile?.version || activeVersion?.id || '';
  const currentMcVer = resolveMinecraftVersion(rawMcVer);

  const effectiveLoader = modrinthLoaderFilter === 'auto' ? currentLoader : (modrinthLoaderFilter === 'all' ? '' : modrinthLoaderFilter);
  const effectiveMcVer = modrinthVersionFilter === 'auto' ? currentMcVer : '';

  useEffect(() => {
    modrinthLoadingRef.current = modrinthLoading;
    modrinthLoadingMoreRef.current = modrinthLoadingMore;
    modrinthResultsLengthRef.current = modrinthResults.length;
  }, [modrinthLoading, modrinthLoadingMore, modrinthResults.length]);

  const executeModrinthSearch = useCallback(async (isLoadMore = false) => {
    if (!isOnline) {
      setModrinthLoading(false);
      setModrinthLoadingMore(false);
      return;
    }

    if (isLoadMore) {
      if (modrinthLoadingRef.current || modrinthLoadingMoreRef.current) return;
      modrinthLoadingMoreRef.current = true;
      setModrinthLoadingMore(true);
    } else {
      modrinthLoadingRef.current = true;
      setModrinthLoading(true);
    }

    const currentOffset = isLoadMore ? modrinthResultsLengthRef.current : 0;
    const projectType = exploreType === 'shaders' ? 'shader' : exploreType === 'resourcepacks' ? 'resourcepack' : exploreType === 'datapacks' ? 'datapack' : 'mod';

    try {
      let data;
      if (typeof window !== 'undefined' && window.launcher?.minecraftModrinthSearch) {
        data = await window.launcher.minecraftModrinthSearch({
          projectType,
          query: modrinthQuery,
          loader: projectType === 'mod' ? effectiveLoader : '',
          gameVersion: effectiveMcVer,
          category: modrinthCategory === 'all' ? '' : modrinthCategory,
          sortBy: modrinthSort,
          offset: currentOffset,
          limit: 60,
        });
      } else {
        data = await searchModrinthProjects({
          projectType,
          query: modrinthQuery,
          loader: projectType === 'mod' ? effectiveLoader : '',
          gameVersion: effectiveMcVer,
          category: modrinthCategory === 'all' ? '' : modrinthCategory,
          sortBy: modrinthSort,
          offset: currentOffset,
          limit: 60,
        });
      }
      if (data?.hits) {
        if (isLoadMore) {
          setModrinthResults(prev => {
            const existingIds = new Set(prev.map(p => p.project_id || p.slug));
            const freshHits = data.hits.filter(h => !existingIds.has(h.project_id || h.slug));
            return [...prev, ...freshHits];
          });
        } else {
          setModrinthResults(data.hits);
        }
        setModrinthTotalHits(data.total_hits || (isLoadMore ? currentOffset + data.hits.length : data.hits.length));
      }
    } catch (e) {
      console.error('Modrinth search failed:', e);
      if (!isLoadMore) {
        pushToast({ tone: 'error', title: 'Modrinth', message: e?.message || 'Failed to search.' });
      }
    } finally {
      if (isLoadMore) {
        modrinthLoadingMoreRef.current = false;
        setModrinthLoadingMore(false);
      } else {
        modrinthLoadingRef.current = false;
        setModrinthLoading(false);
      }
    }
  }, [isOnline, exploreType, modrinthQuery, effectiveLoader, effectiveMcVer, modrinthCategory, modrinthSort, pushToast]);

  useEffect(() => {
    setModrinthResults([]);
    setModrinthTotalHits(0);
    setModrinthLoading(true);
  }, [exploreType]);

  useEffect(() => {
    if (activeTab === 'explore') {
      if (!isOnline) {
        setModrinthLoading(false);
        return;
      }
      setModrinthLoading(true);
      const timer = setTimeout(() => {
        executeModrinthSearch(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [activeTab, isOnline, executeModrinthSearch]);

  const hasMoreModrinth = modrinthResults.length < modrinthTotalHits;

  useEffect(() => {
    if (activeTab !== 'explore') return;
    if (!isOnline || !hasMoreModrinth || modrinthLoading || modrinthLoadingMore) return;

    const sentinel = modrinthSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        executeModrinthSearch(true);
      }
    }, { rootMargin: '250px' });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeTab, isOnline, hasMoreModrinth, modrinthLoading, modrinthLoadingMore, executeModrinthSearch]);

  const handleInstallModrinthMod = async (project) => {
    if (!isOnline) {
      pushToast({
        tone: 'error',
        title: 'Modrinth',
        message: t('offline.noConnectionToast'),
      });
      return;
    }
    const projectId = project.project_id || project.slug;
    const projectType = project.project_type || (exploreType === 'shaders' ? 'shader' : exploreType === 'resourcepacks' ? 'resourcepack' : exploreType === 'datapacks' ? 'datapack' : 'mod');
    setModrinthInstalling(prev => ({ ...prev, [projectId]: true }));
    setLogs([]);
    persistState({ logs: [] });
    setActiveTab('console');
    addLog('info', `Installing ${projectType} '${project.title || projectId}' from Modrinth...`);

    try {
      let res;
      if (typeof window !== 'undefined' && window.launcher?.minecraftModrinthInstall) {
        res = await window.launcher.minecraftModrinthInstall({
          projectId,
          projectType,
          gameVersion: effectiveMcVer || currentMcVer,
          loader: projectType === 'mod' ? (effectiveLoader || currentLoader) : undefined,
          instanceId: activeInstanceId,
        });
      } else {
        res = { ok: true, fileName: `${projectId}.zip` };
      }

      if (res?.ok) {
        if (projectType === 'shader') {
          if (Array.isArray(res.items)) setShaders(res.items);
          else loadShaders();
        } else if (projectType === 'resourcepack') {
          if (Array.isArray(res.items)) setResourcePacks(res.items);
          else loadResourcePacks();
        } else if (projectType === 'datapack') {
          if (Array.isArray(res.items)) setDatapacks(res.items);
          else loadDatapacks();
        } else {
          if (Array.isArray(res.mods || res.items)) setMods(res.mods || res.items);
          else loadMods();
        }
        addLog('success', `${projectType === 'shader' ? 'Shader' : projectType === 'resourcepack' ? 'Texture pack' : projectType === 'datapack' ? 'Data pack' : 'Mod'} '${project.title || projectId}' installed.`);
        pushToast({
          tone: 'success',
          title: t('mods.install'),
          message: t('mods.installedSuccess', { name: project.title || projectId }),
        });
      } else {
        throw new Error(res?.error || 'Installation failed');
      }
    } catch (err) {
      addLog('error', `Failed to install '${project.title || projectId}': ${err?.message || err}`);
      pushToast({
        tone: 'error',
        title: t('mods.install'),
        message: t('mods.installError', { name: project.title || projectId, error: err?.message || '' }),
      });
    } finally {
      setModrinthInstalling(prev => ({ ...prev, [projectId]: false }));
    }
  };

  const handleOpenModDetails = (project) => {
    setSelectedModDetail({ project, initialTab: 'overview' });
  };

  const handleOpenLocalModDetails = (mod) => {
    const fileKey = mod.fileName ? mod.fileName.replace(/\.jar(\.disabled)?$/i, '').toLowerCase() : '';
    const updateInfo = modUpdates[mod.fileName] || modUpdates[fileKey] || modUpdates[mod.name] || modUpdates[mod.id] || null;
    const knownProjectId = updateInfo?.projectId || mod.projectId || mod.modrinthId;
    const slugCandidate = knownProjectId || mod.modId || (mod.fileName ? mod.fileName.replace(/\.jar(\.disabled)?$/i, '').replace(/[-_]v?\d+.*$/i, '') : '') || mod.id;
    setSelectedModDetail({
      project: {
        project_id: knownProjectId || slugCandidate,
        slug: knownProjectId || slugCandidate,
        modId: mod.modId,
        title: mod.name || mod.fileName || mod.id,
        name: mod.name || mod.fileName || mod.id,
        author: mod.authors || '',
        authors: mod.authors || '',
        description: mod.description || '',
        icon_url: mod.iconUrl,
        project_type: 'mod',
        localItem: mod,
      },
      initialTab: 'overview',
    });
  };

  const handleOpenLocalShaderDetails = (shader) => {
    const slugCandidate = shader.projectId || shader.modrinthId || shader.id || (shader.fileName ? shader.fileName.replace(/\.zip$/i, '') : '');
    setSelectedModDetail({
      project: {
        project_id: slugCandidate,
        slug: slugCandidate,
        title: shader.name || shader.fileName,
        name: shader.name || shader.fileName,
        author: shader.authors || '',
        authors: shader.authors || '',
        description: shader.description || '',
        icon_url: shader.iconUrl,
        project_type: 'shader',
        localItem: shader,
      },
      initialTab: 'overview',
    });
  };

  const handleOpenLocalResourcePackDetails = (pack) => {
    const slugCandidate = pack.projectId || pack.modrinthId || pack.id || (pack.fileName ? pack.fileName.replace(/\.zip$/i, '') : '');
    setSelectedModDetail({
      project: {
        project_id: slugCandidate,
        slug: slugCandidate,
        title: pack.name || pack.fileName,
        name: pack.name || pack.fileName,
        author: pack.authors || '',
        authors: pack.authors || '',
        description: pack.description || '',
        icon_url: pack.iconUrl,
        project_type: 'resourcepack',
        localItem: pack,
      },
      initialTab: 'overview',
    });
  };

  const handleOpenLocalDatapackDetails = (pack) => {
    const slugCandidate = pack.projectId || pack.modrinthId || pack.id || (pack.fileName ? pack.fileName.replace(/\.zip$/i, '') : '');
    setSelectedModDetail({
      project: {
        project_id: slugCandidate,
        slug: slugCandidate,
        title: pack.name || pack.fileName,
        name: pack.name || pack.fileName,
        author: pack.authors || '',
        authors: pack.authors || '',
        description: pack.description || '',
        icon_url: pack.iconUrl,
        project_type: 'datapack',
        localItem: pack,
      },
      initialTab: 'overview',
    });
  };

  const handleInstallSpecificVersion = async (project, version) => {
    if (!isOnline) {
      pushToast({
        tone: 'error',
        title: 'Modrinth',
        message: t('offline.noConnectionToast'),
      });
      return;
    }
    const projectId = project.project_id || project.slug || project.id;
    const projectType = project.project_type || (exploreType === 'shaders' ? 'shader' : exploreType === 'resourcepacks' ? 'resourcepack' : exploreType === 'datapacks' ? 'datapack' : 'mod');
    setInstallingVersionId(version.id);
    const primaryFile = version.files?.find(f => f.primary) || version.files?.[0];
    const verNumber = version.version_number || version.name || '';
    setLogs([]);
    persistState({ logs: [] });
    setActiveTab('console');
    addLog('info', `[Modrinth] Installing ${project.title || projectId} (v${verNumber})...`);

    try {
      let res;
      if (typeof window !== 'undefined' && window.launcher?.minecraftModrinthInstall) {
        res = await window.launcher.minecraftModrinthInstall({
          projectId,
          projectType,
          versionId: version.id,
          fileUrl: primaryFile?.url,
          fileName: primaryFile?.filename,
          gameVersion: version.game_versions?.[0] || effectiveMcVer || currentMcVer,
          loader: projectType === 'mod' ? (version.loaders?.[0] || effectiveLoader || currentLoader) : undefined,
          instanceId: activeInstanceId,
        });
      } else {
        res = { ok: true, fileName: primaryFile?.filename || `${projectId}.zip` };
      }

      if (res?.ok) {
        if (projectType === 'shader') {
          if (Array.isArray(res.items)) setShaders(res.items);
          else loadShaders();
        } else if (projectType === 'resourcepack') {
          if (Array.isArray(res.items)) setResourcePacks(res.items);
          else loadResourcePacks();
        } else if (projectType === 'datapack') {
          if (Array.isArray(res.items)) setDatapacks(res.items);
          else loadDatapacks();
        } else {
          if (Array.isArray(res.mods || res.items)) setMods(res.mods || res.items);
          else loadMods();
        }
        addLog('success', `[Modrinth] '${project.title || projectId}' (v${verNumber}) installed.`);
        pushToast({
          tone: 'success',
          title: t('mods.install'),
          message: t('mods.installedSuccess', { name: `${project.title || projectId} v${verNumber}` }),
        });
      } else {
        throw new Error(res?.error || 'Installation failed');
      }
    } catch (err) {
      addLog('error', `[Modrinth] Failed to install version: ${err?.message || err}`);
      pushToast({
        tone: 'error',
        title: t('mods.install'),
        message: t('mods.installError', { name: project.title || projectId, error: err?.message || '' }),
      });
    } finally {
      setInstallingVersionId(null);
    }
  };

  const isModInstalled = useCallback((project) => {
    if (!project) return false;
    const projectType = project.project_type || (exploreType === 'shaders' ? 'shader' : exploreType === 'resourcepacks' ? 'resourcepack' : exploreType === 'datapacks' ? 'datapack' : 'mod');
    const slug = String(project.slug || '').toLowerCase().trim();
    const projId = String(project.project_id || project.id || '').toLowerCase().trim();
    const cleanTitle = String(project.title || '').toLowerCase().trim();

    if (projectType === 'shader') {
      if (!Array.isArray(shaders) || shaders.length === 0) return false;
      return shaders.some(s => {
        const sId = String(s.id || '').toLowerCase().trim();
        const sName = String(s.name || '').toLowerCase().trim();
        const sFile = String(s.fileName || '').toLowerCase().trim();
        return (slug && (sId === slug || sFile.startsWith(slug))) || (projId && sId === projId) || (cleanTitle && sName === cleanTitle);
      });
    }

    if (projectType === 'resourcepack') {
      if (!Array.isArray(resourcePacks) || resourcePacks.length === 0) return false;
      return resourcePacks.some(p => {
        const pId = String(p.id || '').toLowerCase().trim();
        const pName = String(p.name || '').toLowerCase().trim();
        const pFile = String(p.fileName || '').toLowerCase().trim();
        return (slug && (pId === slug || pFile.startsWith(slug))) || (projId && pId === projId) || (cleanTitle && pName === cleanTitle);
      });
    }

    if (projectType === 'datapack') {
      if (!Array.isArray(datapacks) || datapacks.length === 0) return false;
      return datapacks.some(p => {
        const pId = String(p.id || '').toLowerCase().trim();
        const pName = String(p.name || '').toLowerCase().trim();
        const pFile = String(p.fileName || '').toLowerCase().trim();
        return (slug && (pId === slug || pFile.startsWith(slug))) || (projId && pId === projId) || (cleanTitle && pName === cleanTitle);
      });
    }

    if (!Array.isArray(mods) || mods.length === 0) return false;

    return mods.some(m => {
      const mModId = String(m.modId || '').toLowerCase().trim();
      const mName = String(m.name || '').toLowerCase().trim();
      const mFile = String(m.fileName || m.id || '').toLowerCase().trim();

      // 1. Exact match by internal jar modId or project id
      if (mModId && (mModId === slug || mModId === projId)) return true;

      // 2. Exact match by mod title
      if (cleanTitle && mName === cleanTitle) return true;

      // 3. Exact filename prefix match
      if (slug) {
        if (slug === 'sodium' && (mFile.includes('extra') || mFile.includes('reeses') || mFile.includes('options'))) {
          return false;
        }
        if (slug === 'iris' && mFile.includes('flawless')) {
          return false;
        }
        if (mFile === `${slug}.jar` || mFile === `${slug}.olpkg`) return true;
        const slugPrefixRegex = new RegExp(`^${slug}(?:[-_+v0-9.mc]|fabric|neoforge|forge)`, 'i');
        if (slugPrefixRegex.test(mFile)) return true;
      }
      return false;
    });
  }, [exploreType, mods, shaders, resourcePacks, datapacks]);

  const checkingModUpdatesRef = useRef(false);
  const hasCheckedModsOnTabOpenRef = useRef(false);

  const handleCheckModUpdates = useCallback(async (options = {}) => {
    const silent = options?.silent ?? false;
    if (checkingModUpdatesRef.current) return;
    checkingModUpdatesRef.current = true;
    setCheckingModUpdates(true);
    try {
      if (!isOnline) {
        if (!silent) {
          pushToast({
            tone: 'warning',
            title: t('mods.checkUpdates'),
            message: t('offline.noConnectionToast'),
          });
        }
        return;
      }
      const loader = effectiveLoader || currentLoader || 'fabric';
      const gameVersion = effectiveMcVer || currentMcVer || '';

      const res = await launcher.minecraftCheckModUpdates?.({ loader, gameVersion, instanceId: activeInstanceId });
      if (res?.updates) {
        setModUpdates(res.updates);
        const count = Object.keys(res.updates).filter(k => k.includes('.jar')).length;
        if (!silent) {
          if (count > 0) {
            pushToast({
              tone: 'success',
              title: t('mods.checkUpdates'),
              message: t('mods.updatesAvailable', { count }),
            });
          } else {
            pushToast({
              tone: 'info',
              title: t('mods.checkUpdates'),
              message: t('mods.upToDate'),
            });
          }
        }
      }
    } catch (e) {
      if (!silent) {
        pushToast({
          tone: 'error',
          title: t('mods.checkUpdates'),
          message: e?.message || String(e),
        });
      }
    } finally {
      checkingModUpdatesRef.current = false;
      setCheckingModUpdates(false);
    }
  }, [isOnline, effectiveLoader, currentLoader, effectiveMcVer, currentMcVer, activeInstanceId, pushToast, t]);

  const handleUpdateMod = async (updateInfo) => {
    if (!updateInfo) return;
    const key = updateInfo.fileName || updateInfo.fileKey;
    setUpdatingMods(prev => new Set(prev).add(key));
    try {
      const loader = effectiveLoader || currentLoader || 'fabric';
      const gameVersion = effectiveMcVer || currentMcVer || '';
      const res = await launcher.minecraftModrinthInstall?.({
        projectId: updateInfo.projectId,
        versionId: updateInfo.versionId,
        fileUrl: updateInfo.fileUrl,
        fileName: updateInfo.targetFileName || updateInfo.fileName,
        loader,
        gameVersion,
        instanceId: activeInstanceId,
      });

      if (res?.error) {
        pushToast({
          tone: 'error',
          title: t('mods.updateMod'),
          message: res.message || res.error,
        });
        return;
      }

      if (res?.mods && Array.isArray(res.mods)) {
        setMods(res.mods);
      } else {
        const loadedMods = await launcher.minecraftGetInstalledMods?.(activeInstanceId);
        if (Array.isArray(loadedMods)) setMods(loadedMods);
      }

      setModUpdates(prev => {
        const next = { ...prev };
        delete next[updateInfo.fileName];
        delete next[updateInfo.fileKey];
        return next;
      });

      pushToast({
        tone: 'success',
        title: t('mods.updateMod'),
        message: t('mods.installedSuccess', { name: updateInfo.newVersionName || updateInfo.fileName }),
      });
    } catch (e) {
      pushToast({
        tone: 'error',
        title: t('mods.updateMod'),
        message: e?.message || String(e),
      });
    } finally {
      setUpdatingMods(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleUpdateAllMods = async () => {
    const updateEntries = Object.values(modUpdates).filter((u, i, arr) => arr.findIndex(x => x.fileName === u.fileName) === i);
    if (updateEntries.length === 0) return;
    for (const updateInfo of updateEntries) {
      await handleUpdateMod(updateInfo);
    }
  };

  const handleResolveConflictUpdate = async (rec) => {
    if (!rec) return;
    setLogs([]);
    persistState({ logs: [] });
    try {
      pushToast({
        tone: 'info',
        title: t('mods.updating'),
        message: `${rec.displayName || rec.modId} -> v${rec.targetVersion}`,
      });
      const loader = currentLoader || 'fabric';
      const gameVersion = currentMcVer || '';
      const res = await launcher.minecraftModrinthInstall?.({
        projectId: rec.modId,
        versionId: null,
        versionNumber: rec.targetVersion,
        loader,
        gameVersion,
        instanceId: activeInstanceId,
      });
      if (res?.error) {
        pushToast({
          tone: 'error',
          title: t('mods.conflictTitle'),
          message: res.message || res.error,
        });
        return;
      }
      if (res?.mods && Array.isArray(res.mods)) {
        setMods(res.mods);
      } else {
        const loadedMods = await launcher.minecraftGetInstalledMods?.(activeInstanceId);
        if (Array.isArray(loadedMods)) setMods(loadedMods);
      }
      setModConflict(null);
      pushToast({
        tone: 'success',
        title: t('mods.installedSuccess', { name: rec.displayName || rec.modId }),
        message: t('mods.installedSuccess', { name: rec.displayName || rec.modId }),
      });
    } catch (e) {
      pushToast({
        tone: 'error',
        title: t('mods.conflictTitle'),
        message: e?.message || String(e),
      });
    }
  };

  const [fixingAllConflicts, setFixingAllConflicts] = useState(false);

  const handleAutoFixAllConflicts = async (compatFixes) => {
    if (!compatFixes || compatFixes.length === 0) return;
    setLogs([]);
    persistState({ logs: [] });
    setFixingAllConflicts(true);
    pushToast({
      tone: 'info',
      title: t('mods.conflictFixAllBtn'),
      message: t('mods.conflictFixing'),
    });
    try {
      const loader = currentLoader || 'fabric';
      const gameVersion = currentMcVer || '';

      for (const fix of compatFixes) {
        const mainMod = findModInList(mods, fix.modId, fix.displayName);

        const mainCurrent = String(mainMod?.version || '').replace(/^v/i, '').trim();
        const mainTarget = String(fix.targetVersion || '').replace(/^v/i, '').trim();

        // Install base compatible version only if needed
        if (!mainCurrent || mainCurrent !== mainTarget) {
          await launcher.minecraftModrinthInstall?.({
            projectId: fix.modId,
            versionNumber: fix.targetVersion,
            loader,
            gameVersion,
            instanceId: activeInstanceId,
          });
        }

        // Cascade updates/downgrades for companion mods
        if (Array.isArray(fix.cascade)) {
          for (const item of fix.cascade) {
            const cascadeMod = findModInList(mods, item.modId, item.displayName);
            if (cascadeMod) {
              const cCurrent = String(cascadeMod.version || '').replace(/^v/i, '').trim();
              const cTarget = String(item.targetVersion || '').replace(/^v/i, '').trim();
              if (!cCurrent || cCurrent !== cTarget) {
                await launcher.minecraftModrinthInstall?.({
                  projectId: item.modId,
                  versionNumber: item.targetVersion,
                  loader,
                  gameVersion,
                  instanceId: activeInstanceId,
                });
              }
            }
          }
        }
      }

      // Re-enable Iris if it was disabled
      const irisMod = mods.find(m => String(m.id || '').toLowerCase() === 'iris' || String(m.fileName || '').toLowerCase().includes('iris'));
      if (irisMod && !irisMod.enabled) {
        await launcher.minecraftToggleMod?.(irisMod.id || irisMod.fileName, true, activeInstanceId);
      }

      const refreshed = await launcher.minecraftGetInstalledMods?.(activeInstanceId);
      if (Array.isArray(refreshed)) setMods(refreshed);
      setModConflict(null);

      pushToast({
        tone: 'success',
        title: t('mods.conflictFixAllBtn'),
        message: t('mods.conflictFixedSuccess'),
      });
    } catch (e) {
      pushToast({
        tone: 'error',
        title: t('mods.conflictTitle'),
        message: e?.message || String(e),
      });
    } finally {
      setFixingAllConflicts(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'mods' || activeTab === 'shaders' || activeTab === 'resourcepacks' || activeTab === 'datapacks' || activeTab === 'explore') {
      loadMods();
      loadShaders();
      loadResourcePacks();
      loadDatapacks();

      if (activeTab === 'mods' && isOnline) {
        if (!hasCheckedModsOnTabOpenRef.current) {
          hasCheckedModsOnTabOpenRef.current = true;
          handleCheckModUpdates({ silent: true });
        }
      }
    } else {
      hasCheckedModsOnTabOpenRef.current = false;
    }
  }, [activeTab, isOnline, loadMods, loadShaders, loadResourcePacks, loadDatapacks, handleCheckModUpdates]);

  const handleCheckForUpdates = async () => {
    addLog('info', t('messages.checkingUpdates'));
    pushToast({ tone: 'info', title: t('update.launcherUpdate'), message: t('messages.checkingUpdates') });
    try {
      const res = await launcher.minecraftCheckUpdate?.();
      if (res?.available && res?.latestVersion) {
        setUpdateModalInfo(res);
      } else if (res?.upToDate) {
        pushToast({ tone: 'success', title: t('update.launcherUpdate'), message: t('messages.alreadyUpToDate') });
      }
    } catch (e) {
      addLog('error', `Update check failed: ${e?.message || e}`);
      pushToast({ tone: 'error', title: t('update.launcherUpdate'), message: t('messages.updateCheckFailed', { error: e?.message || '' }) });
    }
  };

  const handleApplyUpdate = async (updateInfo) => {
    setUpdateModalInfo(null);
    setUpdateState({
      phase: 'downloading',
      progress: 0,
      latestVersion: updateInfo?.latestVersion,
      message: t('updater.downloading', { assetName: updateInfo?.asset?.name || '' }),
    });
    try {
      await launcher.minecraftApplyUpdate(updateInfo);
    } catch (e) {
      addLog('error', `Failed to apply update: ${e?.message || e}`);
    }
  };

  const handleOpenMinecraftDirectory = async () => {
    try {
      if (activeInstanceId) {
        await launcher.minecraftOpenContentFolder?.('instance', activeInstanceId);
      } else {
        await launcher.minecraftOpenRootDirectory?.();
      }
    } catch (e) {
      addLog('error', `Failed to open directory: ${e?.message || e}`);
    }
  };

  const handleCopyConsole = () => {
    const text = logs.map(l => `[${l.time}] [${l.level.toUpperCase()}] ${l.msg}`).join('\n');
    navigator.clipboard?.writeText(text);
    pushToast({ tone: 'info', title: t('console.copy'), message: t('console.copiedToClipboard') });
  };

  const handleClearConsole = () => {
    setLogs([]);
    persistState({ logs: [] });
  };

  // Avatar resolution helper
  const profileAvatarName = (account.loggedIn && account.name)
    ? account.name
    : (activeProfile?.skinName || activeProfile?.microsoftAccount || (activeProfile?.localName && activeProfile?.localName !== 'Player' ? activeProfile?.localName : '') || 'MHF_Steve');
  const profileAvatarUrl = getMcHeadsAvatarUrl(profileAvatarName, 64);

  // Version Loader Type badge helper
  const loaderType = String(activeVersion?.type || activeVersion?.id || '').toLowerCase();
  const loaderBadgeClass = loaderType.includes('fabric') ? 'fabric' : loaderType.includes('neoforge') ? 'neoforge' : loaderType.includes('forge') ? 'forge' : loaderType.includes('quilt') ? 'quilt' : 'vanilla';
  const loaderBadgeLabel = loaderType.includes('fabric') ? 'Fabric' : loaderType.includes('neoforge') ? 'NeoForge' : loaderType.includes('forge') ? 'Forge' : loaderType.includes('quilt') ? 'Quilt' : 'Vanilla';

  const profileToEdit = profileEditor?.mode === 'edit'
    ? profiles.find(p => p.id === profileEditor.profileId) || null
    : null;

  return (
    <>
      <div className="toast-stack" aria-live="polite">
        {toasts.map(toast => (
          <Toast key={toast.id} toast={toast} onClose={dismissToast} />
        ))}
      </div>

      {/* ── WINDOW TITLEBAR ── */}
      <div className="titlebar">
        <div className="titlebar-brand">
          <div className="titlebar-logo">
            <img src={logoIcon} alt="Logo" style={{ width: 20, height: 20 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          </div>
          <span className="titlebar-name">{t('app.name')}</span>
          <span className="titlebar-version">{appVersion ? `v${appVersion}` : '1.0.0'}</span>
        </div>
        {!launcher?.isMac && launcher?.platform !== 'darwin' && (
          <div className="titlebar-controls">
            <button className="win-btn" onClick={() => launcher.windowMinimize()} title={t('window.minimize')}>
              <Icon d={ICONS.minimize} size={11} />
            </button>
            <button className="win-btn" onClick={() => launcher.windowMaximize()} title={t('window.maximize')}>
              <Icon d={ICONS.maximize} size={10} />
            </button>
            <button className="win-btn close" onClick={() => launcher.windowClose()} title={t('window.close')}>
              <Icon d={ICONS.x} size={11} />
            </button>
          </div>
        )}
      </div>

      {/* ── APP LAYOUT ── */}
      <div className="app-layout">
        {/* ── SIDEBAR ── */}
        <aside className="sidebar">
          <div className="sidebar-scroll">
            <div className="sidebar-heading">
              <span className="sidebar-title">{t('sidebar.profiles')}</span>
            </div>

            <div className="profile-list">
              {profiles.map(p => {
                const installedProfileVersion = p.version
                  ? installedVersions.find(v => v.id === p.version) || getVersionById(p.version, versionCatalog)
                  : null;
                const profileVersionLabel = resolveMinecraftVersion(installedProfileVersion?.inheritsFrom || installedProfileVersion?.mcVer || p.version) || 'Auto';
                const isSelected = p.id === activeProfileId;
                const avatarName = (account.loggedIn && account.profileKey === p.id && account.name)
                  ? account.name
                  : (p.skinName || p.microsoftAccount || (p.localName && p.localName !== 'Player' ? p.localName : '') || 'MHF_Steve');

                return (
                  <div
                    key={p.id}
                    className={`profile-card ${isSelected ? 'active' : ''}`}
                    onClick={() => {
                      if (authRefreshing || gameState === 'running') return;
                      setActiveProfileId(p.id);
                      persistState({ activeProfileId: p.id });
                    }}
                  >
                    <div className="profile-avatar">
                      <RemoteImage
                        key={`profile-avatar-${p.id}-${avatarName}`}
                        src={getMcHeadsAvatarUrl(avatarName, 64)}
                        fallback={logoIcon}
                        alt={avatarName}
                      />
                    </div>
                    <div className="profile-info">
                      <div className="profile-name-row">
                        <span className="profile-name">{p.name}</span>
                        <ProfileCardActions
                          active={isSelected}
                          name={p.name}
                          disabled={authRefreshing || gameState === 'running'}
                          onEdit={(e) => {
                            e.stopPropagation();
                            setProfileEditor({ mode: 'edit', profileId: p.id });
                          }}
                          onDuplicate={(e) => handleDuplicateProfile(p.id, e)}
                          onDelete={(e) => {
                            e.stopPropagation();
                            handleDeleteProfile(p.id);
                          }}
                        />
                      </div>
                      <div className="profile-badges-row">
                        <span className="profile-chip version">{profileVersionLabel}</span>
                        <span className="profile-chip">{p.ram || 4} GB</span>
                      </div>
                    </div>
                  </div>
                );
              })}

              <button
                className="add-profile-btn"
                onClick={() => setProfileEditor({ mode: 'new', profileId: null })}
                disabled={authRefreshing || gameState === 'running'}
              >
                <Icon d={ICONS.plus} size={13} />
                <span>{t('sidebar.newProfile')}</span>
              </button>
            </div>

            {/* ── DISCOVER ── */}
            <div className="sidebar-heading" style={{ marginTop: 10 }}>
              <span className="sidebar-title">{t('sidebar.discover')}</span>
            </div>

            <div className="sidebar-nav">
              <div
                className={`nav-item ${activeTab === 'news' && !selectedModDetail && !selectedArticle ? 'active' : ''}`}
                onClick={() => { setSelectedModDetail(null); setSelectedArticle(null); setActiveTab('news'); }}
              >
                <span className="nav-icon"><Icon d={ICONS.news} size={14} /></span>
                <span>{t('sidebar.news')}</span>
              </div>
              <div
                className={`nav-item ${activeTab === 'explore' && !selectedModDetail && !selectedArticle ? 'active' : ''}`}
                onClick={() => { setSelectedModDetail(null); setSelectedArticle(null); setActiveTab('explore'); }}
              >
                <span className="nav-icon"><Icon d={ICONS.compass} size={14} /></span>
                <span>{t('sidebar.explore')}</span>
              </div>
            </div>

            {/* ── MY LIBRARY ── */}
            <div className="sidebar-heading" style={{ marginTop: 12 }}>
              <span className="sidebar-title">{t('sidebar.library')}</span>
            </div>

            <div className="sidebar-nav">
              <div
                className={`nav-item ${activeTab === 'instances' && !selectedModDetail && !selectedArticle ? 'active' : ''}`}
                onClick={() => { setSelectedModDetail(null); setSelectedArticle(null); setActiveTab('instances'); }}
              >
                <span className="nav-icon"><Icon d={ICONS.layers} size={14} /></span>
                <span>{t('sidebar.instances') || 'Instances'}</span>
                <span className="nav-counter">{instances.length}</span>
              </div>
              <div
                className={`nav-item ${cosmeticsModalOpen ? 'active' : ''}`}
                onClick={() => setCosmeticsModalOpen(true)}
              >
                <span className="nav-icon"><Icon d={ICONS.sparkles} size={14} /></span>
                <span>{t('sidebar.cosmetics')}</span>
              </div>
              <div className={`nav-item ${screenshotsModalOpen ? 'active' : ''}`} onClick={() => setScreenshotsModalOpen(true)}>
                <span className="nav-icon"><Icon d={ICONS.folder} size={14} /></span>
                <span>Screenshots</span>
              </div>
              <div className="nav-item" onClick={() => launcher.openExternal(APP_SOURCE_URL)}>
                <span className="nav-icon"><Icon d={ICONS.globe} size={14} /></span>
                <span>Social</span>
              </div>
              <div className="nav-item" title="Coming soon">
                <span className="nav-icon"><Icon d={ICONS.sparkles} size={14} /></span>
                <span>Store · Soon</span>
              </div>
              <div
                className={`nav-item ${activeTab === 'mods' && !selectedModDetail && !selectedArticle ? 'active' : ''}`}
                onClick={() => { setSelectedModDetail(null); setSelectedArticle(null); setActiveTab('mods'); }}
              >
                <span className="nav-icon"><Icon d={ICONS.cube} size={14} /></span>
                <span>{t('sidebar.mods')}</span>
                <span className="nav-counter">{mods.filter(m => m.enabled).length}</span>
              </div>
              <div
                className={`nav-item ${activeTab === 'shaders' && !selectedModDetail && !selectedArticle ? 'active' : ''}`}
                onClick={() => { setSelectedModDetail(null); setSelectedArticle(null); setActiveTab('shaders'); }}
              >
                <span className="nav-icon"><Icon d={ICONS.sun} size={14} /></span>
                <span>{t('sidebar.shaders')}</span>
                <span className="nav-counter">{shaders.length}</span>
              </div>
              <div
                className={`nav-item ${activeTab === 'resourcepacks' && !selectedModDetail && !selectedArticle ? 'active' : ''}`}
                onClick={() => { setSelectedModDetail(null); setSelectedArticle(null); setActiveTab('resourcepacks'); }}
              >
                <span className="nav-icon"><Icon d={ICONS.layers} size={14} /></span>
                <span>{t('sidebar.resourcePacks')}</span>
                <span className="nav-counter">{resourcePacks.length}</span>
              </div>
              <div
                className={`nav-item ${activeTab === 'datapacks' && !selectedModDetail && !selectedArticle ? 'active' : ''}`}
                onClick={() => { setSelectedModDetail(null); setSelectedArticle(null); setActiveTab('datapacks'); }}
              >
                <span className="nav-icon"><Icon d={ICONS.datapack} size={14} /></span>
                <span>{t('sidebar.datapacks')}</span>
                <span className="nav-counter">{datapacks.length}</span>
              </div>
            </div>

            {/* ── SYSTEM ── */}
            <div className="sidebar-heading" style={{ marginTop: 12 }}>
              <span className="sidebar-title">{t('sidebar.system')}</span>
            </div>

            <div className="sidebar-nav">
              <div
                className={`nav-item ${activeTab === 'console' && !selectedModDetail && !selectedArticle ? 'active' : ''}`}
                onClick={() => { setSelectedModDetail(null); setSelectedArticle(null); setActiveTab('console'); }}
              >
                <span className="nav-icon"><Icon d={ICONS.console} size={14} /></span>
                <span>{t('sidebar.console')}</span>
                {gameState === 'running' && <span className="status-dot in-game" style={{ marginLeft: 'auto' }} />}
              </div>
              <div
                className={`nav-item ${modal === 'settings' ? 'active' : ''}`}
                onClick={() => setModal('settings')}
              >
                <span className="nav-icon"><Icon d={ICONS.settings} size={14} /></span>
                <span>{t('sidebar.settings')}</span>
              </div>
            </div>
          </div>

          {/* ── ACCOUNT AREA ── */}
          <div className="sidebar-account">
            <div
              className="account-card"
              style={{ cursor: 'pointer' }}
              onClick={() => setAccountModalOpen(true)}
              title={t('accountModal.manageTitle')}
            >
              <div className="account-avatar">
                <RemoteImage
                  key={`account-avatar-${profileAvatarName}`}
                  src={profileAvatarUrl}
                  fallback={logoIcon}
                  alt={profileAvatarName}
                />
              </div>
              <div className="account-info">
                <span className="account-name">{account.name || t('account.loggedOut')}</span>
                <span className="account-status-label">
                  <span className={`status-dot ${gameState === 'running' ? 'in-game' : account.loggedIn ? 'online' : ''}`} />
                  {authRefreshing ? (
                    <span>{t('account.refreshingAuth')}</span>
                  ) : gameState === 'running' ? (
                    <span>{t('account.inGame')}</span>
                  ) : account.kind === 'microsoft' ? (
                    <span>{t('account.microsoftBadge')}</span>
                  ) : account.loggedIn ? (
                    <span>{t('account.offline')}</span>
                  ) : (
                    <span>{t('account.guest')}</span>
                  )}
                </span>
              </div>
              {account.kind === 'microsoft' ? (
                <button className="account-auth-btn logout" onClick={handleLogout} title={t('account.logout')}>
                  <Icon d={ICONS.logout} size={12} />
                </button>
              ) : (
                <button className="account-auth-btn" onClick={handleLogin} title={t('account.loginWithMicrosoft')}>
                  <MicrosoftLogo />
                </button>
              )}
            </div>
          </div>
        </aside>

        {/* ── MAIN CONTENT ── */}
        <main className="main-content">
          {selectedArticle ? (
            <ArticleDetailView
              item={selectedArticle}
              onBack={() => setSelectedArticle(null)}
            />
          ) : selectedModDetail ? (
            <ProjectDetailView
              project={selectedModDetail.project}
              initialTab={selectedModDetail.initialTab || 'overview'}
              currentLoader={currentLoader}
              currentMcVer={currentMcVer}
              mods={
                selectedModDetail?.project?.project_type === 'shader' || exploreType === 'shaders' ? shaders :
                  selectedModDetail?.project?.project_type === 'resourcepack' || exploreType === 'resourcepacks' ? resourcePacks :
                    selectedModDetail?.project?.project_type === 'datapack' || exploreType === 'datapacks' ? datapacks : mods
              }
              installingVersionId={installingVersionId}
              onBack={() => setSelectedModDetail(null)}
              onInstallVersion={handleInstallSpecificVersion}
              parentTabTitle={
                selectedModDetail.parentTitle ||
                (activeTab === 'explore' ? t('sidebar.explore') :
                  activeTab === 'mods' ? t('sidebar.mods') :
                    activeTab === 'shaders' ? t('sidebar.shaders') :
                      activeTab === 'resourcepacks' ? t('sidebar.resourcePacks') :
                        activeTab === 'datapacks' ? t('sidebar.datapacks') : t('sidebar.explore'))
              }
            />
          ) : (
            <>
              {/* Top Action Toolbar */}
              <div className="action-bar">
                <div className="action-bar-tabs">
                  {/* Discover Group */}
                  <div className="tab-group">
                    <button
                      className={`tab-btn ${activeTab === 'news' ? 'active' : ''}`}
                      onClick={() => setActiveTab('news')}
                    >
                      <Icon d={ICONS.news} size={13} />
                      <span>{t('sidebar.news')}</span>
                    </button>
                    <button
                      className={`tab-btn ${activeTab === 'explore' ? 'active' : ''}`}
                      onClick={() => setActiveTab('explore')}
                    >
                      <Icon d={ICONS.compass} size={13} />
                      <span>{t('sidebar.explore')}</span>
                    </button>
                  </div>

                  <div className="tab-group-divider" />

                  {/* Library Group */}
                  <div className="tab-group">
                    <button
                      className={`tab-btn ${activeTab === 'instances' ? 'active' : ''}`}
                      onClick={() => setActiveTab('instances')}
                    >
                      <Icon d={ICONS.layers} size={13} />
                      <span>{t('sidebar.instances') || 'Instances'}</span>
                    </button>
                    <button
                      className={`tab-btn ${activeTab === 'mods' ? 'active' : ''}`}
                      onClick={() => setActiveTab('mods')}
                    >
                      <Icon d={ICONS.cube} size={13} />
                      <span>{t('sidebar.mods')}</span>
                    </button>
                    <button
                      className={`tab-btn ${activeTab === 'shaders' ? 'active' : ''}`}
                      onClick={() => setActiveTab('shaders')}
                    >
                      <Icon d={ICONS.sun} size={13} />
                      <span>{t('sidebar.shaders')}</span>
                    </button>
                    <button
                      className={`tab-btn ${activeTab === 'resourcepacks' ? 'active' : ''}`}
                      onClick={() => setActiveTab('resourcepacks')}
                    >
                      <Icon d={ICONS.layers} size={13} />
                      <span>{t('sidebar.resourcePacks')}</span>
                    </button>
                    <button
                      className={`tab-btn ${activeTab === 'datapacks' ? 'active' : ''}`}
                      onClick={() => setActiveTab('datapacks')}
                    >
                      <Icon d={ICONS.datapack} size={13} />
                      <span>{t('sidebar.datapacks')}</span>
                    </button>
                  </div>

                  <div className="tab-group-divider" />

                  {/* System Group */}
                  <div className="tab-group">
                    <button
                      className={`tab-btn ${activeTab === 'console' ? 'active' : ''}`}
                      onClick={() => setActiveTab('console')}
                    >
                      <Icon d={ICONS.console} size={13} />
                      <span>{t('sidebar.console')}</span>
                    </button>
                  </div>
                </div>

                <div className="action-bar-actions">
                  <div
                    className={`environment-badge ${activeInstance ? 'is-instance' : 'is-global'}`}
                    onClick={() => setActiveTab('instances')}
                    title={activeInstance ? t('instances.managingInstance', { name: activeInstance.name }) : t('instances.managingGlobal')}
                  >
                    {activeInstance ? (
                      <>
                        <img
                          src={getInstanceIconSrc(activeInstance.icon)}
                          alt={activeInstance.name}
                          className="env-icon"
                        />
                        <span className="env-name">
                          {activeInstance.name}
                        </span>
                      </>
                    ) : (
                      <>
                        <Icon d={ICONS.folder} size={13} className="env-icon-svg" />
                        <span className="env-name">
                          {t('instances.globalInstallation')}
                        </span>
                      </>
                    )}
                  </div>

                  {!isOnline && (
                    <div className="offline-pill" title={t('offline.newsDesc')}>
                      <Icon d={ICONS.wifiOff} size={12} />
                      <span>{t('offline.badge')}</span>
                    </div>
                  )}
                  <button
                    className="btn-primary"
                    onClick={() => setModal('install')}
                    disabled={gameState === 'running'}
                    title={t('install.installVersion')}
                    style={{ gap: 6, padding: '7px 14px' }}
                  >
                    <Icon d={ICONS.download} size={13} />
                    <span>{t('install.installVersion')}</span>
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={handleOpenMinecraftDirectory}
                    title={t('settings.openMinecraftDirectory')}
                  >
                    <Icon d={ICONS.folder} size={12} />
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => setModal('settings')}
                    title={t('settings.title')}
                  >
                    <Icon d={ICONS.settings} size={12} />
                  </button>
                </div>
              </div>

              {/* Update Notification Banner */}
              {updateState.phase === 'downloading' || updateState.phase === 'launching' || updateState.phase === 'complete' ? (
                <div className="update-banner">
                  <div className="update-banner-header">
                    <span className="update-banner-title">{t('update.launcherUpdate')} — {updateState.latestVersion || ''}</span>
                    <span style={{ fontSize: 11, color: 'var(--accent-bright)', fontFamily: 'var(--font-mono)' }}>
                      {updateState.phase === 'downloading' ? `${updateState.progress || 0}%` : updateState.phase}
                    </span>
                  </div>
                  <div className="update-banner-progress">
                    <div className="update-banner-fill" style={{ width: `${Math.max(0, Math.min(100, updateState.progress || 0))}%` }} />
                  </div>
                </div>
              ) : null}

              <InstancesTab
                active={activeTab === 'instances'}
                instances={instances}
                activeInstanceId={activeInstanceId}
                onSelectInstance={(id) => {
                  setActiveInstanceId(id);
                  persistState({ activeInstanceId: id });
                }}
                onPlayInstance={(inst) => {
                  setActiveInstanceId(inst.id);
                  persistState({ activeInstanceId: inst.id });
                  handlePlay(inst.id);
                }}
                onCreateInstanceClick={() => {
                  setInstanceEditor({ mode: 'create', instance: null });
                }}
                onMigrateClick={() => {
                  setMigrateModalOpen(true);
                }}
                onEditInstanceClick={(inst) => {
                  setInstanceEditor({ mode: 'edit', instance: inst });
                }}
                onDeleteInstanceClick={(inst) => {
                  setConfirmDialog({
                    title: t('instances.delete'),
                    message: t('instances.deleteConfirm', { name: inst.name }),
                    confirmText: t('common.delete') || 'Delete',
                    danger: true,
                    onConfirm: async () => {
                      setConfirmDialog(null);
                      await launcher.deleteInstance(inst.id);
                      const updated = await launcher.getInstances();
                      setInstances(updated);
                      if (activeInstanceId === inst.id) {
                        const fallbackId = updated[0]?.id || null;
                        setActiveInstanceId(fallbackId);
                        persistState({ activeInstanceId: fallbackId });
                      }
                      pushToast({
                        tone: 'info',
                        title: t('instances.deletedTitle'),
                        message: t('instances.deletedMessage', { name: inst.name }),
                      });
                    },
                  });
                }}
                onOpenFolderClick={(id) => {
                  launcher.minecraftOpenContentFolder('instance', id);
                }}
                runningInstanceId={gameState === 'running' ? activeInstanceId : null}
              />

              <NewsTab
                active={activeTab === 'news'}
                isOnline={isOnline}
                newsItems={newsItems}
                newsLoading={newsLoading}
                newsError={newsError}
                loadNews={loadNews}
                handleOpenNewsSource={handleOpenNewsSource}
                handleOpenNewsArticle={handleOpenNewsArticle}
              />

              <ExploreTab
                active={activeTab === 'explore'}
                isOnline={isOnline}
                exploreType={exploreType}
                setExploreType={setExploreType}
                showBetaInfo={showBetaInfo}
                setShowBetaInfo={setShowBetaInfo}
                betaInfoRef={betaInfoRef}
                modrinthQuery={modrinthQuery}
                setModrinthQuery={setModrinthQuery}
                modrinthSort={modrinthSort}
                setModrinthSort={setModrinthSort}
                modrinthLoaderFilter={modrinthLoaderFilter}
                setModrinthLoaderFilter={setModrinthLoaderFilter}
                currentLoader={currentLoader}
                modrinthVersionFilter={modrinthVersionFilter}
                setModrinthVersionFilter={setModrinthVersionFilter}
                currentMcVer={currentMcVer}
                modrinthCategory={modrinthCategory}
                setModrinthCategory={setModrinthCategory}
                modrinthLoading={modrinthLoading}
                modrinthResults={modrinthResults}
                isModInstalled={isModInstalled}
                modrinthInstalling={modrinthInstalling}
                handleInstallModrinthMod={handleInstallModrinthMod}
                handleOpenModDetails={handleOpenModDetails}
                modrinthSentinelRef={modrinthSentinelRef}
                modrinthLoadingMore={modrinthLoadingMore}
              />


              <ModsTab
                active={activeTab === 'mods'}
                isDragging={isDragging}
                handleDragOver={handleDragOver}
                handleDragLeave={handleDragLeave}
                handleDrop={handleDrop}
                modSearch={modSearch}
                setModSearch={setModSearch}
                mods={mods}
                handleSetAllModsEnabled={handleSetAllModsEnabled}
                handleCheckModUpdates={handleCheckModUpdates}
                checkingModUpdates={checkingModUpdates}
                handleOpenContentFolder={handleOpenContentFolder}
                handleAddContentClick={handleAddContentClick}
                setExploreType={setExploreType}
                setActiveTab={setActiveTab}
                modUpdates={modUpdates}
                updatingMods={updatingMods}
                handleModToggle={handleModToggle}
                handleModDelete={handleModDelete}
                handleUpdateMod={handleUpdateMod}
                handleUpdateAllMods={handleUpdateAllMods}
                handleOpenLocalModDetails={handleOpenLocalModDetails}
              />

              <ShadersTab
                active={activeTab === 'shaders'}
                isDragging={isDragging}
                handleDragOver={handleDragOver}
                handleDragLeave={handleDragLeave}
                handleDrop={handleDrop}
                shaderSearch={shaderSearch}
                setShaderSearch={setShaderSearch}
                shaders={shaders}
                handleOpenContentFolder={handleOpenContentFolder}
                handleAddContentClick={handleAddContentClick}
                setExploreType={setExploreType}
                setActiveTab={setActiveTab}
                handleOpenLocalShaderDetails={handleOpenLocalShaderDetails}
                handleDeleteShader={handleDeleteShader}
              />

              <ResourcePacksTab
                active={activeTab === 'resourcepacks'}
                isDragging={isDragging}
                handleDragOver={handleDragOver}
                handleDragLeave={handleDragLeave}
                handleDrop={handleDrop}
                resourcePackSearch={resourcePackSearch}
                setResourcePackSearch={setResourcePackSearch}
                resourcePacks={resourcePacks}
                handleOpenContentFolder={handleOpenContentFolder}
                handleAddContentClick={handleAddContentClick}
                setExploreType={setExploreType}
                setActiveTab={setActiveTab}
                handleOpenLocalResourcePackDetails={handleOpenLocalResourcePackDetails}
                handleDeleteResourcePack={handleDeleteResourcePack}
              />

              <DatapacksTab
                active={activeTab === 'datapacks'}
                isDragging={isDragging}
                handleDragOver={handleDragOver}
                handleDragLeave={handleDragLeave}
                handleDrop={handleDrop}
                datapackSearch={datapackSearch}
                setDatapackSearch={setDatapackSearch}
                datapacks={datapacks}
                handleOpenContentFolder={handleOpenContentFolder}
                handleAddContentClick={handleAddContentClick}
                setExploreType={setExploreType}
                setActiveTab={setActiveTab}
                handleOpenLocalDatapackDetails={handleOpenLocalDatapackDetails}
                handleDeleteDatapack={handleDeleteDatapack}
              />

              <ConsoleTab
                active={activeTab === 'console'}
                gameState={gameState}
                runPid={runPid}
                logFilter={logFilter}
                setLogFilter={setLogFilter}
                autoScroll={autoScroll}
                setAutoScroll={setAutoScroll}
                handleCopyConsole={handleCopyConsole}
                handleClearConsole={handleClearConsole}
                consoleRef={consoleRef}
                logs={logs}
              />
            </>
          )}

          {/* ── THE PLAY DECK (BOTTOM DOCK) ── */}
          <div className="play-deck">
            <div className="play-deck-controls">
              {/* Version capsule */}
              <div className="version-capsule">
                <select
                  className="version-select"
                  value={selectedInstalledVersionId}
                  onChange={e => handleEnvironmentVersionChange(e.target.value)}
                  disabled={gameState === 'running'}
                >
                  {activeInstance && !activeInstanceVersion && (
                    <option value="">Select an installed version for this instance</option>
                  )}
                  {installedVersions.length > 0 ? (
                    installedVersions.map(v => (
                      <option key={v.id} value={v.id}>{formatVersionLabel(v)}</option>
                    ))
                  ) : (
                    <option value="">{t('profile.noVersionsInstalled')}</option>
                  )}
                </select>
                <span className={`loader-badge ${loaderBadgeClass}`}>
                  {loaderBadgeLabel}
                </span>
              </div>
            </div>

            {/* Play Button Action */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {installId && (
                <button className="btn-secondary" onClick={handleCancelInstall}>
                  {t('game.cancelInstall')}
                </button>
              )}
              <button
                className={`hero-play-btn ${gameState === 'loading' || authRefreshing ? 'loading' : gameState === 'running' ? 'running' : ''}`}
                onClick={() => {
                  if (installedVersions.length === 0 && !activeProfile?.version) {
                    setModal('install');
                    return;
                  }
                  handlePlay();
                }}
                disabled={gameState === 'loading' || authRefreshing}
              >
                {gameState === 'loading' || authRefreshing ? (
                  <>
                    <span className="spinning"><Icon d={ICONS.spinner} size={16} /></span>
                    <span>{authRefreshing ? t('game.authenticating') : t('game.loading')}</span>
                  </>
                ) : gameState === 'running' ? (
                  <>
                    <Icon d={ICONS.stop} size={16} />
                    <span>{t('game.stop')}</span>
                  </>
                ) : (
                  <>
                    <Icon d={ICONS.play} size={16} />
                    <span>{t('game.play')}</span>
                  </>
                )}
                {gameState === 'loading' && (
                  <div className="progress-capsule">
                    <div className="progress-capsule-fill" style={{ width: `${progress}%` }} />
                  </div>
                )}
              </button>
            </div>
          </div>
        </main>
      </div>

      {/* ── MODALS ── */}
      {instanceEditor && (
        <InstanceModal
          mode={instanceEditor.mode}
          instance={instanceEditor.instance}
          availableVersions={installedVersions.filter(v => settings.showUnsupportedVersions || isBlazzySupportedVersion(v) || v.id === instanceEditor.instance?.version)}
          showUnsupportedVersions={settings.showUnsupportedVersions}
          systemTotalRam={systemTotalRam}
          onClose={() => setInstanceEditor(null)}
          onSave={async (instanceData) => {
            if (instanceEditor.mode === 'create') {
              const res = await launcher.createInstance(instanceData);
              if (res?.ok && res?.instance) {
                const updated = await launcher.getInstances();
                setInstances(updated);
                setActiveInstanceId(res.instance.id);
                pushToast({
                  tone: 'success',
                  title: t('instances.createdTitle'),
                  message: t('instances.createdMessage', { name: instanceData.name }),
                });
              }
            } else {
              const res = await launcher.updateInstance(instanceData.id, instanceData);
              if (res?.ok) {
                const updated = await launcher.getInstances();
                setInstances(updated);
                pushToast({
                  tone: 'success',
                  title: t('instances.savedTitle'),
                  message: t('instances.savedMessage'),
                });
              }
            }
          }}
        />
      )}
      {migrateModalOpen && (
        <MigrateInstanceModal
          availableVersions={installedVersions}
          systemTotalRam={systemTotalRam}
          onClose={() => setMigrateModalOpen(false)}
          onMigrate={async (migrateData) => {
            const res = await launcher.migrateBaseToInstance(migrateData);
            if (res?.ok && res?.instance) {
              const updated = await launcher.getInstances();
              setInstances(updated);
              setActiveInstanceId(res.instance.id);
              pushToast({
                tone: 'success',
                title: t('migration.successTitle'),
                message: t(res.mode === 'converted' ? 'migration.convertedMessage' : 'migration.copiedMessage', { name: res.instance.name }),
              });
            } else {
              pushToast({
                tone: 'critical',
                title: t('common.error') || 'Error',
                message: res?.message || 'Migration failed',
              });
            }
          }}
        />
      )}
      {accountModalOpen && (
        <AccountModal
          currentAccount={account}
          loginLoading={loginLoading}
          onClose={() => setAccountModalOpen(false)}
          onSaveOfflineName={(newName) => {
            if (!activeProfile) return;
            setProfiles(prev => {
              const next = prev.map(p => p.id === activeProfile.id ? { ...p, localName: newName, name: newName } : p);
              persistState({ profiles: next, activeProfileId: activeProfile.id });
              return next;
            });
            setAccount(prev => ({
              ...prev,
              name: newName,
              loggedIn: true,
              kind: 'local',
              session: createOfflineSession(newName),
            }));
            pushToast({
              tone: 'success',
              title: t('accountModal.accountUpdatedTitle'),
              message: t('accountModal.accountUpdatedMessage', { name: newName }),
            });
          }}
          onLoginMicrosoft={() => {
            setAccountModalOpen(false);
            handleLogin();
          }}
          onLogout={() => {
            setAccountModalOpen(false);
            handleLogout();
          }}
        />
      )}
      {cosmeticsModalOpen && (
        <CosmeticsModal
          account={account}
          profileKey={String(account.profileKey || activeProfile?.id || 'default')}
          onClose={() => setCosmeticsModalOpen(false)}
          onLogin={() => {
            setCosmeticsModalOpen(false);
            handleLogin();
          }}
          pushToast={pushToast}
        />
      )}
      {screenshotsModalOpen && <ScreenshotsModal instanceId={activeInstanceId} onClose={() => setScreenshotsModalOpen(false)} />}
      {profileEditor && (
        <ProfileModal
          mode={profileEditor.mode}
          profile={profileToEdit}
          versions={installedVersions}
          systemTotalRam={systemTotalRam}
          onClose={() => setProfileEditor(null)}
          onSave={handleSaveProfile}
        />
      )}
      {modal === 'install' && (
        <InstallModal
          initialType="minecraft"
          installTargets={installTargets}
          showSnapshots={settings.showSnapshots}
          showUnsupportedVersions={settings.showUnsupportedVersions}
          onToggleSnapshots={(val) => handleSettingChange('showSnapshots', val)}
          onClose={() => setModal(null)}
          onInstall={handleInstall}
          onCatalogLoaded={(catalog) => {
            if (catalog?.versions) setVersionCatalog(catalog.versions);
            if (catalog?.installTargets) setInstallTargets(catalog.installTargets);
          }}
        />
      )}
      {modal === 'settings' && (
        <SettingsModal
          settings={settings}
          onChange={handleSettingChange}
          onClose={() => setModal(null)}
          onCheckUpdates={handleCheckForUpdates}
          onOpenAbout={() => setModal('about')}
          onOpenMinecraftDirectory={handleOpenMinecraftDirectory}
          onOpenSourceCode={handleOpenSourceCode}
          onOpenReleases={handleOpenReleases}
          language={language}
          onLanguageChange={setLanguage}
          appVersion={appVersion}
        />
      )}
      {modal === 'about' && (
        <AboutModal
          appVersion={appVersion}
          language={language}
          onClose={() => setModal(null)}
          onOpenSourceCode={handleOpenSourceCode}
          onOpenReleases={handleOpenReleases}
          onCheckUpdates={handleCheckForUpdates}
        />
      )}
      {modConflict && (
        <ModConflictModal
          conflict={modConflict}
          mods={mods}
          onClose={() => setModConflict(null)}
          onResolveUpdate={handleResolveConflictUpdate}
          onAutoFixAll={handleAutoFixAllConflicts}
          fixingAll={fixingAllConflicts}
          onOpenModsFolder={handleOpenMinecraftDirectory}
        />
      )}
      {loginLoading && (
        <LoginLoadingModal
          onCancel={() => {
            if (loginAbortControllerRef.current) {
              loginAbortControllerRef.current.abort();
            }
            launcher.minecraftCancelLogin?.().catch(() => { });
            setLoginLoading(false);
            addLog('info', 'Login cancelled by user');
          }}
        />
      )}
      {updateModalInfo && (
        <UpdateModal
          updateInfo={updateModalInfo}
          onClose={() => setUpdateModalInfo(null)}
          onInstall={handleApplyUpdate}
        />
      )}
      {confirmDialog && (
        <ConfirmModal
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          cancelText={confirmDialog.cancelText}
          danger={confirmDialog.danger}
          onConfirm={confirmDialog.onConfirm}
          onClose={() => {
            confirmDialog.onCancel?.();
            setConfirmDialog(null);
          }}
        />
      )}
    </>
  );
}

// Microsoft official 4-color square logo SVG
