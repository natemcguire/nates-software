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
    <div className="flex flex-col h-full bg-[#c0c0c0] font-tahoma text-xs select-none">
      <div className="bg-[#000080] text-white px-3 py-2 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-sm">Creator Studio &middot; Post Editor</span>
          <span className="text-[11px] text-blue-200 font-mono">[Editing: {app.id || 'New Drop'}]</span>
          <span className="text-[10px] text-white font-mono bg-blue-900 px-1.5 py-0.5 border border-blue-400">
            Publishing as: <strong>@{user?.username || app.author || 'guest'}</strong>
          </span>
        </div>

        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setActiveTab('guide')}
            className={`win95-btn px-2.5 py-1 text-xs font-bold ${activeTab === 'guide' ? 'bg-white text-blue-900 border-2' : 'bg-[#dfdfdf] text-black'}`}
          >
            🚀 How to Get Started (Git &amp; SLOP)
          </button>
          <button
            onClick={() => setActiveTab('info')}
            className={`win95-btn px-2.5 py-1 text-xs font-bold ${activeTab === 'info' ? 'bg-white text-blue-900 border-2' : 'bg-[#dfdfdf] text-black'}`}
          >
            1. App Info
          </button>
          <button
            onClick={() => setActiveTab('media')}
            className={`win95-btn px-2.5 py-1 text-xs font-bold ${activeTab === 'media' ? 'bg-white text-blue-900 border-2' : 'bg-[#dfdfdf] text-black'}`}
          >
            2. Screenshots ({screenshots.length})
          </button>
          <button
            onClick={() => setActiveTab('pricing')}
            className={`win95-btn px-2.5 py-1 text-xs font-bold ${activeTab === 'pricing' ? 'bg-white text-blue-900 border-2' : 'bg-[#dfdfdf] text-black'}`}
          >
            3. Pricing &amp; Splits
          </button>
        </div>
      </div>

      <div className="flex-1 bg-[#ece9d8] win95-field p-4 overflow-y-auto">
        {activeTab === 'guide' && (
          <div className="space-y-4 max-w-3xl mx-auto py-1">
            <div className="bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] p-3 text-black">
              <h2 className="text-xs font-bold tracking-tight mb-1 flex items-center gap-2">
                ⚡ The Maker Guide: From Local Repo to 12:01 AM Drop
              </h2>
              <p className="text-[11px] text-gray-700 leading-relaxed">
                The real flow: install the CLI, log in, connect a repo, push your code, then publish. Each step below only does what it says.
              </p>
            </div>

            <div className="border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] bg-[#c0c0c0] space-y-2">
              <div className="flex items-center justify-between border-b border-[#808080] bg-[#dfdfdf] px-3 py-1.5">
                <h3 className="font-bold text-xs text-black flex items-center gap-2">
                  <span className="bg-[#000080] text-white px-1.5 py-0.5 text-[10px] font-mono font-bold">1</span>
                  Install the <code className="win95-field bg-white px-1 py-0.5 font-mono text-black">slop</code> CLI
                </h3>
                <button
                  onClick={() => handleCopy("npm install -g @nates-software/slop\nslop --help", 1)}
                  className="win95-btn text-xs py-0.5 px-2 flex items-center gap-1 font-mono bg-[#dfdfdf] hover:bg-white text-black"
                >
                  {copiedIndex === 1 ? <Check size={11} className="text-green-700" /> : <Copy size={11} />}
                  <span>{copiedIndex === 1 ? 'Copied' : 'Copy Commands'}</span>
                </button>
              </div>
              <p className="text-xs text-black px-3">
                Install the CLI globally and confirm it's on your path:
              </p>
              <pre className="bg-white win95-field text-black mx-3 mb-3 p-2.5 font-mono text-xs overflow-x-auto leading-relaxed">{"$ npm install -g @nates-software/slop\n$ slop --help"}</pre>
            </div>

            <div className="border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] bg-[#c0c0c0] space-y-2">
              <div className="flex items-center justify-between border-b border-[#808080] bg-[#dfdfdf] px-3 py-1.5">
                <h3 className="font-bold text-xs text-black flex items-center gap-2">
                  <span className="bg-[#000080] text-white px-1.5 py-0.5 text-[10px] font-mono font-bold">2</span>
                  Log in
                </h3>
                <button
                  onClick={() => handleCopy("slop login", 2)}
                  className="win95-btn text-xs py-0.5 px-2 flex items-center gap-1 font-mono bg-[#dfdfdf] hover:bg-white text-black"
                >
                  {copiedIndex === 2 ? <Check size={11} className="text-green-700" /> : <Copy size={11} />}
                  <span>{copiedIndex === 2 ? 'Copied' : 'Copy Commands'}</span>
                </button>
              </div>
              <p className="text-xs text-black px-3">
                Generate a CLI token in <b>PROFILE</b>, then authenticate:
              </p>
              <pre className="bg-white win95-field text-black mx-3 mb-3 p-2.5 font-mono text-xs overflow-x-auto leading-relaxed">$ slop login</pre>
            </div>

            <div className="border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] bg-[#c0c0c0] space-y-2">
              <div className="flex items-center justify-between border-b border-[#808080] bg-[#dfdfdf] px-3 py-1.5">
                <h3 className="font-bold text-xs text-black flex items-center gap-2">
                  <span className="bg-[#000080] text-white px-1.5 py-0.5 text-[10px] font-mono font-bold">3</span>
                  Create + connect the repo
                </h3>
                <button
                  onClick={() => handleCopy("slop init <app-id>", 3)}
                  className="win95-btn text-xs py-0.5 px-2 flex items-center gap-1 font-mono bg-[#dfdfdf] hover:bg-white text-black"
                >
                  {copiedIndex === 3 ? <Check size={11} className="text-green-700" /> : <Copy size={11} />}
                  <span>{copiedIndex === 3 ? 'Copied' : 'Copy Commands'}</span>
                </button>
              </div>
              <p className="text-xs text-black px-3">
                Creates the forge repo and configures the <code className="win95-field bg-white px-1 py-0.5 font-mono text-[11px]">slop</code> remote automatically when you're logged in:
              </p>
              <pre className="bg-white win95-field text-black mx-3 mb-3 p-2.5 font-mono text-xs overflow-x-auto leading-relaxed">$ slop init &lt;app-id&gt;</pre>
            </div>

            <div className="border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] bg-[#c0c0c0] space-y-2">
              <div className="flex items-center justify-between border-b border-[#808080] bg-[#dfdfdf] px-3 py-1.5">
                <h3 className="font-bold text-xs text-black flex items-center gap-2">
                  <span className="bg-[#000080] text-white px-1.5 py-0.5 text-[10px] font-mono font-bold">4</span>
                  Push your code
                </h3>
                <button
                  onClick={() => handleCopy('git add -A && git commit -m "feat: initial"\nslop push', 4)}
                  className="win95-btn text-xs py-0.5 px-2 flex items-center gap-1 font-mono bg-[#dfdfdf] hover:bg-white text-black"
                >
                  {copiedIndex === 4 ? <Check size={11} className="text-green-700" /> : <Copy size={11} />}
                  <span>{copiedIndex === 4 ? 'Copied' : 'Copy Commands'}</span>
                </button>
              </div>
              <p className="text-xs text-black px-3">
                <code className="win95-field bg-white px-1 py-0.5 font-mono text-[11px]">slop push</code> pushes the commit and verifies the ref — it does not publish a drop:
              </p>
              <pre className="bg-white win95-field text-black mx-3 mb-3 p-2.5 font-mono text-xs overflow-x-auto leading-relaxed">{'$ git add -A && git commit -m "feat: initial"\n$ slop push'}</pre>
            </div>

            <div className="border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] bg-[#c0c0c0] space-y-2">
              <div className="flex items-center justify-between border-b border-[#808080] bg-[#dfdfdf] px-3 py-1.5">
                <h3 className="font-bold text-xs text-black flex items-center gap-2">
                  <span className="bg-[#000080] text-white px-1.5 py-0.5 text-[10px] font-mono font-bold">5</span>
                  Publish the drop
                </h3>
                <button
                  onClick={() => handleCopy("slop drop --price=15", 5)}
                  className="win95-btn text-xs py-0.5 px-2 flex items-center gap-1 font-mono bg-[#dfdfdf] hover:bg-white text-black"
                >
                  {copiedIndex === 5 ? <Check size={11} className="text-green-700" /> : <Copy size={11} />}
                  <span>{copiedIndex === 5 ? 'Copied' : 'Copy Commands'}</span>
                </button>
              </div>
              <p className="text-xs text-black px-3">
                Publish from the CLI, or use the <b>App Info</b> tab of this editor:
              </p>
              <pre className="bg-white win95-field text-black mx-3 mb-3 p-2.5 font-mono text-xs overflow-x-auto leading-relaxed">$ slop drop --price=15</pre>
              <p className="text-[11px] text-gray-700 px-3 pb-3 leading-relaxed">
                Your app goes live at <code className="font-mono text-blue-900 font-bold">https://&lt;app-id&gt;.nates-software.com</code> only after a verified build (deployable) — publishing the drop alone doesn't deploy it.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'info' && (
          <div className="space-y-3 max-w-2xl mx-auto py-1">
            <div className="bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] p-2.5 flex items-center justify-between text-xs font-mono text-black">
              <div className="flex items-center gap-2">
                <span className="text-lg">{user?.avatar || app.authorAvatar || '⚡'}</span>
                <div>
                  <span className="text-gray-700 text-[10px] block">MAKER ATTRIBUTION</span>
                  <span className="font-bold text-black">@{user?.username || app.author || 'guest'}</span>
                  {user?.username && <span className="text-emerald-800 text-[10px] ml-1.5 font-sans font-bold">(authenticated account)</span>}
                </div>
              </div>
              <div className="text-[11px] text-gray-700 font-sans">
                {user?.username ? 'Drop will be registered to your profile.' : 'Sign in to link drop to your verified profile.'}
              </div>
            </div>

            <div>
              <label className="font-bold text-black block mb-1 text-xs">Application Name:</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full win95-field bg-white text-black p-1.5 font-bold text-xs focus:outline-none"
              />
            </div>

            <div>
              <label className="font-bold text-black block mb-1 text-xs">One-Line Tagline:</label>
              <input
                type="text"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                className="w-full win95-field bg-white text-black p-1.5 text-xs focus:outline-none"
                placeholder="e.g. Private in-browser image preparation utility"
              />
            </div>

            <div>
              <label className="font-bold text-black block mb-1 text-xs flex items-center justify-between">
                <span>🌐 Live URL (if already running live):</span>
                <span className="text-[11px] font-normal text-blue-900">Optional · Custom domain or production endpoint</span>
              </label>
              <input
                type="url"
                value={liveUrl}
                onChange={(e) => setLiveUrl(e.target.value)}
                className="w-full win95-field bg-white text-black p-1.5 font-mono text-xs focus:outline-none"
                placeholder="https://myapp.example"
              />
              <p className="text-[11px] text-gray-600 mt-1">
                If your app is already hosted externally on a VPS, DreamHost, or custom server, enter the live URL so the "▷ Live App" button links directly to it.
              </p>
            </div>

            <div>
              <label className="font-bold text-black block mb-1 text-xs">Detailed Markdown Description:</label>
              <textarea
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full win95-field bg-white text-black p-1.5 font-mono text-xs focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-black block mb-1 text-xs">Release Version Tag:</label>
                <input
                  type="text"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  className="w-full win95-field bg-white text-black p-1.5 font-mono text-xs focus:outline-none"
                />
              </div>
              <div>
                <label className="font-bold text-black block mb-1 text-xs">Category Tags (comma separated):</label>
                <input
                  type="text"
                  value={tagsStr}
                  onChange={(e) => setTagsStr(e.target.value)}
                  className="w-full win95-field bg-white text-black p-1.5 text-xs focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'media' && (
          <div className="space-y-4 max-w-3xl mx-auto py-1">
            <div>
              <div className="font-bold text-sm text-black mb-1">Visual Media &amp; Screenshot Showcase</div>
              <p className="text-gray-700 text-xs">
                Upload or paste image URLs for your application. Buyers will flip through these screenshots in the interactive preview gallery.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {screenshots.map((url, idx) => (
                <div key={idx} className="border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] bg-[#c0c0c0] p-1 overflow-hidden relative group">
                  <img src={url} alt={`Preview ${idx + 1}`} className="w-full h-32 object-cover win95-field bg-white" />
                  <div className="p-1.5 bg-[#dfdfdf] flex justify-between items-center mt-1 border-t border-[#808080]">
                    <span className="text-[11px] font-bold text-black font-mono">Slide #{idx + 1}</span>
                    <button
                      onClick={() => handleRemoveImage(idx)}
                      className="text-red-700 hover:text-red-900 p-0.5 win95-btn bg-[#dfdfdf]"
                      title="Remove image"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] p-3">
              <label className="font-bold text-black block mb-1 text-xs">Add Screenshot URL (or upload):</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="https://images.unsplash.com/..."
                  value={newImageUrl}
                  onChange={(e) => setNewImageUrl(e.target.value)}
                  className="flex-1 win95-field bg-white text-black p-1.5 text-xs font-mono focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddImage}
                  className="win95-btn bg-[#dfdfdf] hover:bg-white text-black px-3 py-1 text-xs font-bold flex items-center gap-1 shrink-0"
                >
                  <Plus size={13} /> Add Screenshot
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'pricing' && (
          <div className="space-y-4 max-w-2xl mx-auto py-1">
            <div>
              <div className="font-bold text-sm text-black mb-1">Commercial Shareware Pricing &amp; Lineage Splits</div>
              <p className="text-gray-700 text-xs">
                Set registered software copy pricing and the descendant fork royalty rate.
              </p>
            </div>

            {lastResult && (
              <div className={`border-2 p-3 text-xs space-y-1 ${
                lastResult.productStatus === 'active'
                  ? 'bg-emerald-50 border-emerald-600 text-emerald-950'
                  : 'bg-amber-50 border-amber-600 text-amber-950'
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
                <label className="font-bold text-black block mb-1 text-xs">Registered Copy Price (USD):</label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={price}
                    onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
                    className="w-full win95-field bg-white p-1.5 font-bold text-sm text-green-900 font-mono focus:outline-none"
                  />
                </div>
                <p className="text-[11px] text-gray-700 mt-1">
                  What a buyer pays once to own this app. Set your own — the $15 default is just a starting point.
                </p>
              </div>

              <div>
                <label className="font-bold text-black block mb-1 text-xs">Your Royalty Rate (%):</label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={royaltyPercent}
                    onChange={(e) => setRoyaltyPercent(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                    className="w-full win95-field bg-white p-1.5 font-bold text-sm text-blue-900 font-mono focus:outline-none"
                  />
                </div>
                <p className="text-[11px] text-gray-700 mt-1">
                  What anyone who forks this app owes you on every sale of their version — frozen the day they fork, forever.
                </p>
                {isFork ? (
                  <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-950 bg-amber-100 border border-amber-400 px-2 py-1.5">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-700" />
                    <span>
                      This is a fork — makers above you already hold frozen royalty liens on every sale. Your rate stacks on top of theirs, and the combined stack is capped at 100%. If your fork's total lien would exceed 100%, GITSMITH blocks the next fork down the line.
                    </span>
                  </div>
                ) : (
                  <div className="mt-1.5 text-[11px] text-gray-800 bg-[#dfdfdf] border border-[#808080] px-2 py-1.5">
                    This is an original app — you keep 90%, platform 10%. Your royalty applies to anyone who forks and resells.
                  </div>
                )}
              </div>
            </div>

            <div className="bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] p-3 space-y-2 text-xs text-black">
              <div className="font-bold text-black text-xs flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-green-800" /> What you earn:
              </div>
              <p className="text-gray-800 leading-relaxed">
                On a <b>${Math.max(0, Number(price) || 0).toFixed(0)}</b> sale of your own app, you keep{' '}
                <b className="text-green-900">${(Math.max(0, Number(price) || 0) * 0.9).toFixed(2)}</b> (the platform takes a flat 10%).
                When someone forks it and sells their version, you earn{' '}
                <b className="text-blue-900">{Math.max(0, Math.min(100, Number(royaltyPercent) || 0))}%</b> of that sale —{' '}
                and a fork-of-a-fork still pays you, frozen at the rate above. It deposits to your connected Stripe account automatically.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-[#c0c0c0] p-2.5 border-t border-[#808080] flex justify-between items-center">
        <button
          onClick={onCancel}
          className="win95-btn bg-[#dfdfdf] hover:bg-white text-black px-4 py-1 text-xs font-bold"
        >
          Cancel Edits
        </button>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className={`win95-btn bg-[#000080] hover:bg-blue-800 text-white px-5 py-1 text-xs font-bold flex items-center gap-1.5 ${
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
