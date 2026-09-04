import React, { useState } from 'react';
import { AppListing } from '../data/mockData';
import { Save, Plus, Trash2, CheckCircle2, Copy, Check, AlertTriangle } from 'lucide-react';
import { playClickSound } from '../lib/soundEngine';
import { useAlert } from '../context/AlertContext';
import { useAuth } from '../context/AuthContext';

export interface DropPersistResult {
  productStatus?: string;
  deploymentState?: string;
  repositoryProvisioned?: boolean;
  message?: string;
}

interface PostEditorViewProps {
  app: AppListing;
  initialTab?: 'info' | 'media' | 'guide' | 'pricing';
  onSave: (updatedApp: AppListing) => Promise<DropPersistResult | void> | DropPersistResult | void;
  onCancel: () => void;
}

export const PostEditorView: React.FC<PostEditorViewProps> = ({ app, initialTab = 'guide', onSave, onCancel }) => {
  const { showAlert } = useAlert();
  const { user, requireAuth } = useAuth();
  const [activeTab, setActiveTab] = useState<'info' | 'media' | 'guide' | 'pricing'>(initialTab);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastResult, setLastResult] = useState<DropPersistResult | null>(null);

  const [name, setName] = useState(app.name);
  const [tagline, setTagline] = useState(app.tagline);
  const [liveUrl, setLiveUrl] = useState(app.liveUrl || '');
  const [description, setDescription] = useState(app.description);
  const [version, setVersion] = useState(app.version);
  const [price, setPrice] = useState(app.price);
  const initialRoyaltyBps = app.royaltyBps ?? app.royalty_bps;
  const [royaltyPercent, setRoyaltyPercent] = useState<number>(
    typeof initialRoyaltyBps === 'number' ? initialRoyaltyBps / 100 : 10
  );
  const isFork = typeof app.forkDepth === 'number' && app.forkDepth > 0;
  const [tagsStr, setTagsStr] = useState(app.tags?.join(', '));
  const [screenshots, setScreenshots] = useState<string[]>(app.screenshots);
  const [newImageUrl, setNewImageUrl] = useState('');

  const handleCopy = (text: string, index: number) => {
    playClickSound();
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleAddImage = () => {
    if (!newImageUrl.trim()) return;
    setScreenshots([...screenshots, newImageUrl.trim()]);
    setNewImageUrl('');
  };

  const handleRemoveImage = (idx: number) => {
    setScreenshots(screenshots.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!name || name.trim().length < 3) {
      showAlert("Application name must be at least 3 characters.", "Validation Error", "warning");
      return;
    }
    if (!version || !version.match(/^v?\d+\.\d+\.\d+$/)) {
      showAlert("Version must follow valid semver format (e.g. v1.0.0 or 2.1.0).", "Validation Error", "warning");
      return;
    }

    requireAuth('submit drop to HOTWIRE', async () => {
      try {
        setIsSaving(true);

        const clampedRoyaltyPercent = Math.max(0, Math.min(100, Number(royaltyPercent) || 0));
        const royaltyBps = Math.round(clampedRoyaltyPercent * 100);

        const updated: AppListing = {
          ...app,
          author: user?.username || app.author || 'guest',
          authorAvatar: user?.avatar || app.authorAvatar || '⚡',
          creator: user?.username || app.creator || 'guest',
          creatorAvatar: user?.avatar || app.creatorAvatar || '⚡',
          name: name.trim(),
          tagline: tagline.trim(),
          liveUrl: liveUrl.trim() || undefined,
          description: description.trim(),
          version: version.trim(),
          price,
          royaltyBps,
          tags: (tagsStr || '').split(',').map((t: string) => t.trim()).filter(Boolean),
          screenshots,
          binaries: {
            ...app.binaries,
            web: liveUrl.trim() || undefined
          }
        };
        const result = await onSave(updated);
        setLastResult(result || null);
      } catch (err: any) {
        showAlert(
          `Drop persistence failed: ${err.message || 'Server rejected drop submission.'}`,
          "Persistence Error",
          "error"
        );
      } finally {
        setIsSaving(false);
      }
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#ece9d8] font-tahoma text-sm">
      <div className="bg-w95-blue text-white p-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-base">Creator Studio &middot; Post Editor</span>
          <span className="text-xs text-blue-200 font-mono">[Editing: {app.id || 'New Drop'}]</span>
          <span className="text-xs text-emerald-300 font-mono bg-blue-950 px-2 py-0.5 rounded border border-blue-600">
            Publishing as: <strong>@{user?.username || app.author || 'guest'}</strong>
          </span>
        </div>

        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setActiveTab('guide')}
            className={`btn-w95 text-xs py-1 px-3 font-bold ${activeTab === 'guide' ? 'btn-w95-primary' : 'text-black'}`}
          >
            🚀 How to Get Started (Git &amp; SLOP)
          </button>
          <button
            onClick={() => setActiveTab('info')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'info' ? 'btn-w95-primary' : 'text-black'}`}
          >
            1. App Info
          </button>
          <button
            onClick={() => setActiveTab('media')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'media' ? 'btn-w95-primary' : 'text-black'}`}
          >
            2. Screenshots ({screenshots.length})
          </button>
          <button
            onClick={() => setActiveTab('pricing')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'pricing' ? 'btn-w95-primary' : 'text-black'}`}
          >
            3. Pricing &amp; Splits
          </button>
        </div>
      </div>

      <div className="flex-1 bg-white border-2 border-gray-800 p-4 overflow-y-auto">
        {activeTab === 'guide' && (
          <div className="space-y-5 max-w-3xl mx-auto py-2">
            <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-blue-900 text-white p-4 rounded-lg shadow-md border border-blue-700">
              <h2 className="text-lg font-black tracking-tight mb-1 flex items-center gap-2">
                ⚡ The Maker Guide: From Local Repo to 12:01 AM Drop
              </h2>
              <p className="text-xs text-blue-200 leading-relaxed">
                Follow the standard developer flow to initialize your project, configure optional persistence, run verification proofs, and deploy to HOTWIRE.
              </p>
            </div>

            <div className="border-2 border-gray-700 rounded-lg p-4 bg-gray-50 shadow-sm space-y-2">
              <div className="flex items-center justify-between border-b border-gray-300 pb-2">
                <h3 className="font-bold text-sm text-gray-900 flex items-center gap-2">
                  <span className="bg-blue-800 text-white px-2 py-0.5 rounded text-xs font-mono">1</span>
                  🛠️ Install the <code className="bg-gray-200 px-1.5 py-0.5 rounded font-mono text-black">slop</code> CLI Tool
                </h3>
                <button
                  onClick={() => handleCopy("npm install -g @nates-software/slop && slop --help", 1)}
                  className="btn-w95 text-xs py-0.5 px-2 flex items-center gap-1 font-mono"
                >
                  {copiedIndex === 1 ? <Check size={11} className="text-green-700" /> : <Copy size={11} />}
                  <span>{copiedIndex === 1 ? 'Copied' : 'Copy Commands'}</span>
                </button>
              </div>
              <p className="text-xs text-gray-600">
                Install the SLOP CLI and confirm it's on your path:
              </p>
              <pre className="bg-black text-green-400 p-3 rounded font-mono text-xs overflow-x-auto leading-relaxed">
$ npm install -g @nates-software/slop
$ slop --help</pre>
            </div>

            <div className="border-2 border-gray-700 rounded-lg p-4 bg-gray-50 shadow-sm space-y-2">
              <div className="flex items-center justify-between border-b border-gray-300 pb-2">
                <h3 className="font-bold text-sm text-gray-900 flex items-center gap-2">
                  <span className="bg-blue-800 text-white px-2 py-0.5 rounded text-xs font-mono">2</span>
                  🎮 Create or Link Your Local Project (<code className="font-mono text-xs">~/Projects/{app.id || 'dronehunter'}</code>)
                </h3>
              </div>
              <p className="text-xs text-gray-600">
                Initialize your application with open source shareware metadata (apps are runtime and storage independent):
              </p>
              <ul className="text-xs text-gray-700 space-y-1 pl-4 list-disc font-sans">
                <li><b>Project Directory:</b> <code className="bg-gray-200 px-1 py-0.2 rounded font-mono text-[11px]">{app.id || 'dronehunter'}</code></li>
                <li><b>Configuration:</b> <code className="bg-gray-200 px-1 py-0.2 rounded font-mono text-[11px]">slop.config.json</code> (declaring appId, title, and screenshots)</li>
                <li><b>Database Schema (Optional):</b> <code className="bg-gray-200 px-1 py-0.2 rounded font-mono text-[11px]">migrations/001_initial_scores.sql</code> (for apps utilizing local SQLite)</li>
              </ul>
            </div>

            <div className="border-2 border-gray-700 rounded-lg p-4 bg-gray-50 shadow-sm space-y-2">
              <div className="flex items-center justify-between border-b border-gray-300 pb-2">
                <h3 className="font-bold text-sm text-gray-900 flex items-center gap-2">
                  <span className="bg-blue-800 text-white px-2 py-0.5 rounded text-xs font-mono">3</span>
                  🚀 Push to HOTWIRE via <code className="bg-gray-200 px-1.5 py-0.5 rounded font-mono text-black">slop push</code>
                </h3>
                <button
                  onClick={() => handleCopy(`cd ~/Projects/${app.id || 'dronehunter'} && git init && git add -A && git commit -m "feat: initial commit" && slop push`, 3)}
                  className="btn-w95 text-xs py-0.5 px-2 flex items-center gap-1 font-mono"
                >
                  {copiedIndex === 3 ? <Check size={11} className="text-green-700" /> : <Copy size={11} />}
                  <span>{copiedIndex === 3 ? 'Copied' : 'Copy Commands'}</span>
                </button>
              </div>
              <p className="text-xs text-gray-600">
                Run standard Git initialization and dispatch the drop to our remote forge:
              </p>
              <pre className="bg-black text-green-400 p-3 rounded font-mono text-xs overflow-x-auto leading-relaxed">
$ cd ~/Projects/{app.id || 'dronehunter'}
$ git init && git add -A && git commit -m "feat: initial commit for {app.name || 'DroneHunter 95'}"
$ slop push

Output:
  ┌────────────────────────────────────────────────────────────┐
  │ ⚡ SLOP CLI v1.0.0 — fork code, fork revenue                │
  └────────────────────────────────────────────────────────────┘
  [GITSMITH] Initiating 'slop push' from local repository...
    ✔ Checking runtime configuration &amp; storage ({app.sqlitePath || 'runtime independent'})...
    ✔ Running pre-push verification tests... (100% Green)
    ✔ Packing CAS commit SHA: 5cdee6f
    ✔ Pushing drop to HOTWIRE (https://nates-software.pages.dev/api/drops)...
  🚀 Deployed live to subdomain in 1.18s!</pre>
            </div>

            <div className="border-2 border-gray-700 rounded-lg p-4 bg-gray-50 shadow-sm space-y-2">
              <div className="flex items-center justify-between border-b border-gray-300 pb-2">
                <h3 className="font-bold text-sm text-gray-900 flex items-center gap-2">
                  <span className="bg-blue-800 text-white px-2 py-0.5 rounded text-xs font-mono">4</span>
                  🕹️ Live in HOTWIRE &amp; Moddable via <code className="bg-gray-200 px-1.5 py-0.5 rounded font-mono text-black">slop fork</code>
                </h3>
              </div>
              <p className="text-xs text-gray-600">
                Your drop is now indexed on HOTWIRE with live subdomain hosting at <code className="font-mono text-blue-800">https://{app.id || 'dronehunter'}.pages.dev</code>.
              </p>
              <pre className="bg-black text-green-400 p-3 rounded font-mono text-xs overflow-x-auto leading-relaxed">
# Clone into isolated worktree, configure runtime/storage, and bind port:
$ slop fork {app.creator || 'nate'}/{app.id || 'dronehunter'}</pre>
            </div>
          </div>
        )}

        {activeTab === 'info' && (
          <div className="space-y-3 max-w-2xl mx-auto">
            <div className="bg-slate-50 border border-slate-300 p-2.5 rounded flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2">
                <span className="text-lg">{user?.avatar || app.authorAvatar || '⚡'}</span>
                <div>
                  <span className="text-slate-500 text-[10px] block">MAKER ATTRIBUTION</span>
                  <span className="font-bold text-slate-800">@{user?.username || app.author || 'guest'}</span>
                  {user?.username && <span className="text-emerald-600 text-[10px] ml-1.5 font-sans font-bold">(authenticated account)</span>}
                </div>
              </div>
              <div className="text-[11px] text-slate-500 font-sans">
                {user?.username ? 'Drop will be registered to your profile.' : 'Sign in to link drop to your verified profile.'}
              </div>
            </div>

            <div>
              <label className="font-bold text-gray-800 block mb-1">Application Name:</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-2 border-2 border-gray-600 font-bold text-sm bg-gray-50 focus:bg-white"
              />
            </div>

            <div>
              <label className="font-bold text-gray-800 block mb-1">One-Line Tagline:</label>
              <input
                type="text"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                className="w-full p-2 border border-gray-400 text-xs bg-gray-50 focus:bg-white"
                placeholder="e.g. Private in-browser image preparation utility"
              />
            </div>

            <div>
              <label className="font-bold text-gray-800 block mb-1 flex items-center justify-between">
                <span>🌐 Live URL (if already running live):</span>
                <span className="text-[11px] font-normal text-blue-700">Optional · Custom domain or production endpoint</span>
              </label>
              <input
                type="url"
                value={liveUrl}
                onChange={(e) => setLiveUrl(e.target.value)}
                className="w-full p-2 border-2 border-blue-600 font-mono text-xs bg-blue-50/40 focus:bg-white rounded"
                placeholder="https://myapp.example"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                If your app is already hosted externally on a VPS, DreamHost, or custom server, enter the live URL so the "▷ Live App" button links directly to it.
              </p>
            </div>

            <div>
              <label className="font-bold text-gray-800 block mb-1">Detailed Markdown Description:</label>
              <textarea
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full p-2 border border-gray-400 font-mono text-xs bg-gray-50 focus:bg-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-gray-800 block mb-1">Release Version Tag:</label>
                <input
                  type="text"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  className="w-full p-2 border border-gray-400 font-mono text-xs"
                />
              </div>
              <div>
                <label className="font-bold text-gray-800 block mb-1">Category Tags (comma separated):</label>
                <input
                  type="text"
                  value={tagsStr}
                  onChange={(e) => setTagsStr(e.target.value)}
                  className="w-full p-2 border border-gray-400 text-xs"
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'media' && (
          <div className="space-y-4 max-w-3xl mx-auto">
            <div>
              <div className="font-bold text-base text-w95-blue mb-1">Visual Media &amp; Screenshot Showcase</div>
              <p className="text-gray-600 text-xs">
                Upload or paste image URLs for your application. Buyers will flip through these screenshots in the interactive preview gallery.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {screenshots.map((url, idx) => (
                <div key={idx} className="border-2 border-gray-700 bg-gray-100 rounded overflow-hidden relative group">
                  <img src={url} alt={`Preview ${idx + 1}`} className="w-full h-32 object-cover" />
                  <div className="p-1.5 bg-white flex justify-between items-center">
                    <span className="text-[11px] font-bold text-gray-700 font-mono">Slide #{idx + 1}</span>
                    <button
                      onClick={() => handleRemoveImage(idx)}
                      className="text-red-600 hover:text-red-800 p-1"
                      title="Remove image"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-blue-50 border-2 border-w95-blue p-3 rounded">
              <label className="font-bold text-w95-blue block mb-1 text-xs">Add Screenshot URL (or upload):</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="https://images.unsplash.com/..."
                  value={newImageUrl}
                  onChange={(e) => setNewImageUrl(e.target.value)}
                  className="flex-1 p-2 border border-gray-400 text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={handleAddImage}
                  className="btn-w95 btn-w95-primary px-3 py-1 text-xs flex items-center gap-1"
                >
                  <Plus size={13} /> Add Screenshot
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'pricing' && (
          <div className="space-y-4 max-w-2xl mx-auto">
            <div>
              <div className="font-bold text-base text-w95-blue mb-1">Commercial Shareware Pricing &amp; Lineage Splits</div>
              <p className="text-gray-600 text-xs">
                Set registered software copy pricing and the descendant fork royalty rate.
              </p>
            </div>

            {lastResult && (
              <div className={`border-2 p-3 rounded text-xs space-y-1 ${
                lastResult.productStatus === 'active'
                  ? 'bg-emerald-50 border-emerald-400 text-emerald-900'
                  : 'bg-amber-50 border-amber-400 text-amber-900'
              }`}>
                <div className="font-bold flex items-center gap-1.5">
                  {lastResult.productStatus === 'active' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                  Honest product state after last save:
                  <span className="font-mono uppercase">{lastResult.productStatus || 'draft'}</span>
                </div>
                <div className="text-[11px] leading-relaxed">{lastResult.message}</div>
                {lastResult.repositoryProvisioned && (
                  <div className="text-[11px] font-mono">A new forkable repository was provisioned for this drop.</div>
                )}
                {lastResult.productStatus !== 'active' && (
                  <div className="text-[11px]">
                    This app is <b>not yet purchasable</b>. It stays a draft until source is pushed to GITSMITH and
                    built by RIG into a deployable revision — never fake-flipped to "active" before that's true.
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-gray-800 block mb-1">Registered Copy Price (USD):</label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={price}
                    onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
                    className="w-full p-2 border-2 border-gray-600 font-bold text-base text-green-800 bg-green-50 font-mono"
                  />
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  What a buyer pays once to own this app. Set your own — the $15 default is just a starting point.
                </p>
              </div>

              <div>
                <label className="font-bold text-gray-800 block mb-1">Your Royalty Rate (%):</label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={royaltyPercent}
                    onChange={(e) => setRoyaltyPercent(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                    className="w-full p-2 border-2 border-gray-600 font-bold text-base text-w95-blue bg-blue-50 font-mono"
                  />
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  What anyone who forks this app owes you on every sale of their version — frozen the day they fork, forever.
                </p>
                {isFork ? (
                  <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-300 px-2 py-1.5 rounded">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    <span>
                      This is a fork — makers above you already hold frozen royalty liens on every sale. Your rate stacks on top of theirs, and the combined stack is capped at 100%. If your fork's total lien would exceed 100%, GITSMITH blocks the next fork down the line.
                    </span>
                  </div>
                ) : (
                  <div className="mt-1.5 text-[11px] text-gray-600 bg-blue-50 border border-blue-200 px-2 py-1.5 rounded">
                    This is an original app — you keep 90%, platform 10%. Your royalty applies to anyone who forks and resells.
                  </div>
                )}
              </div>
            </div>

            <div className="bg-blue-50 border-2 border-w95-blue p-3.5 rounded space-y-2 text-xs">
              <div className="font-bold text-w95-blue text-sm flex items-center gap-1.5">
                <CheckCircle2 size={16} className="text-green-700" /> What you earn:
              </div>
              <p className="text-gray-700 leading-relaxed">
                On a <b>${Math.max(0, Number(price) || 0).toFixed(0)}</b> sale of your own app, you keep{' '}
                <b className="text-green-800">${(Math.max(0, Number(price) || 0) * 0.9).toFixed(2)}</b> (the platform takes a flat 10%).
                When someone forks it and sells their version, you earn{' '}
                <b className="text-w95-blue">{Math.max(0, Math.min(100, Number(royaltyPercent) || 0))}%</b> of that sale —{' '}
                and a fork-of-a-fork still pays you, frozen at the rate above. It deposits to your connected Stripe account automatically.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-w95-gray p-3 border-t-2 border-white flex justify-between items-center">
        <button
          onClick={onCancel}
          className="btn-w95 px-4 py-1.5 text-xs font-bold"
        >
          Cancel Edits
        </button>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className={`btn-w95 btn-w95-primary px-6 py-1.5 text-xs font-bold flex items-center gap-1.5 shadow-md ${
            isSaving ? 'opacity-70 cursor-wait' : ''
          }`}
        >
          <Save size={13} />
          <span>{isSaving ? 'Saving to D1...' : 'Save & Update Live Listing'}</span>
        </button>
      </div>
    </div>
  );
};
