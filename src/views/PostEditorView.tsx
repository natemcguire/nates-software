import React, { useState } from 'react';
import { AppListing } from '../data/mockData';
import { Save, Plus, Trash2, CheckCircle2, Copy, Check } from 'lucide-react';
import { playClickSound } from '../lib/soundEngine';
import { useAlert } from '../context/AlertContext';

interface PostEditorViewProps {
  app: AppListing;
  onSave: (updatedApp: AppListing) => void;
  onCancel: () => void;
}

export const PostEditorView: React.FC<PostEditorViewProps> = ({ app, onSave, onCancel }) => {
  const { showAlert } = useAlert();
  const [activeTab, setActiveTab] = useState<'info' | 'media' | 'binaries' | 'guide' | 'pricing'>('guide');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const [name, setName] = useState(app.name);
  const [tagline, setTagline] = useState(app.tagline);
  const [liveUrl, setLiveUrl] = useState(app.liveUrl || '');
  const [description, setDescription] = useState(app.description);
  const [version, setVersion] = useState(app.version);
  const [price, setPrice] = useState(app.price);
  const [tagsStr, setTagsStr] = useState(app.tags?.join(', '));
  const [screenshots, setScreenshots] = useState<string[]>(app.screenshots);
  const [newImageUrl, setNewImageUrl] = useState('');

  const [macBinary, setMacBinary] = useState(app.binaries?.mac);
  const [winBinary, setWinBinary] = useState(app.binaries?.win);
  const [linuxBinary, setLinuxBinary] = useState(app.binaries?.linux);
  const [iosBinary, setIosBinary] = useState(app.binaries?.ios);

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

  const handleSave = () => {
    const updated: AppListing = {
      ...app,
      name,
      tagline,
      liveUrl: liveUrl.trim() || undefined,
      description,
      version,
      price,
      tags: (tagsStr || '').split(',').map((t: string) => t.trim()).filter(Boolean),
      screenshots,
      binaries: {
        mac: macBinary,
        win: winBinary,
        linux: linuxBinary,
        ios: iosBinary
      }
    };
    onSave(updated);
    showAlert("App listing and Git configuration updated successfully!", "Creator Studio", "success");
  };

  return (
    <div className="flex flex-col h-full bg-[#ece9d8] font-tahoma text-sm">
      {/* Editor Header Navigation */}
      <div className="bg-w95-blue text-white p-3 flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="font-bold text-base">Creator Studio &middot; Post Editor</span>
          <span className="text-xs text-blue-200 ml-2 font-mono">[Editing: {app.id || 'New Drop'}]</span>
        </div>

        {/* Tab Buttons */}
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
            onClick={() => setActiveTab('binaries')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'binaries' ? 'btn-w95-primary' : 'text-black'}`}
          >
            3. Binaries &amp; Builds
          </button>
          <button
            onClick={() => setActiveTab('pricing')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'pricing' ? 'btn-w95-primary' : 'text-black'}`}
          >
            4. Pricing &amp; Splits
          </button>
        </div>
      </div>

      {/* Editor Main Content Area */}
      <div className="flex-1 bg-white border-2 border-gray-800 p-4 overflow-y-auto">
        {/* Tab Guide: Complete 4-Step Git & SLOP Walkthrough */}
        {activeTab === 'guide' && (
          <div className="space-y-5 max-w-3xl mx-auto py-2">
            <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-blue-900 text-white p-4 rounded-lg shadow-md border border-blue-700">
              <h2 className="text-lg font-black tracking-tight mb-1 flex items-center gap-2">
                ⚡ The Sovereign Maker Guide: From Local Repo to 12:01 AM Drop
              </h2>
              <p className="text-xs text-blue-200 leading-relaxed">
                Follow the standard developer flow to initialize your project, mount a single-file SQLite database, run verification proofs, and deploy to HOTWIRE.
              </p>
            </div>

            {/* Step 1 */}
            <div className="border-2 border-gray-700 rounded-lg p-4 bg-gray-50 shadow-sm space-y-2">
              <div className="flex items-center justify-between border-b border-gray-300 pb-2">
                <h3 className="font-bold text-sm text-gray-900 flex items-center gap-2">
                  <span className="bg-blue-800 text-white px-2 py-0.5 rounded text-xs font-mono">1</span>
                  🛠️ Install the <code className="bg-gray-200 px-1.5 py-0.5 rounded font-mono text-black">slop</code> CLI Tool
                </h3>
                <button
                  onClick={() => handleCopy("mkdir -p ~/.local/bin && ln -sf /Volumes/MacMiniExtra/Projects/nates_software/bin/slop ~/.local/bin/slop && slop --help", 1)}
                  className="btn-w95 text-xs py-0.5 px-2 flex items-center gap-1 font-mono"
                >
                  {copiedIndex === 1 ? <Check size={11} className="text-green-700" /> : <Copy size={11} />}
                  <span>{copiedIndex === 1 ? 'Copied' : 'Copy Commands'}</span>
                </button>
              </div>
              <p className="text-xs text-gray-600">
                Install and symlink the official executable CLI binary to your user path:
              </p>
              <pre className="bg-black text-green-400 p-3 rounded font-mono text-xs overflow-x-auto leading-relaxed">
$ mkdir -p ~/.local/bin
$ ln -sf /Volumes/MacMiniExtra/Projects/nates_software/bin/slop ~/.local/bin/slop
$ slop --help</pre>
            </div>

            {/* Step 2 */}
            <div className="border-2 border-gray-700 rounded-lg p-4 bg-gray-50 shadow-sm space-y-2">
              <div className="flex items-center justify-between border-b border-gray-300 pb-2">
                <h3 className="font-bold text-sm text-gray-900 flex items-center gap-2">
                  <span className="bg-blue-800 text-white px-2 py-0.5 rounded text-xs font-mono">2</span>
                  🎮 Create or Link Your Local Project (<code className="font-mono text-xs">~/Projects/{app.id || 'dronehunter'}</code>)
                </h3>
              </div>
              <p className="text-xs text-gray-600">
                Initialize your application with sovereign shareware metadata and SQLite schema:
              </p>
              <ul className="text-xs text-gray-700 space-y-1 pl-4 list-disc font-sans">
                <li><b>Project Directory:</b> <code className="bg-gray-200 px-1 py-0.2 rounded font-mono text-[11px]">{app.id || 'dronehunter'}</code></li>
                <li><b>Configuration:</b> <code className="bg-gray-200 px-1 py-0.2 rounded font-mono text-[11px]">slop.config.json</code> (declaring appId, title, and screenshots)</li>
                <li><b>Database Schema:</b> <code className="bg-gray-200 px-1 py-0.2 rounded font-mono text-[11px]">migrations/001_initial_scores.sql</code> (creating tables in WAL mode)</li>
              </ul>
            </div>

            {/* Step 3 */}
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
  │ ⚡ SLOP CLI v1.0.0 (Sovereign Shareware &amp; AI Speed Shop)   │
  └────────────────────────────────────────────────────────────┘
  [GITSMITH] Initiating 'slop push' from local repository...
    ✔ Checking single-file SQLite database ({app.sqlitePath || '/data/dronehunter.sqlite'})... (PRAGMA journal_mode = WAL)
    ✔ Running pre-push verification tests... (100% Green)
    ✔ Packing CAS commit SHA: 5cdee6f
    ✔ Pushing drop to HOTWIRE (https://nates-software.pages.dev/api/drops)...
  🚀 Deployed live to sovereign subdomain in 1.18s!</pre>
            </div>

            {/* Step 4 */}
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
# Clone into isolated worktree, mount SQLite WAL, and bind micro-dyno port:
$ slop fork {app.creator || 'nate'}/{app.id || 'dronehunter'}</pre>
            </div>
          </div>
        )}

        {/* Tab 1: App Info */}
        {activeTab === 'info' && (
          <div className="space-y-3 max-w-2xl mx-auto">
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
                placeholder="e.g. AI Virtual Try-On Studio with Gemini Vision"
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
                placeholder="https://picfit.ai or https://myapp.com"
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

        {/* Tab 2: Screenshots */}
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

        {/* Tab 3: Binaries */}
        {activeTab === 'binaries' && (
          <div className="space-y-3 max-w-2xl mx-auto">
            <div>
              <div className="font-bold text-base text-w95-blue mb-1">Multi-Platform Compiled Artifacts</div>
              <p className="text-gray-600 text-xs">
                Provide download links or automated GitHub Actions / Cloudflare R2 build artifacts for native desktop and mobile platforms.
              </p>
            </div>

            <div>
              <label className="font-bold text-gray-800 block mb-1">🍎 macOS Universal (.dmg / .app):</label>
              <input
                type="text"
                value={macBinary}
                onChange={(e) => setMacBinary(e.target.value)}
                className="w-full p-2 border border-gray-400 font-mono text-xs"
              />
            </div>

            <div>
              <label className="font-bold text-gray-800 block mb-1">🪟 Windows x64 (.exe installer):</label>
              <input
                type="text"
                value={winBinary}
                onChange={(e) => setWinBinary(e.target.value)}
                className="w-full p-2 border border-gray-400 font-mono text-xs"
              />
            </div>

            <div>
              <label className="font-bold text-gray-800 block mb-1">🐧 Linux (.AppImage / .deb):</label>
              <input
                type="text"
                value={linuxBinary}
                onChange={(e) => setLinuxBinary(e.target.value)}
                className="w-full p-2 border border-gray-400 font-mono text-xs"
              />
            </div>

            <div>
              <label className="font-bold text-gray-800 block mb-1">📱 iOS / iPadOS (Apple TestFlight Link):</label>
              <input
                type="text"
                value={iosBinary}
                onChange={(e) => setIosBinary(e.target.value)}
                className="w-full p-2 border border-gray-400 font-mono text-xs"
              />
            </div>
          </div>
        )}

        {/* Tab 4: Pricing */}
        {activeTab === 'pricing' && (
          <div className="space-y-4 max-w-2xl mx-auto">
            <div>
              <div className="font-bold text-base text-w95-blue mb-1">Commercial Shareware Pricing &amp; Descendant Splits</div>
              <p className="text-gray-600 text-xs">
                Set registered software copy pricing and ancestor split policy. Descendant forks pay royalties down the lineage tree automatically.
              </p>
            </div>

            <div>
              <label className="font-bold text-gray-800 block mb-1">Registered Copy Price (USD):</label>
              <div className="relative">
                <input
                  type="text"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full p-2 border-2 border-gray-600 font-bold text-base text-green-800 bg-green-50 font-mono"
                />
              </div>
            </div>

            <div className="bg-blue-50 border-2 border-w95-blue p-3.5 rounded space-y-2 text-xs">
              <div className="font-bold text-w95-blue text-sm flex items-center gap-1.5">
                <CheckCircle2 size={16} className="text-green-700" /> Lineage Split Guarantee:
              </div>
              <p className="text-gray-700 leading-relaxed">
                When developers fork and monetize this application, you receive <b>20%</b> of all downstream registered sales automatically deposited to your connected Stripe account.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Editor Footer Actions */}
      <div className="bg-w95-gray p-3 border-t-2 border-white flex justify-between items-center">
        <button
          onClick={onCancel}
          className="btn-w95 px-4 py-1.5 text-xs font-bold"
        >
          Cancel Edits
        </button>

        <button
          onClick={handleSave}
          className="btn-w95 btn-w95-primary px-6 py-1.5 text-xs font-bold flex items-center gap-1.5 shadow-md"
        >
          <Save size={13} /> Save &amp; Update Live Listing
        </button>
      </div>
    </div>
  );
};
