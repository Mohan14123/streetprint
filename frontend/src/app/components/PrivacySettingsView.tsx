/**
 * src/app/components/PrivacySettingsView.tsx
 * Privacy & Data settings modal — route visibility default toggle,
 * data export (real API), and account deletion (real API).
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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="w-full max-w-md bg-[#161B22] border border-white/10 rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <Shield className="w-5 h-5 text-cyan-400" />
            </div>
            <h2 className="text-lg font-bold text-white">Privacy & Data</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Route Visibility Default */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex-1 mr-4">
                <h3 className="text-sm font-medium text-white mb-1">Default Route Visibility</h3>
                <p className="text-xs text-slate-500">
                  New routes will be {defaultPublic ? 'visible to the community' : 'private by default'}
                </p>
              </div>
              <button
                onClick={handleToggleDefault}
                className={`relative w-12 h-7 rounded-full transition-colors duration-200 ${
                  defaultPublic ? 'bg-cyan-500' : 'bg-slate-700'
                }`}
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
            <div className="flex items-center gap-2 mt-3 text-xs text-slate-400">
              {defaultPublic ? (
                <><Eye className="w-3.5 h-3.5 text-cyan-400" /> Routes visible in community heatmap</>
              ) : (
                <><EyeOff className="w-3.5 h-3.5 text-slate-400" /> Only you can see your routes</>
              )}
            </div>
          </div>

          {/* Export Data */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <h3 className="text-sm font-medium text-white mb-1">Export Your Data</h3>
            <p className="text-xs text-slate-500 mb-3">
              Download all your routes, places, and profile data as a JSON file.
            </p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => void handleExportData()}
              disabled={exporting}
              className="w-full h-10 rounded-xl bg-white/5 border border-white/10 text-sm text-slate-300 font-medium hover:bg-white/10 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {exporting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Preparing export...</>
              ) : exportDone ? (
                <><CheckCircle className="w-4 h-4 text-emerald-400" /> Download started!</>
              ) : (
                <><Download className="w-4 h-4" /> Export Data</>
              )}
            </motion.button>
            {exportError && (
              <p className="text-xs text-red-400 mt-2 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {exportError}
              </p>
            )}
          </div>

          {/* Delete Account */}
          <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-4">
            <h3 className="text-sm font-medium text-red-400 mb-1">Delete Account</h3>
            <p className="text-xs text-slate-500 mb-3">
              Permanently delete your account and all associated data. This cannot be undone.
            </p>
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full h-10 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 font-medium hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> Delete Account
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-red-400 font-medium">Are you sure? This is permanent.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowDeleteConfirm(false); setDeleteError(''); }}
                    disabled={deleting}
                    className="flex-1 h-9 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-400 hover:bg-white/10 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={deleting}
                    className="flex-1 h-9 rounded-lg bg-red-500/20 border border-red-500/30 text-xs text-red-400 hover:bg-red-500/30 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
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
                  <p className="text-xs text-red-400 flex items-center gap-1">
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
