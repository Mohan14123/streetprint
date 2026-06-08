/**
 * src/app/components/RegisterPage.tsx
 * Registration screen — theme-aware, glassmorphic card, animated entry.
 * Routes to /login for existing accounts.
 */
import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { MapPin, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';

interface RegisterPageProps {
  onSwitchToLogin: () => void;
}

export function RegisterPage({ onSwitchToLogin }: RegisterPageProps) {
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('All fields are required');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await register(name, email, password);
    } catch (err) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setError(
        axiosErr.response?.data?.error?.message ?? 'Registration failed. Try a different email.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[100dvh] px-6" style={{ background: 'var(--sp-bg-primary)' }}>
      <div className="relative w-full max-w-sm flex flex-col items-center justify-center py-12">
        {/* Ambient background glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full blur-[120px] pointer-events-none" style={{ background: 'var(--sp-accent-glow)' }} />
        <div className="absolute bottom-1/3 right-1/4 w-60 h-60 rounded-full blur-[100px] pointer-events-none" style={{ background: 'rgba(34, 197, 94, 0.05)' }} />

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
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: 'var(--sp-text-primary)' }}>Join StreetPrint</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--sp-text-muted)' }}>Start mapping your world</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3.5">
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
              <label htmlFor="register-name" className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--sp-text-muted)' }}>
                Name
              </label>
              <input
                id="register-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full h-12 rounded-xl px-4 text-sm outline-none transition-all"
                style={{
                  background: 'var(--sp-bg-input)',
                  border: '1px solid var(--sp-border-strong)',
                  color: 'var(--sp-text-primary)',
                }}
                autoComplete="name"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="register-email" className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--sp-text-muted)' }}>
                Email
              </label>
              <input
                id="register-email"
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
              <label htmlFor="register-password" className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--sp-text-muted)' }}>
                Password
              </label>
              <div className="relative">
                <input
                  id="register-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="w-full h-12 rounded-xl px-4 pr-12 text-sm outline-none transition-all"
                  style={{
                    background: 'var(--sp-bg-input)',
                    border: '1px solid var(--sp-border-strong)',
                    color: 'var(--sp-text-primary)',
                  }}
                  autoComplete="new-password"
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

            <div className="space-y-1.5">
              <label htmlFor="register-confirm" className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--sp-text-muted)' }}>
                Confirm Password
              </label>
              <input
                id="register-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-12 rounded-xl px-4 text-sm outline-none transition-all"
                style={{
                  background: 'var(--sp-bg-input)',
                  border: '1px solid var(--sp-border-strong)',
                  color: 'var(--sp-text-primary)',
                }}
                autoComplete="new-password"
              />
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
                  Creating account...
                </>
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          {/* Switch to login */}
          <div className="mt-6 text-center space-y-3">
            <p className="text-sm" style={{ color: 'var(--sp-text-muted)' }}>
              Already have an account?{' '}
              <button
                onClick={onSwitchToLogin}
                className="font-medium transition-colors"
                style={{ color: 'var(--sp-accent-text)' }}
              >
                Sign in
              </button>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
