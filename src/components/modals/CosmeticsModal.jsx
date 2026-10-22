import { useCallback, useEffect, useState } from 'react';
import { launcher } from '../../services/launcherClient';
import { ICONS } from '../../constants/icons';
import { Icon, MicrosoftLogo, RemoteImage } from '../common/CommonComponents';

export function CosmeticsModal({ account, profileKey, onClose, onLogin, pushToast }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const isMicrosoft = account?.loggedIn && account?.kind === 'microsoft';

  const loadCosmetics = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = isMicrosoft ? await launcher.minecraftGetCosmetics(profileKey) : await launcher.minecraftGetLocalCosmetics(profileKey);
      if (result?.error) throw new Error(result.message || result.error);
      setProfile(result);
    } catch (err) {
      setError(err?.message || 'Could not load your Minecraft profile.');
    } finally {
      setLoading(false);
    }
  }, [isMicrosoft, profileKey]);

  const uploadLocalSkin = async (variant) => {
    setAction(`local-${variant}`); setError('');
    try {
      const result = await launcher.minecraftUpdateLocalSkin({ profileKey, variant });
      if (result?.canceled) return;
      if (result?.error) throw new Error(result.message || result.error);
      setProfile(result);
      pushToast?.({ tone: 'success', title: 'Local skin saved', message: 'Synced to Blazzy Client game folders for this player.' });
    } catch (err) { setError(err?.message || 'Local skin update failed.'); }
    finally { setAction(''); }
  };

  useEffect(() => { loadCosmetics(); }, [loadCosmetics]);

  const uploadSkin = async (variant) => {
    setAction(`skin-${variant}`);
    setError('');
    try {
      const result = await launcher.minecraftUpdateSkin({ profileKey, variant });
      if (result?.canceled) return;
      if (result?.error) throw new Error(result.message || result.error);
      setProfile(result);
      pushToast?.({ tone: 'success', title: 'Skin updated', message: 'Your official Minecraft skin is now active.' });
    } catch (err) {
      setError(err?.message || 'Skin update failed.');
    } finally {
      setAction('');
    }
  };

  const selectCape = async (capeId = '') => {
    setAction(`cape-${capeId || 'none'}`);
    setError('');
    try {
      const result = await launcher.minecraftSetCape({ profileKey, capeId });
      if (result?.error) throw new Error(result.message || result.error);
      setProfile(result);
      pushToast?.({ tone: 'success', title: 'Cape updated', message: capeId ? 'Your official cape is now active.' : 'Your cape is now hidden.' });
    } catch (err) {
      setError(err?.message || 'Cape update failed.');
    } finally {
      setAction('');
    }
  };

  const activeSkin = profile?.skins?.find(skin => skin.state === 'ACTIVE') || profile?.skins?.[0];
  const activeCape = profile?.capes?.find(cape => cape.state === 'ACTIVE');

  return (
    <div className="modal-backdrop" onClick={event => event.target === event.currentTarget && onClose()}>
      <div className="modal cosmetics-modal" style={{ maxWidth: 620 }}>
        <div className="modal-title">Skins & Cosmetics</div>
        <div className="modal-subtitle">Manage official cosmetics or a local skin for offline/cracked play.</div>

        {!isMicrosoft ? (
          <div className="cosmetics-login-state">
            {error && <div className="cosmetics-error">{error}</div>}
            {profile?.skinDataUrl && <img className="cosmetics-skin-preview" src={profile.skinDataUrl} alt="Local Blazzy skin" />}
            <strong>Offline / cracked cosmetics</strong>
            <p>Your local skin syncs between the launcher and Blazzy HUD. It is visible to you; other players need compatible server/mod support.</p>
            <div className="cosmetics-actions">
              <button className="btn btn-primary" onClick={() => uploadLocalSkin('classic')} disabled={Boolean(action)}>Upload classic skin</button>
              <button className="btn btn-secondary" onClick={() => uploadLocalSkin('slim')} disabled={Boolean(action)}>Upload slim skin</button>
              <button className="btn btn-secondary" onClick={onLogin}><MicrosoftLogo /> Microsoft login</button>
            </div>
          </div>
        ) : loading ? (
          <div className="cosmetics-loading"><span className="spinning"><Icon d={ICONS.spinner} size={20} /></span> Loading Minecraft cosmetics…</div>
        ) : (
          <>
            {error && <div className="cosmetics-error">{error}</div>}
            <div className="cosmetics-account-row">
              <RemoteImage className="cosmetics-skin-preview" src={activeSkin?.url} alt="Active Minecraft skin" />
              <div>
                <strong>{profile?.name || account?.name}</strong>
                <span>Official Minecraft profile</span>
              </div>
              <button className="btn btn-secondary" onClick={loadCosmetics} disabled={Boolean(action)}>
                <Icon d={ICONS.refresh} size={14} /> Refresh
              </button>
            </div>

            <section className="cosmetics-section">
              <h3>Player skin</h3>
              <p>Choose a standard 64×64 PNG skin. Select the arm style that matches your skin.</p>
              <div className="cosmetics-actions">
                <button className="btn btn-primary" onClick={() => uploadSkin('classic')} disabled={Boolean(action)}>
                  <Icon d={ICONS.upload || ICONS.download} size={14} /> {action === 'skin-classic' ? 'Uploading…' : 'Upload classic skin'}
                </button>
                <button className="btn btn-secondary" onClick={() => uploadSkin('slim')} disabled={Boolean(action)}>
                  {action === 'skin-slim' ? 'Uploading…' : 'Upload slim skin'}
                </button>
              </div>
            </section>

            <section className="cosmetics-section">
              <h3>Official capes</h3>
              <p>You can activate capes already owned by this Microsoft account.</p>
              {profile?.capes?.length ? (
                <div className="cape-grid">
                  {profile.capes.map(cape => {
                    const selected = cape.state === 'ACTIVE';
                    return (
                      <button
                        className={`cape-card ${selected ? 'active' : ''}`}
                        key={cape.id}
                        onClick={() => selectCape(cape.id)}
                        disabled={Boolean(action) || selected}
                      >
                        <RemoteImage src={cape.url} alt={cape.alias || 'Minecraft cape'} />
                        <span>{cape.alias || 'Official cape'}</span>
                        <small>{selected ? 'Active' : 'Select'}</small>
                      </button>
                    );
                  })}
                </div>
              ) : <div className="cosmetics-empty">This account has no official capes.</div>}
              {activeCape && (
                <button className="btn btn-secondary" onClick={() => selectCape('')} disabled={Boolean(action)} style={{ marginTop: 12 }}>
                  Hide active cape
                </button>
              )}
            </section>

            <div className="cosmetics-note">
              <Icon d={ICONS.info} size={15} />
              <span>Microsoft controls public skin and cape visibility. Offline accounts and custom launcher-only cosmetics cannot appear to unmodded players.</span>
            </div>
          </>
        )}

        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
