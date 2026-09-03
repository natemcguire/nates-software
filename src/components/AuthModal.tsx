import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Lock, AlertTriangle, Check } from 'lucide-react';
import { playClickSound } from '../lib/soundEngine';

const AVATAR_PRESETS = ['👤', '⛵', '🎯', '💻', '🎨', '🚀', '⚡', '🤖', '☕', '🛠️'];

export const AuthModal: React.FC = () => {
  const { isAuthModalOpen, closeAuthModal, authModalTab, actionDescription, login, register } = useAuth();
  const [tab, setTab] = useState<'login' | 'register'>(authModalTab);

  React.useEffect(() => {
    setTab(authModalTab);
  }, [authModalTab, isAuthModalOpen]);

  // Form Fields
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatar, setAvatar] = useState('👤');
  const [bio, setBio] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isAuthModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);

    if (tab === 'login') {
      const res = await login(username, password);
      setIsSubmitting(false);
      if (!res.success) {
        setErrorMsg(res.error || 'Invalid credentials');
      }
    } else {
      if (password.length < 8) {
        setErrorMsg('Password must be at least 8 characters long');
        setIsSubmitting(false);
        return;
      }
      const res = await register({
        username,
        password,
        displayName: displayName || username,
        avatar,
        bio
      });
      setIsSubmitting(false);
      if (!res.success) {
        setErrorMsg(res.error || 'Registration failed');
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs select-none p-4 font-tahoma text-xs">
      <div className="w-full max-w-md bg-w95-gray border-2 border-t-white border-l-white border-b-black border-r-black shadow-2xl p-1">
        {/* Title Bar */}
        <div className="bg-[#000080] text-white px-2 py-1 flex items-center justify-between font-bold text-xs">
          <div className="flex items-center gap-1.5">
            <Lock size={13} className="text-yellow-300" />
            <span>{tab === 'register' ? "Join Nate's Software" : "Welcome back"}</span>
          </div>
          <button
            onClick={closeAuthModal}
            className="w-4 h-4 bg-w95-gray border border-t-white border-l-white border-b-black border-r-black text-black font-bold flex items-center justify-center text-[10px] hover:bg-red-700 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 border-b border-gray-400 p-2 pb-0 bg-gray-200">
          <button
            onClick={() => { playClickSound(); setTab('login'); setErrorMsg(null); }}
            className={`px-4 py-1 font-bold text-xs rounded-t border-t-2 border-l-2 border-r-2 ${
              tab === 'login'
                ? 'bg-w95-gray border-white border-b-transparent -mb-[1px] font-bold text-black'
                : 'bg-gray-300 border-gray-400 text-gray-600'
            }`}
          >
            Log In
          </button>
          <button
            onClick={() => { playClickSound(); setTab('register'); setErrorMsg(null); }}
            className={`px-4 py-1 font-bold text-xs rounded-t border-t-2 border-l-2 border-r-2 ${
              tab === 'register'
                ? 'bg-w95-gray border-white border-b-transparent -mb-[1px] font-bold text-black'
                : 'bg-gray-300 border-gray-400 text-gray-600'
            }`}
          >
            Create account
          </button>
        </div>

        {/* Benefit Line & Contextual Action Header */}
        <div className="p-3 bg-w95-gray border-b border-gray-300 space-y-2">
          <p className="text-gray-700 text-xs leading-normal">
            Create an account to keep your forks, vote on drops, and get paid when you sell.
          </p>
          {actionDescription && (
            <div className="bg-blue-100 border border-blue-400 text-blue-950 px-2.5 py-1.5 rounded flex items-center gap-2 font-mono text-[11px]">
              <Lock size={12} className="shrink-0 text-blue-700" />
              <span>
                {/^(sign in|log in|create an account|create account)\b/i.test(actionDescription)
                  ? actionDescription
                  : `Sign in to ${actionDescription}`}
              </span>
            </div>
          )}
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3 bg-w95-gray">
          {errorMsg && (
            <div className="bg-red-100 border border-red-400 text-red-800 p-2 rounded flex items-center gap-2 font-mono text-[11px]">
              <AlertTriangle size={14} className="shrink-0 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div>
            <label className="block text-gray-800 font-bold mb-1 font-mono">Username</label>
            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white flex items-center px-2 py-1">
              <span className="text-gray-400 font-mono mr-1">@</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                placeholder="e.g. josh"
                required
                className="w-full text-xs font-mono outline-none bg-transparent"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-800 font-bold mb-1 font-mono">Password (min 8 characters)</label>
            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white flex items-center px-2 py-1">
              <Lock size={12} className="text-gray-400 mr-2" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full text-xs font-mono outline-none bg-transparent"
              />
            </div>
          </div>

          {tab === 'register' && (
            <>
              <div>
                <label className="block text-gray-800 font-bold mb-1 font-mono">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Josh McGuire"
                  className="w-full bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-1 text-xs outline-none"
                />
              </div>

              <div>
                <label className="block text-gray-800 font-bold mb-1 font-mono">Avatar Icon</label>
                <div className="flex items-center gap-1.5 flex-wrap bg-white p-2 border-2 border-t-black border-l-black border-b-white border-r-white">
                  {AVATAR_PRESETS.map((av) => (
                    <button
                      key={av}
                      type="button"
                      onClick={() => { playClickSound(); setAvatar(av); }}
                      className={`text-lg p-1 rounded hover:bg-blue-100 ${avatar === av ? 'ring-2 ring-blue-700 bg-blue-50' : ''}`}
                    >
                      {av}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-gray-800 font-bold mb-1 font-mono">Short Bio (optional)</label>
                <input
                  type="text"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="e.g. Builder at East Bay Projects"
                  className="w-full bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-1 text-xs outline-none"
                />
              </div>
            </>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-gray-300">
            <button
              type="button"
              onClick={closeAuthModal}
              className="btn-w95 px-4 py-1 text-xs"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-w95 btn-w95-primary px-6 py-1 font-bold text-xs flex items-center gap-1"
            >
              <Check size={12} />
              <span>{isSubmitting ? 'Authenticating...' : tab === 'login' ? 'Log In' : 'Create account'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
