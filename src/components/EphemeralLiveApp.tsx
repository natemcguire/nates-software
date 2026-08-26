import React, { useState } from 'react';
import { AppListing } from '../data/mockData';
import { Play, Code, Cloud, Laptop, FileText, Check, Copy, ExternalLink, Shield, Layers, Database, Lock } from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';

interface EphemeralLiveAppProps {
  app: AppListing;
}

interface RepoFile {
  name: string;
  path: string;
  size: string;
  language: string;
  content: string;
}

const REPO_FILES: Record<string, RepoFile[]> = {
  'certified-mailer': [
    {
      name: 'README.md',
      path: 'README.md',
      size: '3.1 KB',
      language: 'markdown',
      content: `# Certified Mailer\n\nPrivate, operational-mail tooling kept separate from East Bay Projects and all marketing code.\n\nThe repository contains reusable code only. Case manifests, addresses, letters, proofs, API responses, and tracking numbers belong under \`private/\`, which Git ignores.\n\n## Prepared workflow\n\nFor a single letter, LetterStream is the practical default: upload the generated PDF, choose **Certified First-Class Letter**, add **Electronic Return Receipt (ERR)**, inspect the proof, and approve payment.\n\nLob is also supported for accounts whose plan permits Certified Mail. The CLI is safe by default: test mode uses \`LOB_API_TEST_KEY\`; live mode requires a live key plus an exact confirmation phrase.\n\n## Setup\n\n\`\`\`sh\npython3 -m venv .venv\n.venv/bin/pip install -e '.[test]'\n\`\`\`\n\nBuild a private letter from a private manifest:\n\n\`\`\`sh\n.venv/bin/python tools/build_dispute_letter.py \\\n  private/dispute.json \\\n  private/dispute-letter.docx\n\`\`\`\n\nFlatten verified PDF before sending (preserves pixels, prevents font metric substitutions):\n\n\`\`\`sh\n.venv/bin/python tools/flatten_pdf.py \\\n  private/dispute-letter.pdf \\\n  private/dispute-letter-mail.pdf\n\`\`\`\n\nValidate a mailing without calling an API:\n\n\`\`\`sh\n.venv/bin/certified-mailer validate \\\n  --manifest private/dispute.json \\\n  --pdf private/dispute-letter.pdf\n\`\`\``
    },
    {
      name: 'build_dispute_letter.py',
      path: 'tools/build_dispute_letter.py',
      size: '7.9 KB',
      language: 'python',
      content: `from __future__ import annotations\n\nimport json\nimport sys\nfrom datetime import date\nfrom pathlib import Path\nfrom docx import Document\n\ndef require(mapping: dict, key: str) -> str:\n    value = str(mapping.get(key, "")).strip()\n    if not value:\n        raise ValueError(f"missing required field: {key}")\n    return value\n\ndef format_date(value: str) -> str:\n    return date.fromisoformat(value).strftime("%B %-d, %Y")\n\ndef add_line(document: Document, text: str = "", *, bold: bool = False):\n    paragraph = document.add_paragraph()\n    run = paragraph.add_run(text)\n    run.bold = bold\n    return paragraph\n\ndef address_lines(address: dict) -> list[str]:\n    lines = [require(address, "name")]\n    if address.get("company"):\n        lines.append(str(address["company"]).strip())\n    lines.append(require(address, "address_line1"))\n    if address.get("address_line2"):\n        lines.append(str(address["address_line2"]).strip())\n    lines.append(f"{require(address, 'address_city')}, {require(address, 'address_state')} {require(address, 'address_zip')}")\n    return lines`
    },
    {
      name: 'flatten_pdf.py',
      path: 'tools/flatten_pdf.py',
      size: '1.8 KB',
      language: 'python',
      content: `from __future__ import annotations\n\nimport shutil\nimport subprocess\nimport sys\nimport tempfile\nfrom pathlib import Path\nimport img2pdf\n\nLETTER_POINTS = (img2pdf.in_to_pt(8.5), img2pdf.in_to_pt(11))\n\ndef flatten(source: Path, destination: Path, *, dpi: int = 300) -> None:\n    if not source.is_file() or source.read_bytes()[:5] != b"%PDF-":\n        raise ValueError(f"not a PDF: {source}")\n    if not shutil.which("pdftoppm"):\n        raise RuntimeError("pdftoppm is required")\n\n    with tempfile.TemporaryDirectory(prefix="certified-mailer-") as temp_dir:\n        prefix = Path(temp_dir) / "page"\n        subprocess.run(\n            ["pdftoppm", "-jpeg", "-jpegopt", "quality=95,progressive=n,optimize=y", "-r", str(dpi), str(source), str(prefix)],\n            check=True,\n            stdout=subprocess.DEVNULL,\n        )\n        pages = sorted(prefix.parent.glob("page-*.jpg"))\n        if not pages:\n            raise RuntimeError("PDF rasterization produced no pages")\n        layout = img2pdf.get_layout_fun(LETTER_POINTS)\n        flattened = img2pdf.convert([str(page) for page in pages], layout_fun=layout)\n\n    destination.parent.mkdir(parents=True, exist_ok=True)\n    destination.write_bytes(flattened)`
    },
    {
      name: 'pyproject.toml',
      path: 'pyproject.toml',
      size: '590 B',
      language: 'toml',
      content: `[build-system]\nrequires = ["setuptools>=61.0"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "certified-mailer"\nversion = "1.0.0"\ndescription = "Private USPS Certified Mailer & Dispute Preparation Engine"\nreadme = "README.md"\nrequires-python = ">=3.11"\ndependencies = [\n    "python-docx>=1.1.0",\n    "img2pdf>=0.5.1",\n    "requests>=2.31.0",\n    "pydantic>=2.5.0",\n]\n\n[project.optional-dependencies]\ntest = [\n    "pytest>=7.4.0",\n    "pytest-mock>=3.12.0",\n]`
    }
  ],
  picfitai: [
    {
      name: 'CLAUDE.md',
      path: 'CLAUDE.md',
      size: '14.1 KB',
      language: 'markdown',
      content: `# CLAUDE.md\n\nThis file provides guidance when working with PicFit.ai.\n\n## Architecture Overview\nPicFit.ai is an AI virtual try-on application powered by Google Gemini 2.5 Flash with local SQLite credits ledger.\n\n## Development Commands\n\`\`\`bash\n./start-local.sh  # Starts PHP server on http://localhost:8000\nphp debug.php     # System health check and configuration validation\n\`\`\`\n\n## Key Design Principles\n- Shared Hosting & Cloudflare Optimized\n- Single-file SQLite database with schema auto-creation\n- CSRF protection and token verification\n- Gemini API integration with combined vision prompt`
    },
    {
      name: 'generate.php',
      path: 'generate.php',
      size: '72.9 KB',
      language: 'php',
      content: `<?php\nrequire_once __DIR__ . '/bootstrap.php';\n\n$user = Session::getCurrentUser();\n$security = new Security();\n\nif ($_SERVER['REQUEST_METHOD'] === 'POST') {\n    $security->validateCsrfToken($_POST['csrf_token'] ?? '');\n    \n    $outfitId = $_POST['outfit_id'] ?? '';\n    $photoFile = $_FILES['user_photo'] ?? null;\n    \n    $db = Database::getInstance();\n    $credits = $db->getUserCredits($user['id']);\n    if ($credits < 1) {\n        die(json_encode(['error' => 'Insufficient credits. Upgrade plan to continue.']));\n    }\n    \n    $aiService = new AIService();\n    $result = $aiService->generateTryOn($photoFile, $outfitId);\n    \n    $db->deductCredit($user['id'], 1, 'Virtual Try-On Generation');\n    echo json_encode(['success' => true, 'image_url' => $result['url']]);\n}`
    },
    {
      name: 'config.php',
      path: 'config.php',
      size: '5.3 KB',
      language: 'php',
      content: `<?php\nclass Config {\n    private static $env = [];\n    \n    public static function load($path = __DIR__ . '/.env') {\n        if (file_exists($path)) {\n            $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);\n            foreach ($lines as $line) {\n                if (strpos($line, '#') === 0) continue;\n                list($k, $v) = explode('=', $line, 2);\n                self::$env[trim($k)] = trim($v, ' "');\n            }\n        }\n    }\n    \n    public static function get($key, $default = null) {\n        return self::$env[$key] ?? getenv($key) ?: $default;\n    }\n}`
    }
  ],
  dronehunter: [
    {
      name: 'index.html',
      path: 'index.html',
      size: '4.2 KB',
      language: 'html',
      content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <title>Drone Hunter — Arcade Shooter</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <div id="game-container">\n    <canvas id="gameCanvas" width="800" height="600"></canvas>\n  </div>\n  <script src="game.js"></script>\n</body>\n</html>`
    },
    {
      name: 'slop.config.json',
      path: 'slop.config.json',
      size: '587 B',
      language: 'json',
      content: `{\n  "appId": "dronehunter",\n  "name": "DroneHunter 95",\n  "version": "1.0.0",\n  "creator": "nate",\n  "type": "arcade-html5",\n  "database": "/data/dronehunter.sqlite",\n  "walMode": true,\n  "maxConcurrency": 10\n}`
    }
  ]
};

export const EphemeralLiveApp: React.FC<EphemeralLiveAppProps> = ({ app }) => {
  // Default mode: For scripts/CLI (certified-mailer) -> 'code'; for web apps -> 'live'; for full-stack -> 'deployer'
  const initialMode = app.id === 'certified-mailer' ? 'code' : app.id === 'picfitai' ? 'deployer' : 'live';
  const [viewMode, setViewMode] = useState<'live' | 'code' | 'deployer' | 'local'>(initialMode);
  
  // Code explorer state
  const files = REPO_FILES[app.id] || REPO_FILES['dronehunter'];
  const [selectedFile, setSelectedFile] = useState<RepoFile>(files[0]);
  const [copiedCode, setCopiedCode] = useState(false);

  // Local host bridge state
  const defaultLocalPort = app.id === 'picfitai' ? 8000 : app.id === 'certified-mailer' ? 8001 : 3004;
  const [localPort, setLocalPort] = useState(defaultLocalPort);
  const [isLocalConnected, setIsLocalConnected] = useState(false);

  // Cloudflare deployer state
  const [deployStep, setDeployStep] = useState<'review' | 'deploying' | 'complete'>('review');

  const handleCopyCode = () => {
    playClickSound();
    navigator.clipboard.writeText(selectedFile.content);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleDeployToCloudflare = () => {
    playClickSound();
    setDeployStep('deploying');
    setTimeout(() => {
      setDeployStep('complete');
      playSuccessChime();
    }, 1800);
  };

  const subdomainUrl = `https://${app.id}.nates-software.com`;

  return (
    <div className="h-full flex flex-col bg-[#ece9d8] font-tahoma text-xs overflow-hidden">
      {/* Top Multi-Mode Action Bar */}
      <div className="bg-gradient-to-r from-gray-900 via-blue-950 to-gray-900 text-white p-2.5 flex items-center justify-between border-b-2 border-gray-700 flex-wrap gap-2 shadow-sm select-none">
        {/* Left: Mode Buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => { playClickSound(); setViewMode('live'); }}
            className={`px-3 py-1.5 rounded font-bold text-xs flex items-center gap-1.5 transition-all ${
              viewMode === 'live'
                ? 'bg-blue-600 text-white shadow-md ring-1 ring-blue-300'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white border border-gray-700'
            }`}
          >
            <Play size={13} className={viewMode === 'live' ? 'text-green-300' : 'text-gray-400'} />
            <span>1. See App Running Live</span>
            <span className="text-[10px] bg-black/40 px-1.5 py-0.2 rounded font-mono text-cyan-300">Max 10 Users</span>
          </button>

          <button
            onClick={() => { playClickSound(); setViewMode('code'); }}
            className={`px-3 py-1.5 rounded font-bold text-xs flex items-center gap-1.5 transition-all ${
              viewMode === 'code'
                ? 'bg-blue-600 text-white shadow-md ring-1 ring-blue-300'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white border border-gray-700'
            }`}
          >
            <Code size={13} className={viewMode === 'code' ? 'text-yellow-300' : 'text-gray-400'} />
            <span>2. Code &amp; Script Explorer</span>
            <span className="text-[10px] bg-black/40 px-1.5 py-0.2 rounded font-mono text-yellow-300">{files.length} files</span>
          </button>

          <button
            onClick={() => { playClickSound(); setViewMode('deployer'); }}
            className={`px-3 py-1.5 rounded font-bold text-xs flex items-center gap-1.5 transition-all ${
              viewMode === 'deployer'
                ? 'bg-blue-600 text-white shadow-md ring-1 ring-blue-300'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white border border-gray-700'
            }`}
          >
            <Cloud size={13} className={viewMode === 'deployer' ? 'text-orange-400' : 'text-gray-400'} />
            <span>3. Cloudflare Auto-Deployer</span>
            <span className="text-[10px] bg-black/40 px-1.5 py-0.2 rounded font-mono text-orange-300">Zero Shared DB</span>
          </button>

          <button
            onClick={() => { playClickSound(); setViewMode('local'); }}
            className={`px-3 py-1.5 rounded font-bold text-xs flex items-center gap-1.5 transition-all ${
              viewMode === 'local'
                ? 'bg-blue-600 text-white shadow-md ring-1 ring-blue-300'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white border border-gray-700'
            }`}
          >
            <Laptop size={13} className={viewMode === 'local' ? 'text-green-400' : 'text-gray-400'} />
            <span>4. Local Dev (localhost:{defaultLocalPort})</span>
          </button>
        </div>

        {/* Right: Subdomain link */}
        <div className="flex items-center gap-2">
          <a
            href={subdomainUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-blue-950 text-blue-300 hover:text-white px-2.5 py-1 rounded text-[11px] font-mono hover:bg-blue-900 transition-colors flex items-center gap-1 border border-blue-700 shadow-sm"
          >
            <span>{app.id}.nates-software.com</span>
            <ExternalLink size={11} />
          </a>
        </div>
      </div>

      {/* Main Mode Viewport Area */}
      <div className="flex-1 bg-white p-3 overflow-hidden flex flex-col">
        {/* MODE 1: LIVE APP RUNNING (WITH 10 CONCURRENCY GOVERNOR) */}
        {viewMode === 'live' && (
          <div className="flex flex-col h-full space-y-2">
            {/* Concurrency & Bandwidth Guard Header */}
            <div className="bg-gray-100 border border-gray-400 p-2 rounded flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
                <span className="font-bold text-gray-800">Ephemeral Sandbox Instance</span>
                <span className="text-gray-500 font-mono">({app.id})</span>
              </div>
              <div className="flex items-center gap-3 font-mono text-[11px]">
                <span className="bg-yellow-100 text-yellow-900 px-2 py-0.5 rounded border border-yellow-300 flex items-center gap-1 font-bold">
                  <Shield size={12} /> Active Sessions: 2 / 10 Max
                </span>
                <span className="text-gray-600 text-[10px]">Bandwidth Guard Active</span>
              </div>
            </div>

            {/* If DroneHunter, render the real interactive canvas */}
            {app.id === 'dronehunter' ? (
              <div className="flex-1 bg-black border-2 border-gray-800 rounded overflow-hidden relative">
                <iframe
                  src="/dronehunter-game/index.html"
                  title="Drone Hunter Arcade Game"
                  className="w-full h-full border-0 absolute inset-0"
                  allow="autoplay; fullscreen"
                />
              </div>
            ) : (
              /* For apps with external subdomains or web builds */
              <div className="flex-1 bg-gray-50 border-2 border-gray-800 rounded p-6 flex flex-col items-center justify-center text-center space-y-4">
                <div className="text-4xl">{app.creatorAvatar}</div>
                <div className="max-w-md">
                  <h3 className="text-base font-bold text-gray-900 mb-1">{app.name} Live Environment</h3>
                  <p className="text-gray-600 text-xs leading-relaxed mb-4">
                    {app.tagline}
                  </p>
                  <div className="flex justify-center gap-2">
                    <a
                      href={subdomainUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-w95 btn-w95-primary px-4 py-2 font-bold text-xs flex items-center gap-1.5"
                    >
                      <ExternalLink size={13} /> Open Live Subdomain ({app.id}.nates-software.com)
                    </a>
                    <button
                      onClick={() => setViewMode('code')}
                      className="btn-w95 px-4 py-2 font-bold text-xs flex items-center gap-1.5"
                    >
                      <Code size={13} /> Inspect Source Code
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* MODE 2: CODE & SCRIPT EXPLORER (GITHUB STYLE REVIEWER) */}
        {viewMode === 'code' && (
          <div className="grid grid-cols-12 gap-3 h-full overflow-hidden">
            {/* File Tree Sidebar */}
            <div className="col-span-3 bg-gray-100 border-2 border-gray-400 p-2.5 rounded flex flex-col justify-between overflow-y-auto">
              <div>
                <div className="font-bold text-xs text-w95-blue mb-2 flex items-center justify-between border-b pb-1">
                  <span>Repository Files</span>
                  <span className="font-mono text-gray-500 text-[10px]">{files.length} files</span>
                </div>

                <div className="space-y-1">
                  {files.map((file) => (
                    <button
                      key={file.path}
                      onClick={() => { playClickSound(); setSelectedFile(file); }}
                      className={`w-full text-left p-1.5 rounded text-xs font-mono flex items-center justify-between transition-colors ${
                        selectedFile.path === file.path
                          ? 'bg-blue-600 text-white font-bold shadow-sm'
                          : 'text-gray-800 hover:bg-gray-200'
                      }`}
                    >
                      <span className="truncate flex items-center gap-1.5">
                        <FileText size={12} /> {file.name}
                      </span>
                      <span className={`text-[10px] ${selectedFile.path === file.path ? 'text-blue-200' : 'text-gray-500'}`}>
                        {file.size}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white p-2 rounded border text-[11px] text-gray-600 mt-3 font-mono">
                <div>Path: ~/Projects/{app.id}</div>
                <div className="text-green-700 font-bold mt-0.5">✔ Clean Worktree</div>
              </div>
            </div>

            {/* Code Content & Diff Inspector */}
            <div className="col-span-9 bg-gray-900 border-2 border-gray-800 rounded flex flex-col justify-between overflow-hidden shadow-inner text-white font-mono text-xs">
              <div className="bg-[#161b22] px-3 py-2 border-b border-gray-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-blue-300">{selectedFile.path}</span>
                  <span className="text-gray-500">({selectedFile.size})</span>
                </div>
                <button
                  onClick={handleCopyCode}
                  className="bg-gray-800 hover:bg-gray-700 text-gray-200 px-2.5 py-1 rounded text-[11px] flex items-center gap-1 border border-gray-600"
                >
                  {copiedCode ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                  <span>{copiedCode ? 'Copied' : 'Copy File Content'}</span>
                </button>
              </div>

              <div className="flex-1 p-3 overflow-auto font-mono text-xs bg-[#0d1117] text-gray-200 leading-relaxed select-text">
                <pre>{selectedFile.content}</pre>
              </div>

              <div className="bg-[#161b22] px-3 py-1.5 border-t border-gray-700 flex items-center justify-between text-[11px] text-gray-400">
                <span>Format: {selectedFile.language.toUpperCase()}</span>
                <span>Encoding: UTF-8</span>
              </div>
            </div>
          </div>
        )}

        {/* MODE 3: CLOUDFLARE AUTO-DEPLOYER & INFRASTRUCTURE ANALYZER */}
        {viewMode === 'deployer' && (
          <div className="flex flex-col h-full space-y-3 overflow-y-auto max-w-4xl mx-auto w-full py-2">
            <div className="bg-gradient-to-r from-orange-950 via-gray-900 to-orange-950 text-white p-4 rounded-lg border border-orange-700 shadow-md">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-bold text-base text-orange-400 flex items-center gap-2">
                  <Cloud size={18} /> Cloudflare Auto-Deployment Blueprint ({app.name})
                </h3>
                <span className="bg-green-900 text-green-300 text-xs font-mono font-bold px-2 py-0.5 rounded border border-green-600">
                  Estimated Cost: $0 / mo
                </span>
              </div>
              <p className="text-xs text-orange-200 leading-relaxed">
                Automatically provisions isolated serverless infrastructure on Cloudflare Pages, Workers, dedicated D1 SQLite databases, and R2 asset storage with zero shared DB conflicts.
              </p>
            </div>

            {/* Architecture Invariant Breakdown Cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 border-2 border-gray-300 p-3 rounded space-y-1.5">
                <div className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                  <Database size={14} className="text-blue-700" /> 1. Dedicated D1 Database
                </div>
                <div className="font-mono text-xs text-blue-900 font-bold bg-white p-1 rounded border">
                  {app.id}-d1-prod
                </div>
                <p className="text-gray-600 text-[11px] leading-snug">
                  Zero shared tables. Every app has its own isolated SQLite WAL database volume to eliminate schema collisions.
                </p>
              </div>

              <div className="bg-gray-50 border-2 border-gray-300 p-3 rounded space-y-1.5">
                <div className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                  <Layers size={14} className="text-purple-700" /> 2. Serverless Edge Workers
                </div>
                <div className="font-mono text-xs text-purple-900 font-bold bg-white p-1 rounded border">
                  /api/* functions bundle
                </div>
                <p className="text-gray-600 text-[11px] leading-snug">
                  Converts backend endpoints to Cloudflare Edge Workers with sub-10ms global TTFT and automatic scale-to-zero.
                </p>
              </div>

              <div className="bg-gray-50 border-2 border-gray-300 p-3 rounded space-y-1.5">
                <div className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                  <Lock size={14} className="text-green-700" /> 3. 10-User Concurrency Cap
                </div>
                <div className="font-mono text-xs text-green-900 font-bold bg-white p-1 rounded border">
                  10 Max Concurrent
                </div>
                <p className="text-gray-600 text-[11px] leading-snug">
                  Rate limiting governor prevents bandwidth hogging while providing instantaneous ephemeral testing.
                </p>
              </div>
            </div>

            {/* Deploy Action Button */}
            <div className="bg-white border-2 border-gray-800 p-4 rounded flex items-center justify-between">
              <div>
                <div className="font-bold text-sm text-gray-900">Provision &amp; Deploy to Cloudflare Infrastructure</div>
                <div className="text-xs text-gray-500 font-mono">Target: {subdomainUrl}</div>
              </div>

              <button
                onClick={handleDeployToCloudflare}
                disabled={deployStep === 'deploying'}
                className="btn-w95 btn-w95-primary px-6 py-2.5 font-bold text-xs flex items-center gap-2 shadow-md"
              >
                <Cloud size={14} />
                <span>
                  {deployStep === 'deploying'
                    ? 'PROVISIONING CLOUDFLARE D1 & WORKER...'
                    : deployStep === 'complete'
                    ? '✔ DEPLOYMENT ACTIVE & VERIFIED'
                    : '🚀 Auto-Deploy Stack to Cloudflare'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* MODE 4: LOCAL HOST DEV BRIDGE (LOCALHOST:PORT) */}
        {viewMode === 'local' && (
          <div className="flex flex-col h-full space-y-3 max-w-2xl mx-auto w-full py-4">
            <div className="bg-blue-50 border-2 border-w95-blue p-4 rounded space-y-2">
              <h3 className="font-bold text-sm text-w95-blue flex items-center gap-2">
                <Laptop size={16} /> Native Local Host Bridge
              </h3>
              <p className="text-xs text-gray-700 leading-relaxed">
                Connect directly to your local development server running natively on your Mac mini (e.g. built-in PHP server, Python CLI, or Vite dev server).
              </p>
            </div>

            <div className="border-2 border-gray-400 p-3 rounded bg-gray-50 space-y-3">
              <div>
                <label className="block font-bold text-gray-800 text-xs mb-1">Local Host Port:</label>
                <div className="flex gap-2">
                  <span className="bg-gray-200 border border-gray-400 px-2 py-1.5 font-mono text-xs text-gray-700 rounded-l">
                    http://localhost:
                  </span>
                  <input
                    type="number"
                    value={localPort}
                    onChange={(e) => setLocalPort(parseInt(e.target.value) || 8000)}
                    className="w-32 border border-gray-400 p-1.5 font-mono font-bold text-xs"
                  />
                  <button
                    onClick={() => { playClickSound(); setIsLocalConnected(true); }}
                    className="btn-w95 btn-w95-primary px-4 py-1 font-bold text-xs"
                  >
                    Connect Local Dyno
                  </button>
                </div>
              </div>

              {isLocalConnected && (
                <div className="bg-green-50 border border-green-400 text-green-900 p-2.5 rounded font-mono text-xs flex items-center justify-between">
                  <span>✔ Connected to http://localhost:{localPort} (PID Active)</span>
                  <a
                    href={`http://localhost:${localPort}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-700 font-bold hover:underline flex items-center gap-1"
                  >
                    <span>Open in browser</span>
                    <ExternalLink size={11} />
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
