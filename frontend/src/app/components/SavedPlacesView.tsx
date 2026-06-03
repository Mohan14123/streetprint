/**
 * src/app/components/SavedPlacesView.tsx
 * Discover tab — saved places with real API data, category filter,
 * search, mark-visited toggle, and add-place dialog.
 *
 * Rules enforced:
 *   yet_to_finish §4: Wire placesApi.list() replacing hardcoded data
 *   RULES.md §5.1: GeoJSON [lng, lat] order preserved
 *   RULES.md §6.1: API response envelope { success, data, error, meta }
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, MapPin, Filter, MoreVertical, Plus, Check, Loader2, X, MapPinOff, Trash2, Pencil, ExternalLink, Share2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { placesApi } from '../../api/places.api';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Place {
  _id: string;
  label: string;
  notes?: string;
  location: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  visited: boolean;
  createdAt: string;
}

type CategoryFilter = 'All' | 'Visited' | 'Unvisited';

const CATEGORIES: CategoryFilter[] = ['All', 'Visited', 'Unvisited'];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function SavedPlacesView() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingPlace, setEditingPlace] = useState<Place | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Fetch places from API ─────────────────────────────────────────────────
  const fetchPlaces = useCallback(async () => {
    try {
      setError(null);
      const resp = await placesApi.list();
      const data = resp.data as { data: { places: Place[] } };
      setPlaces(data.data.places ?? []);
    } catch {
      setError('Failed to load places');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPlaces();
  }, [fetchPlaces]);

  // ── Filter places ─────────────────────────────────────────────────────────
  const filteredPlaces = useMemo(() => {
    let result = places;

    // Category filter
    if (activeCategory === 'Visited') {
      result = result.filter(p => p.visited);
    } else if (activeCategory === 'Unvisited') {
      result = result.filter(p => !p.visited);
    }

    // Search filter (case-insensitive label + notes match)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        p => p.label.toLowerCase().includes(q) || (p.notes?.toLowerCase().includes(q) ?? false),
      );
    }

    return result;
  }, [places, activeCategory, searchQuery]);

  // ── Mark visited toggle ───────────────────────────────────────────────────
  const handleToggleVisited = useCallback(async (placeId: string) => {
    setTogglingId(placeId);
    try {
      await placesApi.markVisited(placeId);
      setPlaces(prev =>
        prev.map(p => (p._id === placeId ? { ...p, visited: true } : p)),
      );
    } catch {
      // non-fatal
    } finally {
      setTogglingId(null);
    }
  }, []);

  // ── Add place handler ─────────────────────────────────────────────────────
  const handleAddPlace = useCallback(async (label: string, lat: number, lng: number, notes?: string) => {
    try {
      await placesApi.save({ label, lat, lng, notes });
      setShowAddForm(false);
      await fetchPlaces();
    } catch {
      // non-fatal — form stays open
    }
  }, [fetchPlaces]);

  // ── Edit place handler ────────────────────────────────────────────────────
  const handleEditPlace = useCallback(async (label: string, lat: number, lng: number, notes?: string) => {
    if (!editingPlace) return;
    try {
      await placesApi.update(editingPlace._id, { label, lat, lng, notes });
      setEditingPlace(null);
      await fetchPlaces();
    } catch {
      // non-fatal
    }
  }, [editingPlace, fetchPlaces]);

  // ── Delete place handler ──────────────────────────────────────────────────
  const handleDeletePlace = useCallback(async (placeId: string) => {
    setDeletingId(placeId);
    try {
      await placesApi.delete(placeId);
      setPlaces(prev => prev.filter(p => p._id !== placeId));
    } catch {
      // non-fatal
    } finally {
      setDeletingId(null);
    }
  }, []);

  // ── Share handler ─────────────────────────────────────────────────────────
  const handleShare = useCallback(async (place: Place) => {
    const lat = place.location.coordinates[1];
    const lng = place.location.coordinates[0];
    const text = `${place.label} — ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    if (navigator.share) {
      try { await navigator.share({ title: place.label, text }); } catch { /* cancelled */ }
    } else {
      await navigator.clipboard.writeText(text);
    }
    setMenuOpenId(null);
  }, []);

  // ── Open in Maps ──────────────────────────────────────────────────────────
  const handleOpenInMaps = useCallback((place: Place) => {
    const lat = place.location.coordinates[1];
    const lng = place.location.coordinates[0];
    window.open(`https://maps.google.com/?q=${lat},${lng}`, '_blank');
    setMenuOpenId(null);
  }, []);

  // ── Date formatter ────────────────────────────────────────────────────────
  const formatDate = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="w-full h-full flex flex-col font-sans pb-20 overflow-hidden" style={{ background: 'var(--sp-bg-primary)', color: 'var(--sp-text-primary)' }}>
      {/* Header */}
      <div className="pt-12 pb-4 px-6 border-b shrink-0 z-10" style={{ background: 'var(--sp-bg-primary)', borderColor: 'var(--sp-border)' }}>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--sp-text-primary)' }}>Saved Places</h1>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowAddForm(true)}
            className="w-9 h-9 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 hover:bg-cyan-500/30 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </motion.button>
        </div>

        <div className="flex gap-3">
          <div className="flex-1 h-10 bg-[var(--sp-bg-input)] border border-[var(--sp-border-strong)] rounded-xl flex items-center px-3">
            <Search className="w-4 h-4 text-[var(--sp-text-secondary)]" />
            <input 
              type="text" 
              placeholder="Search saved..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none outline-none text-sm text-[var(--sp-text-primary)] ml-2 w-full placeholder:text-[var(--sp-text-muted)]"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-[var(--sp-text-muted)] hover:text-[var(--sp-text-primary)]">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button className="h-10 w-10 bg-[var(--sp-bg-input)] border border-[var(--sp-border-strong)] rounded-xl flex items-center justify-center text-[var(--sp-text-secondary)] hover:text-[var(--sp-text-primary)] transition-colors">
            <Filter className="w-4 h-4" />
          </button>
        </div>

        {/* Categories */}
        <div className="flex gap-2 mt-4 overflow-x-auto custom-scrollbar pb-1 -mx-2 px-2">
          {CATEGORIES.map((cat) => (
            <button 
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                activeCategory === cat 
                  ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' 
                  : 'bg-transparent text-[var(--sp-text-secondary)] border-[var(--sp-border-strong)] hover:bg-[var(--sp-bg-input)] hover:text-[var(--sp-text-primary)]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4 max-w-4xl mx-auto w-full">
        {/* Loading state */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
            <p className="text-sm text-[var(--sp-text-muted)]">Loading places...</p>
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
              <MapPinOff className="w-6 h-6 text-red-400" />
            </div>
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={() => { setLoading(true); void fetchPlaces(); }}
              className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && filteredPlaces.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-[var(--sp-bg-input)] border border-[var(--sp-border-strong)] flex items-center justify-center">
              <MapPin className="w-8 h-8 text-[var(--sp-text-faint)]" />
            </div>
            <div className="text-center">
              <p className="text-[var(--sp-text-primary)] font-medium mb-1">
                {searchQuery ? 'No matching places' : 'No places saved yet'}
              </p>
              <p className="text-sm text-[var(--sp-text-muted)]">
                {searchQuery
                  ? 'Try a different search term'
                  : 'Tap the + button to bookmark places you want to visit'}
              </p>
            </div>
            {!searchQuery && (
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setShowAddForm(true)}
                className="mt-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 text-[var(--sp-text-primary)] text-sm font-medium shadow-[0_0_20px_rgba(34,211,238,0.3)]"
              >
                Save your first place
              </motion.button>
            )}
          </div>
        )}

        {/* Place cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {!loading && !error && filteredPlaces.map((place, idx) => (
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.04 }}
            key={place._id} 
            className="bg-[var(--sp-bg-card)] border border-[var(--sp-border)] rounded-xl p-2.5 shadow-lg group"
          >
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div className="w-8 h-8 rounded-lg bg-[var(--sp-accent-glow)] border border-[var(--sp-accent-glow)] flex items-center justify-center shrink-0 mt-0.5">
                <MapPin className="w-4 h-4 text-cyan-400" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <h3 className="text-sm font-semibold text-[var(--sp-text-primary)] truncate">{place.label}</h3>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {!place.visited && (
                      <button
                        onClick={() => void handleToggleVisited(place._id)}
                        disabled={togglingId === place._id}
                        className="w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                        title="Mark as visited"
                      >
                        {togglingId === place._id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Check className="w-3 h-3" />
                        )}
                      </button>
                    )}
                    <div className="relative">
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === place._id ? null : place._id); }}
                        className="text-[var(--sp-text-muted)] hover:text-[var(--sp-text-primary)] transition-colors p-0.5"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {/* Context Menu Popover */}
                      {menuOpenId === place._id && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setMenuOpenId(null)} />
                          <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: -4 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="absolute right-0 top-7 z-50 w-44 bg-[var(--sp-bg-elevated)] border border-[var(--sp-border-strong)] rounded-xl shadow-2xl overflow-hidden"
                          >
                            <button
                              onClick={() => { setEditingPlace(place); setMenuOpenId(null); }}
                              className="w-full flex items-center gap-3 px-3 py-2.5 text-xs text-[var(--sp-text-primary)] hover:bg-[var(--sp-bg-input)] transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5 text-[var(--sp-text-secondary)]" /> Edit
                            </button>
                            <button
                              onClick={() => { void handleDeletePlace(place._id); setMenuOpenId(null); }}
                              disabled={deletingId === place._id}
                              className="w-full flex items-center gap-3 px-3 py-2.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                            >
                              {deletingId === place._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Delete
                            </button>
                            <div className="h-px bg-[var(--sp-bg-input)]" />
                            <button
                              onClick={() => void handleShare(place)}
                              className="w-full flex items-center gap-3 px-3 py-2.5 text-xs text-[var(--sp-text-primary)] hover:bg-[var(--sp-bg-input)] transition-colors"
                            >
                              <Share2 className="w-3.5 h-3.5 text-[var(--sp-text-secondary)]" /> Share
                            </button>
                            <button
                              onClick={() => handleOpenInMaps(place)}
                              className="w-full flex items-center gap-3 px-3 py-2.5 text-xs text-[var(--sp-text-primary)] hover:bg-[var(--sp-bg-input)] transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5 text-[var(--sp-text-secondary)]" /> Open in Maps
                            </button>
                          </motion.div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                  <span className="text-[10px] text-[var(--sp-text-faint)] font-mono">
                    {place.location.coordinates[1].toFixed(4)}, {place.location.coordinates[0].toFixed(4)}
                  </span>
                  <span className="text-[10px] text-[var(--sp-text-faint)]">•</span>
                  <span className="text-[10px] text-[var(--sp-text-muted)]">{formatDate(place.createdAt)}</span>
                  <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium ${
                    place.visited
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  }`}>
                    {place.visited ? 'Visited' : 'Want to visit'}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
        </div>
      </div>

      {/* Add Place Modal */}
      <AnimatePresence>
        {showAddForm && (
          <AddPlaceModal
            onClose={() => setShowAddForm(false)}
            onSave={handleAddPlace}
          />
        )}
      </AnimatePresence>

      {/* Edit Place Modal */}
      <AnimatePresence>
        {editingPlace && (
          <AddPlaceModal
            onClose={() => setEditingPlace(null)}
            onSave={handleEditPlace}
            initialData={{
              label: editingPlace.label,
              lat: editingPlace.location.coordinates[1].toString(),
              lng: editingPlace.location.coordinates[0].toString(),
              notes: editingPlace.notes ?? '',
            }}
            title="Edit Place"
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Place Modal
// ─────────────────────────────────────────────────────────────────────────────

function AddPlaceModal({
  onClose,
  onSave,
  initialData,
  title = 'Save a Place',
}: {
  onClose: () => void;
  onSave: (label: string, lat: number, lng: number, notes?: string) => Promise<void>;
  initialData?: { label: string; lat: string; lng: string; notes: string };
  title?: string;
}) {
  const [label, setLabel] = useState(initialData?.label ?? '');
  const [lat, setLat] = useState(initialData?.lat ?? '');
  const [lng, setLng] = useState(initialData?.lng ?? '');
  const [notes, setNotes] = useState(initialData?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);

    if (!label.trim()) { setError('Label is required'); return; }
    if (isNaN(latNum) || latNum < -90 || latNum > 90) { setError('Latitude must be between -90 and 90'); return; }
    if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) { setError('Longitude must be between -180 and 180'); return; }

    setSaving(true);
    try {
      await onSave(label.trim(), latNum, lngNum, notes.trim() || undefined);
    } catch {
      setError('Failed to save place');
    } finally {
      setSaving(false);
    }
  };

  // Try to prefill with current location (only for new places)
  useEffect(() => {
    if (initialData) return; // Skip GPS prefill when editing
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!lat && !lng) {
            setLat(pos.coords.latitude.toFixed(6));
            setLng(pos.coords.longitude.toFixed(6));
          }
        },
        () => { /* Ignore denial */ },
        { enableHighAccuracy: true, timeout: 5000 },
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[var(--sp-bg-overlay)] backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="w-full max-w-md bg-[var(--sp-bg-card)] border border-[var(--sp-border-strong)] rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-[var(--sp-text-primary)]">{title}</h2>
          <button onClick={onClose} className="text-[var(--sp-text-muted)] hover:text-[var(--sp-text-primary)] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--sp-text-secondary)] mb-1.5">Label *</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Favorite Coffee Shop"
              className="w-full h-10 px-3 bg-[var(--sp-bg-input)] border border-[var(--sp-border-strong)] rounded-xl text-sm text-[var(--sp-text-primary)] placeholder:text-[var(--sp-text-muted)] outline-none focus:border-cyan-500/50 transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--sp-text-secondary)] mb-1.5">Latitude *</label>
              <input
                type="text"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="12.9716"
                className="w-full h-10 px-3 bg-[var(--sp-bg-input)] border border-[var(--sp-border-strong)] rounded-xl text-sm text-[var(--sp-text-primary)] placeholder:text-[var(--sp-text-muted)] outline-none focus:border-cyan-500/50 transition-colors font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--sp-text-secondary)] mb-1.5">Longitude *</label>
              <input
                type="text"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="77.5946"
                className="w-full h-10 px-3 bg-[var(--sp-bg-input)] border border-[var(--sp-border-strong)] rounded-xl text-sm text-[var(--sp-text-primary)] placeholder:text-[var(--sp-text-muted)] outline-none focus:border-cyan-500/50 transition-colors font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--sp-text-secondary)] mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              rows={2}
              className="w-full px-3 py-2 bg-[var(--sp-bg-input)] border border-[var(--sp-border-strong)] rounded-xl text-sm text-[var(--sp-text-primary)] placeholder:text-[var(--sp-text-muted)] outline-none focus:border-cyan-500/50 transition-colors resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={saving}
            className="w-full h-11 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-[var(--sp-text-primary)] font-medium text-sm shadow-[0_0_20px_rgba(34,211,238,0.2)] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <MapPin className="w-4 h-4" />
                Save Place
              </>
            )}
          </motion.button>
        </form>
      </motion.div>
    </motion.div>
  );
}
