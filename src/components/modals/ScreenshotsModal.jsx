import { useCallback, useEffect, useState } from 'react';
import { launcher } from '../../services/launcherClient';
import { ICONS } from '../../constants/icons';
import { Icon } from '../common/CommonComponents';

export function ScreenshotsModal({ instanceId, onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const result = await launcher.minecraftGetScreenshots(instanceId);
    setItems(Array.isArray(result?.items) ? result.items : []);
    setLoading(false);
  }, [instanceId]);
  useEffect(() => { load(); }, [load]);

  return <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
    <div className="modal" style={{ maxWidth: 820 }}>
      <div className="modal-title">Screenshots</div>
      <div className="modal-subtitle">F2 screenshots from the selected instance.</div>
      <div className="cosmetics-actions" style={{ marginBottom: 14 }}>
        <button className="btn btn-secondary" onClick={load}><Icon d={ICONS.refresh} size={14} /> Refresh</button>
        <button className="btn btn-secondary" onClick={() => launcher.minecraftOpenScreenshots(instanceId)}><Icon d={ICONS.folder} size={14} /> Open folder</button>
      </div>
      {loading ? <div className="cosmetics-loading">Loading screenshots…</div> : items.length ? (
        <div className="screenshot-grid">{items.map(item => <button key={item.path} className="screenshot-card" onClick={() => launcher.minecraftOpenScreenshot(item.path)}>
          <img src={item.dataUrl} alt={item.name} />
          <span>{item.name}</span><small>Open</small>
        </button>)}</div>
      ) : <div className="cosmetics-empty">No screenshots yet. Press F2 in Minecraft, then refresh.</div>}
      <div className="modal-actions"><button className="btn btn-secondary" onClick={onClose}>Close</button></div>
    </div>
  </div>;
}
