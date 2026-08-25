import React, { useState } from 'react';
import { AppListing } from '../data/mockData';
import { Save, Plus, Trash2, CheckCircle2, DollarSign } from 'lucide-react';

interface PostEditorViewProps {
  app: AppListing;
  onSave: (updatedApp: AppListing) => void;
  onCancel: () => void;
}

export const PostEditorView: React.FC<PostEditorViewProps> = ({ app, onSave, onCancel }) => {
  const [activeTab, setActiveTab] = useState<'info' | 'media' | 'binaries' | 'pricing'>('info');

  const [name, setName] = useState(app.name);
  const [tagline, setTagline] = useState(app.tagline);
  const [description, setDescription] = useState(app.description);
  const [version, setVersion] = useState(app.version);
  const [price, setPrice] = useState(app.price);
  const [tagsStr, setTagsStr] = useState(app.tags.join(', '));
  const [screenshots, setScreenshots] = useState<string[]>(app.screenshots);
  const [newImageUrl, setNewImageUrl] = useState('');

  const [macBinary, setMacBinary] = useState(app.binaries.mac);
  const [winBinary, setWinBinary] = useState(app.binaries.win);
  const [linuxBinary, setLinuxBinary] = useState(app.binaries.linux);
  const [iosBinary, setIosBinary] = useState(app.binaries.ios);

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
      description,
      version,
      price,
      tags: tagsStr.split(',').map(t => t.trim()).filter(Boolean),
      screenshots,
      binaries: {
        mac: macBinary,
        win: winBinary,
        linux: linuxBinary,
        ios: iosBinary
      }
    };
    onSave(updated);
  };

  return (
    <div className="flex flex-col h-full bg-[#ece9d8] font-tahoma text-sm">
      {/* Editor Header Navigation */}
      <div className="bg-w95-blue text-white p-3 flex items-center justify-between">
        <div>
          <span className="font-bold text-base">Creator Studio &middot; Post Editor</span>
          <span className="text-xs text-blue-200 ml-2 font-mono">[Editing: {app.id}]</span>
        </div>

        {/* Tab Buttons */}
        <div className="flex gap-1">
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
            3. Binaries & Builds
          </button>
          <button
            onClick={() => setActiveTab('pricing')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'pricing' ? 'btn-w95-primary' : 'text-black'}`}
          >
            4. Pricing & Splits
          </button>
        </div>
      </div>

      {/* Editor Main Content Area */}
      <div className="flex-1 bg-white border-2 border-gray-800 p-4 overflow-y-auto">
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
              />
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

        {/* Tab 2: Screenshots & Visual Media */}
        {activeTab === 'media' && (
          <div className="space-y-4 max-w-3xl mx-auto">
            <div>
              <div className="font-bold text-base text-w95-blue mb-1">Visual Media & Screenshot Showcase</div>
              <p className="text-gray-600 text-xs">
                Upload or paste image URLs for your application. Buyers will flip through these screenshots in the interactive preview gallery.
              </p>
            </div>

            {/* Existing Screenshots Grid */}
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

            {/* Add New Screenshot URL */}
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

        {/* Tab 3: Binaries & Distribution */}
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

        {/* Tab 4: Pricing & Splits */}
        {activeTab === 'pricing' && (
          <div className="space-y-3 max-w-2xl mx-auto">
            <div>
              <div className="font-bold text-base text-w95-blue mb-1">Pricing, Royalties &amp; Descendant Splits</div>
              <p className="text-gray-600 text-xs">
                Set registered copy pricing and ancestor split policy. Descendant forks pay royalties down the lineage tree automatically.
              </p>
            </div>

            <div>
              <label className="font-bold text-gray-800 block mb-1">Registration Price:</label>
              <div className="flex items-center gap-2">
                <DollarSign size={16} className="text-green-700" />
                <input
                  type="text"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="flex-1 p-2 border-2 border-gray-600 font-bold text-sm"
                />
              </div>
            </div>

            <div className="bg-green-50 border border-green-300 p-3 rounded space-y-1">
              <div className="font-bold text-green-900 flex items-center gap-1.5">
                <CheckCircle2 size={14} /> Immutable Lineage Split Guarantee:
              </div>
              <p className="text-green-800 text-xs leading-relaxed">
                When buyers fork and monetize this application, you receive <b>20%</b> of all downstream registered sales automatically settled to your Stripe Connect account.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Editor Footer Action Controls */}
      <div className="p-3 border-t border-gray-400 bg-w95-gray flex justify-between items-center">
        <button onClick={onCancel} className="btn-w95 text-xs">
          Cancel Edits
        </button>

        <div className="flex gap-2">
          <button onClick={handleSave} className="btn-w95 btn-w95-primary px-4 py-1.5 text-xs flex items-center gap-1.5">
            <Save size={13} /> Save &amp; Update Live Listing
          </button>
        </div>
      </div>
    </div>
  );
};
