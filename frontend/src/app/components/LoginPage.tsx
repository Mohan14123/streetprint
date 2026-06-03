/**
 * src/app/components/LoginPage.tsx
 * Login screen — theme-aware, glassmorphic card, animated entry.
 * Routes to /register for new accounts.
 */
import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { MapPin, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';

interface LoginPageProps {
  onSwitchToRegister: () => void;
}

export function LoginPage({ onSwitchToRegister }: LoginPageProps) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required');
      return;
    }
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setError(axiosErr.response?.data?.error?.message ?? 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[100dvh] px-6" style={{ background: 'var(--sp-bg-primary)' }}>
      <div className="relative w-full max-w-sm flex flex-col items-center justify-center py-12">
        {/* Ambient background glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full blur-[120px] pointer-events-none" style={{ background: 'var(--sp-accent-glow)' }} />

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="relative z-10 w-full max-w-sm"
        >
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, var(--sp-gradient-start), var(--sp-gradient-end))', boxShadow: '0 0 30px var(--sp-accent-glow)' }}>
              <MapPin className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: 'var(--sp-text-primary)' }}>StreetPrint</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--sp-text-muted)' }}>Your routes, your world</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="rounded-xl px-4 py-3 text-sm"
                style={{ background: 'var(--sp-status-danger-bg)', border: '1px solid var(--sp-status-danger-text)', color: 'var(--sp-status-danger-text)' }}
              >
                {error}
              </motion.div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="login-email" className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--sp-text-muted)' }}>
                Email
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full h-12 rounded-xl px-4 text-sm outline-none transition-all"
                style={{
                  background: 'var(--sp-bg-input)',
                  border: '1px solid var(--sp-border-strong)',
                  color: 'var(--sp-text-primary)',
                }}
                autoComplete="email"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="login-password" className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--sp-text-muted)' }}>
                Password
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-12 rounded-xl px-4 pr-12 text-sm outline-none transition-all"
                  style={{
                    background: 'var(--sp-bg-input)',
                    border: '1px solid var(--sp-border-strong)',
                    color: 'var(--sp-text-primary)',
                  }}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: 'var(--sp-text-muted)' }}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 text-white font-semibold rounded-xl text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              style={{
                background: 'linear-gradient(135deg, var(--sp-gradient-start), var(--sp-gradient-end))',
                boxShadow: '0 0 20px var(--sp-accent-glow)',
              }}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          {/* Switch to register */}
          <div className="mt-6 text-center">
            <p className="text-sm" style={{ color: 'var(--sp-text-muted)' }}>
              Don&apos;t have an account?{' '}
              <button
                onClick={onSwitchToRegister}
                className="font-medium transition-colors"
                style={{ color: 'var(--sp-accent-text)' }}
              >
                Create one
              </button>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
