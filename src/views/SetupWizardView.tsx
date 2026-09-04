import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  ArrowRight,
  Check,
  ShieldCheck,
  Terminal,
  ExternalLink,
  Flame,
  User,
  CheckCircle2,
  LogIn,
  UserPlus,
  RefreshCw,
  Edit3
} from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { useAuth } from '../context/AuthContext';
import { Win95Scroll } from '../components/Win95Scroll';
import { validateMakerProfile } from '../lib/profileDomain';

export interface SetupWizardViewProps {
  onOpenSandbox?: (appId: string) => void;
  onOpenTerminal?: (initialCmd?: string) => void;
  onOpenForge?: (repoId: string) => void;
  onBrowseDrops?: () => void;
  onOpenHotwire?: () => void;
  onClose?: () => void;
}

const AVATAR_PRESETS = ['⚡', '📦', '💻', '🕹️', '💾', '🚀', '🤖', '🎨', '🔥', '🧙‍♂️'];

export const SetupWizardView: React.FC<SetupWizardViewProps> = ({
  onOpenSandbox: _onOpenSandbox,
  onOpenTerminal,
  onOpenForge,
  onBrowseDrops,
  onOpenHotwire,
  onClose
}) => {
  const { user, isAuthenticated, openAuthModal } = useAuth();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [avatar, setAvatar] = useState(user?.avatar || '⚡');
  const [bio, setBio] = useState(user?.bio || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      if (!displayName && user.displayName) setDisplayName(user.displayName);
      if (user.avatar) setAvatar(user.avatar);
      if (!bio && user.bio) setBio(user.bio);
    }
  }, [user]);

  const handleLaunchHotwire = () => {
    playSuccessChime();
    if (onOpenHotwire) {
      onOpenHotwire();
    } else if (onBrowseDrops) {
      onBrowseDrops();
    }
    if (onClose) {
      onClose();
    }
  };

  const handleSaveProfile = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setProfileError(null);
    setProfileSaved(false);

    const validation = validateMakerProfile({
      displayName,
      avatar,
      bio
    });

    if (!validation.valid) {
      setProfileError(validation.errors.join(' '));
      return false;
    }

    try {
      setIsSavingProfile(true);
      playClickSound();

      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          avatar,
          bio
        })
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Profile update failed (HTTP ${res.status})`);
      }

      playSuccessChime();
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
      return true;
    } catch (err: any) {
      setProfileError(err.message || 'Failed to save profile changes');
      return false;
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleNextStep = async () => {
    playClickSound();
    if (step === 2 && isAuthenticated && (displayName || bio)) {
      await handleSaveProfile();
    }
    setStep((prev) => (Math.min(4, prev + 1) as any));
  };

  return (
    <div className="h-full flex flex-col bg-[#ece9d8] font-tahoma text-xs overflow-hidden select-none">
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-blue-950 text-white p-3 border-b-2 border-gray-600 flex items-center justify-between shadow-md shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-white/10 rounded flex items-center justify-center border border-white/20 text-base">
            🚀
          </div>
          <div>
            <div className="font-bold text-sm">NATE'S SOFTWARE SETUP WIZARD — QUICKSTART 95</div>
            <div className="text-[11px] text-blue-200 font-mono">Welcome to the Source-First Shareware Marketplace</div>
          </div>
        </div>

        <div className="flex items-center gap-1 font-mono text-[11px] flex-wrap">
          <span className={`px-2 py-0.5 rounded border ${step === 1 ? 'bg-amber-400 text-black font-bold border-amber-500' : 'bg-blue-950 text-gray-400 border-blue-800'}`}>
            1. Account
          </span>
          <span className="text-gray-500">&rarr;</span>
          <span className={`px-2 py-0.5 rounded border ${step === 2 ? 'bg-amber-400 text-black font-bold border-amber-500' : 'bg-blue-950 text-gray-400 border-blue-800'}`}>
            2. Profile
          </span>
          <span className="text-gray-500">&rarr;</span>
          <span className={`px-2 py-0.5 rounded border ${step === 3 ? 'bg-amber-400 text-black font-bold border-amber-500' : 'bg-blue-950 text-gray-400 border-blue-800'}`}>
            3. How it works
          </span>
          <span className="text-gray-500">&rarr;</span>
          <span className={`px-2 py-0.5 rounded border ${step === 4 ? 'bg-amber-400 text-black font-bold border-amber-500' : 'bg-blue-950 text-gray-400 border-blue-800'}`}>
            4. WHAT'S HOT
          </span>
        </div>
      </div>

      <Win95Scroll className="flex-1 p-4 bg-w95-gray">
        {step === 1 && (
          <div className="space-y-4 max-w-2xl mx-auto w-full">
            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 space-y-1">
              <div className="font-bold text-sm text-blue-950 flex items-center gap-1.5">
                <User size={15} className="text-blue-700" />
                <span>Step 1: Sign up or Sign in</span>
              </div>
              <p className="text-gray-600 text-xs">
                Nate's Software is a peer-to-peer shareware marketplace. Create an account to purchase source repos, fork apps, and publish your own software drops.
              </p>
            </div>

            {isAuthenticated && user ? (
              <div className="bg-emerald-50 border-2 border-emerald-500 p-4 rounded text-emerald-950 space-y-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded bg-white border border-emerald-400 grid place-items-center text-2xl shadow-inner">
                    {user.avatar || '⚡'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">Signed in as @{user.username}</span>
                      <span className="bg-emerald-200 text-emerald-900 font-mono text-[10px] px-1.5 py-0.5 rounded font-bold uppercase">
                        {user.role || 'maker'}
                      </span>
                    </div>
                    <div className="text-xs text-emerald-800 mt-0.5">
                      {user.displayName ? `${user.displayName} · ` : ''}Your account is ready for marketplace purchases and publishing.
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-emerald-300 p-2.5 rounded text-xs text-gray-700 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-emerald-800 font-bold">
                    <CheckCircle2 size={14} className="text-emerald-600" />
                    <span>Authentication active</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      playClickSound();
                      openAuthModal('login');
                    }}
                    className="win95-btn px-2.5 py-1 text-xs font-bold text-gray-800 bg-[#dfdfdf] hover:bg-white"
                  >
                    Switch Account
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-5 space-y-4">
                <div className="space-y-1">
                  <div className="font-bold text-sm text-gray-900">Get your Maker Identity</div>
                  <p className="text-xs text-gray-600">
                    Sign in with your existing username or register a new maker identity in seconds. No credit card required to explore.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="bg-blue-50 border border-blue-300 p-3 rounded space-y-2 flex flex-col justify-between">
                    <div>
                      <div className="font-bold text-xs text-blue-950 flex items-center gap-1.5">
                        <UserPlus size={14} className="text-blue-700" />
                        <span>New to Nate's Software?</span>
                      </div>
                      <p className="text-[11px] text-gray-600 mt-1">
                        Claim your maker username to purchase source code and publish software drops.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        playClickSound();
                        openAuthModal('register');
                      }}
                      className="win95-btn px-4 py-2 font-bold text-xs bg-blue-900 text-white hover:bg-blue-800 flex items-center justify-center gap-1.5 shadow"
                    >
                      <UserPlus size={13} />
                      <span>Create Account (Sign Up)</span>
                    </button>
                  </div>

                  <div className="bg-gray-50 border border-gray-300 p-3 rounded space-y-2 flex flex-col justify-between">
                    <div>
                      <div className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                        <LogIn size={14} className="text-gray-700" />
                        <span>Already have an account?</span>
                      </div>
                      <p className="text-[11px] text-gray-600 mt-1">
                        Sign in to access your purchased shareware, Git repositories, and creator royalties.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        playClickSound();
                        openAuthModal('login');
                      }}
                      className="win95-btn px-4 py-2 font-bold text-xs bg-[#dfdfdf] hover:bg-white text-gray-900 flex items-center justify-center gap-1.5"
                    >
                      <LogIn size={13} />
                      <span>Sign In</span>
                    </button>
                  </div>
                </div>

                <div className="text-[11px] text-gray-500 font-mono text-center pt-1 border-t border-gray-200">
                  You can also continue as guest and sign in whenever you want to make a purchase or publish.
                </div>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 max-w-2xl mx-auto w-full">
            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 space-y-1">
              <div className="font-bold text-sm text-blue-950 flex items-center gap-1.5">
                <Edit3 size={15} className="text-purple-700" />
                <span>Step 2: Set up your profile</span>
              </div>
              <p className="text-gray-600 text-xs">
                Customize how your maker handle appears on WHAT'S HOT rankings, app releases, and Git commit lineages.
              </p>
            </div>

            <form onSubmit={handleSaveProfile} className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-4 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-gray-800 mb-1">
                  Maker Avatar
                </label>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded bg-white border border-gray-500 grid place-items-center text-2xl win95-field shadow-inner">
                    {avatar || '⚡'}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex flex-wrap gap-1">
                      {AVATAR_PRESETS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => {
                            playClickSound();
                            setAvatar(p);
                          }}
                          className={`w-7 h-7 rounded border grid place-items-center text-sm ${
                            avatar === p
                              ? 'bg-blue-100 border-blue-600 ring-1 ring-blue-500 font-bold'
                              : 'bg-gray-100 border-gray-300 hover:bg-white'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-800 mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={user?.username || 'e.g. Retro Hacker'}
                  className="w-full win95-field bg-white border border-gray-500 p-1.5 text-xs font-tahoma text-black"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-800 mb-1">
                  Maker Bio &amp; Pitch
                </label>
                <textarea
                  rows={2}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Building retro tools and fast desktop utilities."
                  className="w-full win95-field bg-white border border-gray-500 p-1.5 text-xs font-tahoma text-black resize-none"
                />
              </div>

              {profileError && (
                <div className="p-2 bg-red-50 border border-red-400 text-red-800 text-xs rounded">
                  {profileError}
                </div>
              )}

              {profileSaved && (
                <div className="p-2 bg-emerald-50 border border-emerald-400 text-emerald-800 text-xs rounded flex items-center gap-1.5 font-bold">
                  <Check size={13} className="text-emerald-600" />
                  <span>Profile updated successfully!</span>
                </div>
              )}

              <div className="pt-2 border-t border-gray-300 flex items-center justify-between">
                <span className="text-[11px] text-gray-500">
                  {isAuthenticated ? `Linked to @${user?.username}` : 'Sign in to persist your profile changes'}
                </span>
                {isAuthenticated && (
                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="win95-btn px-3 py-1 font-bold text-xs bg-[#dfdfdf] hover:bg-white text-gray-900 inline-flex items-center gap-1"
                  >
                    {isSavingProfile ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                    <span>Save Profile</span>
                  </button>
                )}
              </div>
            </form>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 max-w-2xl mx-auto w-full">
            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 space-y-1">
              <div className="font-bold text-sm text-blue-950 flex items-center gap-1.5">
                <Sparkles size={15} className="text-amber-500" />
                <span>Step 3: How it works</span>
              </div>
              <p className="text-gray-600 text-xs">
                Nate's Software operates under a simple, fair economic model designed for real software ownership.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white border-2 border-t-white border-l-white border-b-black border-r-black p-3 space-y-2 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="text-2xl mb-1">📦</div>
                  <div className="font-bold text-xs text-blue-950">1. Buy Once, Own Source</div>
                  <p className="text-gray-600 text-[11px] mt-1 leading-relaxed">
                    You buy the source code repository, not a recurring subscription. Full commit history on GITSMITH is included.
                  </p>
                </div>
                <div className="bg-blue-50 text-blue-800 p-1.5 rounded font-mono text-[10px] border border-blue-200">
                  Zero recurring fees
                </div>
              </div>

              <div className="bg-white border-2 border-t-white border-l-white border-b-black border-r-black p-3 space-y-2 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="text-2xl mb-1">⚡</div>
                  <div className="font-bold text-xs text-blue-950">2. Fork &amp; Mod with AI</div>
                  <p className="text-gray-600 text-[11px] mt-1 leading-relaxed">
                    Fork any public project with 1 click. Customize features using AGY, Claude Code, or Cursor, and test in client sandboxes.
                  </p>
                </div>
                <div className="bg-amber-50 text-amber-900 p-1.5 rounded font-mono text-[10px] border border-amber-200">
                  Built-in AI tooling
                </div>
              </div>

              <div className="bg-white border-2 border-t-white border-l-white border-b-black border-r-black p-3 space-y-2 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="text-2xl mb-1">💎</div>
                  <div className="font-bold text-xs text-blue-950">3. Immutable Royalties</div>
                  <p className="text-gray-600 text-[11px] mt-1 leading-relaxed">
                    When you sell your fork, upstream creators receive their frozen royalty percentage automatically on every checkout.
                  </p>
                </div>
                <div className="bg-emerald-50 text-emerald-900 p-1.5 rounded font-mono text-[10px] border border-emerald-200">
                  Creators paid forever
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-blue-950 via-slate-900 to-blue-950 text-white p-3.5 rounded border border-blue-700 shadow font-mono text-xs space-y-2">
              <div className="font-bold text-amber-400 flex items-center gap-1.5 text-xs">
                <ShieldCheck size={14} />
                <span>When you publish and sell your fork:</span>
              </div>
              <div className="flex justify-between border-b border-blue-900 pb-1 text-gray-300">
                <span>🛡️ Platform:</span>
                <span className="font-bold text-purple-300">10% flat</span>
              </div>
              <div className="flex justify-between border-b border-blue-900 pb-1 text-gray-300">
                <span>💎 Upstream makers you forked from:</span>
                <span className="font-bold text-blue-300">their frozen royalty rate</span>
              </div>
              <div className="flex justify-between text-gray-300">
                <span>⚡ You (the maker/seller):</span>
                <span className="font-bold text-emerald-400">the rest</span>
              </div>
              <div className="text-[10px] text-blue-300 pt-0.5">
                Root apps with no ancestors earn 90% maker / 10% platform. No entitlement or payout is created by this wizard.
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4 max-w-2xl mx-auto w-full">
            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-4 space-y-2 text-center">
              <div className="text-3xl select-none">🎉</div>
              <div className="font-bold text-base text-gray-900">Setup Complete — Welcome to WHAT'S HOT!</div>
              <p className="text-gray-600 text-xs max-w-md mx-auto leading-relaxed">
                You're ready to explore today's community drops, inspect full source trees, and launch fresh sandboxes directly on the desktop.
              </p>
            </div>

            <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-blue-950 text-white p-5 rounded border-2 border-blue-600 shadow-md text-center space-y-3">
              <div className="space-y-1">
                <div className="font-bold text-base text-amber-300 flex items-center justify-center gap-2">
                  <Flame size={18} className="text-amber-400 fill-amber-400" />
                  <span>Launch HOTWIRE — Daily Shareware Leaderboard</span>
                </div>
                <p className="text-xs text-blue-100 max-w-md mx-auto">
                  Browse top-ranked apps, filter by Most Bought and Rising, view maker profiles, and buy source files directly.
                </p>
              </div>

              <button
                type="button"
                onClick={handleLaunchHotwire}
                className="win95-btn px-6 py-2.5 font-bold text-sm bg-amber-400 hover:bg-amber-300 text-black inline-flex items-center gap-2 shadow-lg"
              >
                <Flame size={16} className="fill-current text-orange-600" />
                <span>Launch WHAT'S HOT (HOTWIRE) &rarr;</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {onOpenTerminal && (
                <div className="bg-white border-2 border-t-white border-l-white border-b-black border-r-black p-3 flex flex-col justify-between space-y-2">
                  <div>
                    <div className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                      <Terminal size={14} className="text-purple-600" />
                      <span>Developer Terminal</span>
                    </div>
                    <p className="text-[11px] text-gray-600 mt-0.5">
                      Test commands and interact with the SLOP CLI without leaving the web OS.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      playClickSound();
                      onOpenTerminal();
                    }}
                    className="win95-btn px-3 py-1 font-bold text-xs bg-[#dfdfdf] hover:bg-white text-gray-900 flex items-center justify-center gap-1"
                  >
                    <Terminal size={12} />
                    <span>Open TERMINAL.EXE</span>
                  </button>
                </div>
              )}

              {onOpenForge && (
                <div className="bg-white border-2 border-t-white border-l-white border-b-black border-r-black p-3 flex flex-col justify-between space-y-2">
                  <div>
                    <div className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                      <ExternalLink size={14} className="text-blue-600" />
                      <span>GITSMITH Source Forge</span>
                    </div>
                    <p className="text-[11px] text-gray-600 mt-0.5">
                      Explore repository trees, inspect git logs, and manage branches.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      playClickSound();
                      onOpenForge('');
                    }}
                    className="win95-btn px-3 py-1 font-bold text-xs bg-[#dfdfdf] hover:bg-white text-gray-900 flex items-center justify-center gap-1"
                  >
                    <ExternalLink size={12} />
                    <span>Open GITSMITH</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </Win95Scroll>

      <div className="bg-w95-gray px-4 py-2.5 border-t border-gray-400 flex items-center justify-between shrink-0 shadow-sm">
        {step > 1 ? (
          <button
            onClick={() => { playClickSound(); setStep((prev) => (prev - 1) as any); }}
            className="win95-btn px-4 py-1 font-bold text-xs bg-[#dfdfdf] hover:bg-white text-gray-900"
          >
            &larr; Back
          </button>
        ) : (
          <div />
        )}

        {step < 4 ? (
          <button
            onClick={handleNextStep}
            className="win95-btn px-6 py-1.5 font-bold text-xs flex items-center gap-1.5 bg-blue-900 text-white hover:bg-blue-800"
          >
            <span>Continue</span>
            <ArrowRight size={13} />
          </button>
        ) : (
          <button
            onClick={handleLaunchHotwire}
            className="win95-btn px-6 py-1.5 font-bold text-xs bg-amber-400 hover:bg-amber-300 text-black flex items-center gap-1.5 font-bold"
          >
            <span>Explore WHAT'S HOT &rarr;</span>
          </button>
        )}
      </div>
    </div>
  );
};

