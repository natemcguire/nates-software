import React, { useState, useEffect } from 'react';
import { User, Key, Download, HardDrive, MessageSquare, Check, Sparkles, Plus } from 'lucide-react';
import { APPS_DATA } from '../data/mockData';

export const ProfileView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'profile' | 'shelf' | 'forks' | 'activity'>('profile');

  // User Profile State
  const [username, setUsername] = useState('nate');
  const [displayName, setDisplayName] = useState('Nate McGuire');
  const [avatar, setAvatar] = useState('⚡');
  const [bio, setBio] = useState('Founder at East Bay Projects. Building shareware for sovereign users.');
  const [sshKey, setSshKey] = useState('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGxY8... nate@macmini');
  const [savedSuccess, setSavedSuccess] = useState(false);

  // User Shelf (Owned / Saved Apps)
  const [shelfApps, setShelfApps] = useState<any[]>([
    {
      ...APPS_DATA[0],
      licenseKey: 'NSW-WA-9821-0001',
      purchasedDate: 'Aug 25, 2026',
      localDbSize: '14.8 MB'
    },
    {
      ...APPS_DATA[1],
      licenseKey: 'NSW-RC-9821-4401',
      purchasedDate: 'Aug 24, 2026',
      localDbSize: '1.4 MB'
    }
  ]);

  // Load live profile & shelf from Cloudflare D1
  useEffect(() => {
    fetch('/api/profile?username=nate')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          if (data.user) {
            setDisplayName(data.user.displayName || 'Nate McGuire');
            setAvatar(data.user.avatar || '⚡');
            setBio(data.user.bio || '');
            if (data.user.sshKey) setSshKey(data.user.sshKey);
          }
          if (data.shelf && data.shelf.length > 0) {
            setShelfApps(data.shelf);
          }
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);

    // Call live Cloudflare D1 API
    try {
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          displayName,
          avatar,
          bio,
          sshKey
        })
      });
    } catch {}
  };

  return (
    <div className="flex flex-col h-full bg-[#ece9d8] font-tahoma text-sm">
      {/* Profile Header Navigation */}
      <div className="bg-gradient-to-r from-w95-blue via-blue-900 to-w95-blue text-white p-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="text-3xl bg-white p-1 rounded border border-gray-400 text-black">{avatar}</div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base">{displayName}</span>
              <span className="bg-blue-800 text-blue-200 text-xs px-2 py-0.5 rounded font-mono">@{username}</span>
              <span className="bg-green-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded font-mono">
                ● D1 SYNC ACTIVE
              </span>
            </div>
            <p className="text-blue-100 text-xs mt-0.5">{bio}</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('profile')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'profile' ? 'btn-w95-primary' : 'text-black'}`}
          >
            <User size={13} /> Account Settings
          </button>
          <button
            onClick={() => setActiveTab('shelf')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'shelf' ? 'btn-w95-primary' : 'text-black'}`}
          >
            <HardDrive size={13} /> My Shelf ({shelfApps.length})
          </button>
          <button
            onClick={() => setActiveTab('forks')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'forks' ? 'btn-w95-primary' : 'text-black'}`}
          >
            <Sparkles size={13} /> My Forks &amp; Drops
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'activity' ? 'btn-w95-primary' : 'text-black'}`}
          >
            <MessageSquare size={13} /> Comments &amp; Upvotes
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 bg-white border-2 border-gray-800 p-4 overflow-y-auto">
        {/* TAB 1: Profile Settings */}
        {activeTab === 'profile' && (
          <form onSubmit={handleSaveProfile} className="max-w-2xl mx-auto space-y-3">
            <div className="border-b pb-2 mb-3">
              <span className="font-bold text-base text-w95-blue">Maker Identity &amp; Git Credentials</span>
              <p className="text-gray-600 text-xs">Manage your handle, avatar, and SSH keys used for GITSMITH forge authentication.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-gray-800 block mb-1 text-xs">Username (Handle):</label>
                <div className="flex items-center">
                  <span className="bg-gray-200 border border-r-0 border-gray-400 px-2 py-1.5 text-xs text-gray-600 font-mono">@</span>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="flex-1 p-1.5 border border-gray-400 font-bold text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-gray-800 block mb-1 text-xs">Display Name:</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full p-1.5 border border-gray-400 text-xs font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-gray-800 block mb-1 text-xs">Avatar (Emoji or Image URL):</label>
                <input
                  type="text"
                  value={avatar}
                  onChange={(e) => setAvatar(e.target.value)}
                  className="w-full p-1.5 border border-gray-400 text-sm"
                />
              </div>

              <div>
                <label className="font-bold text-gray-800 block mb-1 text-xs">Stripe Payout Status:</label>
                <div className="bg-green-50 border border-green-300 p-1.5 rounded flex items-center justify-between text-xs text-green-900">
                  <span className="font-bold">Connected (acct_1NZ...)</span>
                  <span className="bg-green-600 text-white text-[10px] px-1.5 py-0.5 rounded">Active</span>
                </div>
              </div>
            </div>

            <div>
              <label className="font-bold text-gray-800 block mb-1 text-xs">Public Bio:</label>
              <textarea
                rows={2}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="w-full p-2 border border-gray-400 text-xs resize-none"
              />
            </div>

            <div>
              <label className="font-bold text-gray-800 block mb-1 text-xs flex items-center gap-1.5">
                <Key size={13} className="text-purple-700" /> GITSMITH SSH Public Key:
              </label>
              <input
                type="text"
                value={sshKey}
                onChange={(e) => setSshKey(e.target.value)}
                className="w-full p-2 border border-gray-400 font-mono text-xs bg-gray-50"
              />
              <p className="text-gray-500 text-[11px] mt-1">Allows passwordless git push to <code className="font-mono bg-gray-200 px-1">git@gitsmith.dev:{username}/...</code></p>
            </div>

            <div className="pt-3 border-t border-gray-300 flex justify-between items-center">
              {savedSuccess ? (
                <span className="text-green-700 font-bold text-xs flex items-center gap-1">
                  <Check size={14} /> Profile settings saved to Cloudflare D1!
                </span>
              ) : <div />}

              <button type="submit" className="btn-w95 btn-w95-primary px-5 py-1.5 text-xs">
                Save Profile Changes
              </button>
            </div>
          </form>
        )}

        {/* TAB 2: My Shelf */}
        {activeTab === 'shelf' && (
          <div className="space-y-3 max-w-4xl mx-auto">
            <div className="border-b pb-2 mb-2 flex justify-between items-center">
              <div>
                <span className="font-bold text-base text-w95-blue">My Software Shelf &amp; Sovereign Disk</span>
                <p className="text-gray-600 text-xs">All software you own and hold license title to. Download offline binaries or backup live SQLite files.</p>
              </div>
              <span className="bg-blue-100 text-w95-blue text-xs font-bold px-2 py-1 rounded">
                {shelfApps.length} Owned Applications
              </span>
            </div>

            <div className="space-y-2">
              {shelfApps.map((app) => (
                <div key={app.id} className="border-2 border-gray-700 bg-gray-50 p-3 rounded flex items-center justify-between gap-3 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl bg-white p-1 rounded border border-gray-400">{app.creatorAvatar || '📦'}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-gray-900">{app.name}</span>
                        <span className="bg-green-100 text-green-800 text-[10px] font-bold px-1.5 py-0.5 rounded border border-green-300">
                          {app.version}
                        </span>
                        <span className="text-gray-500 text-xs font-mono">License: {app.licenseKey}</span>
                      </div>
                      <p className="text-gray-600 text-xs mt-0.5 line-clamp-1">{app.tagline}</p>
                      <div className="text-[11px] text-gray-500 font-mono mt-1">
                        Acquired: {app.purchasedDate} &middot; Local Database: {app.localDbSize || '1.4 MB'} (WAL Mode)
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href="data:text/plain;charset=utf-8,SQLite%203.45%20Format"
                      download={`${app.appId || app.id}-backup.sqlite`}
                      className="btn-w95 text-xs py-1 px-2 flex items-center gap-1"
                    >
                      <Download size={12} /> Backup .sqlite
                    </a>
                    <button className="btn-w95 text-xs py-1 px-2">
                      🍎 Download DMG
                    </button>
                    <button className="btn-w95 btn-w95-primary text-xs py-1 px-3">
                      Launch &rarr;
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: Forks */}
        {activeTab === 'forks' && (
          <div className="space-y-3 max-w-4xl mx-auto">
            <div className="border-b pb-2 mb-2 flex justify-between items-center">
              <div>
                <span className="font-bold text-base text-w95-blue">Published Listings &amp; Active Forks</span>
                <p className="text-gray-600 text-xs">Manage apps you authored or modified via SLOPSHOP.</p>
              </div>
              <button className="btn-w95 btn-w95-primary text-xs py-1 px-2 flex items-center gap-1">
                <Plus size={12} /> Publish New App
              </button>
            </div>

            <div className="border-2 border-gray-700 bg-blue-50 p-3 rounded flex items-center justify-between">
              <div>
                <div className="font-bold text-sm text-w95-blue">⚡ WallArt Canvas Pro v2.4.0</div>
                <div className="text-xs text-gray-600">Created by @nate &middot; 384 upvotes &middot; 112 downstream forks</div>
                <div className="text-[11px] text-green-700 font-bold mt-1">Total Royalty Earnings: $920.00 (Settled)</div>
              </div>
              <button className="btn-w95 text-xs py-1 px-3">
                Manage Listing
              </button>
            </div>
          </div>
        )}

        {/* TAB 4: Activity */}
        {activeTab === 'activity' && (
          <div className="space-y-3 max-w-3xl mx-auto">
            <div className="border-b pb-2 mb-2">
              <span className="font-bold text-base text-w95-blue">My Comments &amp; Maker Discussions</span>
              <p className="text-gray-600 text-xs">Recent reviews, feature requests, and feedback left on drops.</p>
            </div>

            <div className="space-y-2">
              <div className="bg-gray-50 border p-3 rounded">
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className="font-bold text-w95-blue">Commented on WallArt Canvas Pro:</span>
                  <span className="text-gray-400 font-mono text-[11px]">45 mins ago</span>
                </div>
                <p className="text-gray-800 text-xs">
                  "Thanks Josh! In the next drop I\'m adding local GPU background segmentation so you can preview custom matting against actual photos of your room wall."
                </p>
                <div className="text-[11px] text-orange-600 font-bold mt-1">👍 19 Upvotes</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
