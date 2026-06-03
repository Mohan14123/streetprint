/**
 * src/app/components/PrivacySettingsView.tsx
 * Privacy & Data settings modal — route visibility default toggle,
 * data export (real API), and account deletion (real API).
 * Theme-aware: uses CSS custom properties.
 */
import { useState } from 'react';
import { motion } from 'motion/react';
import { X, Shield, Eye, EyeOff, Download, Trash2, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { userApi } from '../../api/user.api';

interface PrivacySettingsProps {
  onClose: () => void;
  onLogout: () => Promise<void>;
}

export function PrivacySettingsView({ onClose, onLogout }: PrivacySettingsProps) {
  const [defaultPublic, setDefaultPublic] = useState(() => {
    return localStorage.getItem('streetprint:defaultRoutePublic') !== 'false';
  });
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState(false);
  const [exportError, setExportError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const handleToggleDefault = () => {
    const newVal = !defaultPublic;
    setDefaultPublic(newVal);
    localStorage.setItem('streetprint:defaultRoutePublic', String(newVal));
  };

  const handleExportData = async () => {
    setExporting(true);
    setExportError('');
    try {
      const resp = await userApi.exportData();
      const data = (resp.data as { data: unknown }).data;

      // Create a downloadable JSON file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `streetprint-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportDone(true);
      setTimeout(() => setExportDone(false), 4000);
    } catch {
      setExportError('Failed to export data. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      await userApi.deleteAccount();
      // Account deleted — log the user out and close modal
      onClose();
      await onLogout();
    } catch {
      setDeleteError('Failed to delete account. Please try again.');
      setDeleting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center backdrop-blur-sm"
      style={{ background: 'rgba(0, 0, 0, 0.4)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="w-full max-w-md rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl"
        style={{ background: 'var(--sp-bg-card)', border: '1px solid var(--sp-border-strong)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--sp-accent-glow)', border: '1px solid var(--sp-border-strong)' }}>
              <Shield className="w-5 h-5" style={{ color: 'var(--sp-accent-text)' }} />
            </div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--sp-text-primary)' }}>Privacy & Data</h2>
          </div>
          <button onClick={onClose} className="transition-colors" style={{ color: 'var(--sp-text-muted)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Route Visibility Default */}
          <div className="rounded-xl p-4" style={{ background: 'var(--sp-bg-input)', border: '1px solid var(--sp-border)' }}>
            <div className="flex items-center justify-between">
              <div className="flex-1 mr-4">
                <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--sp-text-primary)' }}>Default Route Visibility</h3>
                <p className="text-xs" style={{ color: 'var(--sp-text-muted)' }}>
                  New routes will be {defaultPublic ? 'visible to the community' : 'private by default'}
                </p>
              </div>
              <button
                onClick={handleToggleDefault}
                className={`relative w-12 h-7 rounded-full transition-colors duration-200`}
                style={{ background: defaultPublic ? 'var(--sp-accent)' : 'var(--sp-bg-skeleton)' }}
              >
                <motion.div
                  layout
                  className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-md"
                  style={{ left: defaultPublic ? 'calc(100% - 24px)' : '4px' }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
                <span className="sr-only">{defaultPublic ? 'Public' : 'Private'}</span>
              </button>
            </div>
            <div className="flex items-center gap-2 mt-3 text-xs" style={{ color: 'var(--sp-text-secondary)' }}>
              {defaultPublic ? (
                <><Eye className="w-3.5 h-3.5" style={{ color: 'var(--sp-accent-text)' }} /> Routes visible in community heatmap</>
              ) : (
                <><EyeOff className="w-3.5 h-3.5" style={{ color: 'var(--sp-text-muted)' }} /> Only you can see your routes</>
              )}
            </div>
          </div>

          {/* Export Data */}
          <div className="rounded-xl p-4" style={{ background: 'var(--sp-bg-input)', border: '1px solid var(--sp-border)' }}>
            <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--sp-text-primary)' }}>Export Your Data</h3>
            <p className="text-xs mb-3" style={{ color: 'var(--sp-text-muted)' }}>
              Download all your routes, places, and profile data as a JSON file.
            </p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => void handleExportData()}
              disabled={exporting}
              className="w-full h-10 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: 'var(--sp-bg-input)', border: '1px solid var(--sp-border-strong)', color: 'var(--sp-text-secondary)' }}
            >
              {exporting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Preparing export...</>
              ) : exportDone ? (
                <><CheckCircle className="w-4 h-4" style={{ color: 'var(--sp-status-success-text)' }} /> Download started!</>
              ) : (
                <><Download className="w-4 h-4" /> Export Data</>
              )}
            </motion.button>
            {exportError && (
              <p className="text-xs mt-2 flex items-center gap-1" style={{ color: 'var(--sp-status-danger-text)' }}>
                <AlertTriangle className="w-3 h-3" /> {exportError}
              </p>
            )}
          </div>

          {/* Delete Account */}
          <div className="rounded-xl p-4" style={{ background: 'var(--sp-status-danger-bg)', border: '1px solid var(--sp-status-danger-text)' }}>
            <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--sp-status-danger-text)' }}>Delete Account</h3>
            <p className="text-xs mb-3" style={{ color: 'var(--sp-text-muted)' }}>
              Permanently delete your account and all associated data. This cannot be undone.
            </p>
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full h-10 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
                style={{ background: 'var(--sp-status-danger-bg)', border: '1px solid var(--sp-status-danger-text)', color: 'var(--sp-status-danger-text)' }}
              >
                <Trash2 className="w-4 h-4" /> Delete Account
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-medium" style={{ color: 'var(--sp-status-danger-text)' }}>Are you sure? This is permanent.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowDeleteConfirm(false); setDeleteError(''); }}
                    disabled={deleting}
                    className="flex-1 h-9 rounded-lg text-xs transition-colors disabled:opacity-50"
                    style={{ background: 'var(--sp-bg-input)', border: '1px solid var(--sp-border-strong)', color: 'var(--sp-text-muted)' }}
                  >
                    Cancel
                  </button>
                  <button
                    disabled={deleting}
                    className="flex-1 h-9 rounded-lg text-xs transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                    style={{ background: 'var(--sp-status-danger-bg)', border: '1px solid var(--sp-status-danger-text)', color: 'var(--sp-status-danger-text)' }}
                    onClick={() => void handleDeleteAccount()}
                  >
                    {deleting ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Deleting...</>
                    ) : (
                      'Yes, Delete'
                    )}
                  </button>
                </div>
                {deleteError && (
                  <p className="text-xs flex items-center gap-1" style={{ color: 'var(--sp-status-danger-text)' }}>
                    <AlertTriangle className="w-3 h-3" /> {deleteError}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
