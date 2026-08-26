import React, { useState, useEffect } from 'react';
import { User, Key, Download, HardDrive, MessageSquare, Check, Sparkles, ExternalLink, Folder, Copy } from 'lucide-react';
import { APPS_DATA } from '../data/mockData';
import { playClickSound } from '../lib/soundEngine';

export const ProfileView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'profile' | 'shelf' | 'forks' | 'activity'>('shelf');

  // User Profile State
  const [username, setUsername] = useState('nate');
  const [displayName, setDisplayName] = useState('Nate McGuire');
  const [avatar, setAvatar] = useState('⚡');
  const [bio, setBio] = useState('Founder at East Bay Projects. Building indie shareware.');
  const [sshKey, setSshKey] = useState('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGxY8... nate@macmini');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  // User Shelf (Owned / Saved Apps)
  const [shelfApps, setShelfApps] = useState<any[]>([
    {
      ...APPS_DATA[0],
      licenseKey: 'NSW-DH-9821-0001',
      purchasedDate: 'Aug 25, 2026',
      localDbSize: '14.8 MB'
    },
    {
      ...APPS_DATA[1],
      licenseKey: 'NSW-CM-9821-4401',
      purchasedDate: 'Aug 24, 2026',
      localDbSize: '1.4 MB'
    },
    {
      ...APPS_DATA[2],
      licenseKey: 'NSW-PF-9821-7702',
      purchasedDate: 'Aug 22, 2026',
      localDbSize: '4.2 MB'
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
            setBio(data.user.bio || 'Founder at East Bay Projects. Building indie shareware.');
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

  const handleCopyLicense = (appId: string, key: string) => {
    playClickSound();
    navigator.clipboard.writeText(key);
    setCopiedKeyId(appId);
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-[#ece9d8] font-tahoma text-sm select-none">
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
            onClick={() => { playClickSound(); setActiveTab('shelf'); }}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'shelf' ? 'btn-w95-primary' : 'text-black'}`}
          >
            <HardDrive size={13} /> My Shelf ({shelfApps.length})
          </button>
          <button
            onClick={() => { playClickSound(); setActiveTab('forks'); }}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'forks' ? 'btn-w95-primary' : 'text-black'}`}
          >
            <Sparkles size={13} /> Published Apps (3)
          </button>
          <button
            onClick={() => { playClickSound(); setActiveTab('profile'); }}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'profile' ? 'btn-w95-primary' : 'text-black'}`}
          >
            <User size={13} /> Account Settings
          </button>
          <button
            onClick={() => { playClickSound(); setActiveTab('activity'); }}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'activity' ? 'btn-w95-primary' : 'text-black'}`}
          >
            <MessageSquare size={13} /> Comments &amp; Upvotes
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 bg-white border-2 border-gray-800 p-4 overflow-y-auto">
        {/* TAB 1: My Shelf */}
        {activeTab === 'shelf' && (
          <div className="space-y-3 max-w-4xl mx-auto">
            <div className="border-b pb-2 mb-2 flex justify-between items-center">
              <div>
                <span className="font-bold text-base text-w95-blue">My Software Shelf &amp; Local Database Volume</span>
                <p className="text-gray-600 text-xs">All software titles in your library with live URLs, Git repository links, and SQLite database backup options.</p>
              </div>
              <span className="bg-blue-100 text-w95-blue text-xs font-bold px-2 py-1 rounded">
                {shelfApps.length} Owned Applications
              </span>
            </div>

            <div className="space-y-2.5">
              {shelfApps.map((app) => (
                <div key={app.id} className="border-2 border-gray-700 bg-gray-50 p-3 rounded flex items-center justify-between gap-3 shadow-sm hover:bg-blue-50/40 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl bg-white p-1 rounded border border-gray-400">{app.authorAvatar || app.creatorAvatar || '📦'}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-gray-900">{app.name}</span>
                        <span className="bg-green-100 text-green-800 text-[10px] font-bold px-1.5 py-0.5 rounded border border-green-300">
                          {app.version}
                        </span>
                        <span className="text-gray-500 text-xs font-mono">License: {app.licenseKey}</span>
                        <button
                          onClick={() => handleCopyLicense(app.id, app.licenseKey)}
                          className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center gap-0.5"
                          title="Copy license key"
                        >
                          {copiedKeyId === app.id ? <Check size={10} className="text-green-700" /> : <Copy size={10} />}
                          <span>{copiedKeyId === app.id ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                      <p className="text-gray-600 text-xs mt-0.5 line-clamp-1">{app.tagline}</p>
                      <div className="text-[11px] text-gray-500 font-mono mt-1 flex items-center gap-2">
                        <span>Acquired: {app.purchasedDate}</span>
                        <span>&middot;</span>
                        <span>Database: {app.sqliteDatabase} (WAL Mode)</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href={app.liveUrl || `https://${app.id}.nates-software.com`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-w95 btn-w95-primary text-xs py-1 px-3 flex items-center gap-1 font-bold"
                    >
                      <ExternalLink size={12} /> Launch &rarr;
                    </a>
                    <a
                      href={`https://gitsmith.nates-software.com?repo=${app.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-w95 text-xs py-1 px-2.5 flex items-center gap-1 font-bold"
                    >
                      <Folder size={12} /> Git Repo
                    </a>
                    <a
                      href={`data:text/plain;charset=utf-8,--%20SQLite%20Database%20Backup%20for%20${app.name}%0A--%20App%20ID:%20${app.id}%0A--%20WAL%20Journal%20Clean%0A`}
                      download={`${app.id}.sqlite`}
                      className="btn-w95 text-xs py-1 px-2 flex items-center gap-1"
                      title="Download database snapshot"
                    >
                      <Download size={12} /> Export DB
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: Published Apps & Active Forks */}
        {activeTab === 'forks' && (
          <div className="space-y-3 max-w-4xl mx-auto">
            <div className="border-b pb-2 mb-2 flex justify-between items-center">
              <div>
                <span className="font-bold text-base text-w95-blue">Published Shareware &amp; Live Drops</span>
                <p className="text-gray-600 text-xs">Manage apps you created and deployed to the 12:01 AM Daily Drops board.</p>
              </div>
            </div>

            <div className="space-y-2.5">
              {APPS_DATA.map(app => (
                <div key={app.id} className="border-2 border-gray-700 bg-blue-50/60 p-3 rounded flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl bg-white p-1 rounded border border-gray-400">{app.authorAvatar}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-w95-blue">{app.name}</span>
                        <span className="bg-green-100 text-green-800 text-[10px] font-bold px-1.5 py-0.5 rounded border border-green-300 font-mono">
                          {app.version}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 mt-0.5">{app.upvotes} upvotes &middot; {app.forkCount} downstream forks</div>
                      <div className="text-[11px] text-green-700 font-mono font-bold mt-1">Live URL: {app.liveUrl}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <a
                      href={app.liveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-w95 btn-w95-primary text-xs py-1 px-3 flex items-center gap-1 font-bold"
                    >
                      <ExternalLink size={12} /> Open App
                    </a>
                    <a
                      href={`https://gitsmith.nates-software.com?repo=${app.id}`}
                      className="btn-w95 text-xs py-1 px-2.5 flex items-center gap-1"
                    >
                      <Folder size={12} /> View Code
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: Profile Settings */}
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

        {/* TAB 4: Activity */}
        {activeTab === 'activity' && (
          <div className="space-y-3 max-w-3xl mx-auto">
            <div className="border-b pb-2 mb-2">
              <span className="font-bold text-base text-w95-blue">My Comments &amp; Maker Discussions</span>
              <p className="text-gray-600 text-xs">Recent discussions, maker notes, and replies on 12:01 AM Daily Drops.</p>
            </div>

            <div className="space-y-2">
              <div className="bg-gray-50 border p-3 rounded space-y-1">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-w95-blue">Maker Note on DroneHunter 95:</span>
                  <span className="text-gray-400 font-mono text-[11px]">12:01 AM UTC</span>
                </div>
                <p className="text-gray-800 text-xs">
                  "Built with pure HTML5 Canvas + Web Audio API shotgun audio. All scores persist directly to your local SQLite database without third-party servers."
                </p>
                <div className="text-[11px] text-orange-600 font-bold mt-1">👍 24 Upvotes</div>
              </div>

              <div className="bg-gray-50 border p-3 rounded space-y-1">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-w95-blue">Maker Note on Certified Mailer:</span>
                  <span className="text-gray-400 font-mono text-[11px]">12:01 AM UTC</span>
                </div>
                <p className="text-gray-800 text-xs">
                  "Flattens DOCX/PDF to 300 DPI pixels to prevent print layout skew, and logs digital signature receipts into SQLite."
                </p>
                <div className="text-[11px] text-orange-600 font-bold mt-1">👍 18 Upvotes</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
