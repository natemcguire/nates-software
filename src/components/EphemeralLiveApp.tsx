import React, { useState, useEffect } from 'react';
import { AppListing, AppDeploymentState } from '../data/mockData';
import { ExternalLink, Shield, AlertTriangle, GitBranch, Cpu, RefreshCw, FileCode, CheckCircle2, XCircle, Info } from 'lucide-react';
import { playClickSound } from '../lib/soundEngine';
import { getHonestDeploymentMessage } from '../lib/deploymentLifecycle';
import { MarkdownRenderer } from './MarkdownRenderer';

interface EphemeralLiveAppProps {
  app: AppListing;
}

export const EphemeralLiveApp: React.FC<EphemeralLiveAppProps> = ({ app }) => {
  const deploymentState: AppDeploymentState = app.deploymentState || 'draft';
  const isVerifiedActive = (deploymentState === 'active') && Boolean(app.activeDeploymentId);

  const configuredLiveUrl = app.liveAppUrl || app.liveUrl || '';
  const isValidUrl = /^https?:\/\//i.test(configuredLiveUrl) || configuredLiveUrl.startsWith('/serve/');
  const liveUrl = isValidUrl ? configuredLiveUrl : undefined;
  // A client_demo app is a browser-only app with no backend revision — if it exposes a
  // valid live URL, it genuinely runs there, so embed it instead of only showing a README.
  const isRunnableClientDemo = deploymentState === 'client_demo' && Boolean(liveUrl);

  const honestInfo = getHonestDeploymentMessage({
    id: app.id,
    name: app.name,
    deploymentState,
    deploymentError: app.deploymentError
  });

  const displayError = (app.deploymentError || '')
    .split('\n')
    .map(l => l.trim())
    .find(l => l.length > 0);
  const shortError = displayError
    ? (displayError.length > 160 ? `${displayError.slice(0, 160)}…` : displayError)
    : '';

  const hasRunnableDeployment = (isVerifiedActive || isRunnableClientDemo) && Boolean(liveUrl);
  const [owner, repoSlugName] = (app.repoSlug || '').includes('/')
    ? app.repoSlug!.split('/')
    : [undefined, undefined];
  const hasLinkedRepo = Boolean(app.hasCanonicalRepo && owner && repoSlugName);

  const [readmeContent, setReadmeContent] = useState<string | null>(null);
  const [readmeLoading, setReadmeLoading] = useState(false);
  const [readmeUnavailable, setReadmeUnavailable] = useState(false);

  useEffect(() => {
    if (hasRunnableDeployment || !hasLinkedRepo) {
      setReadmeContent(null);
      setReadmeLoading(false);
      setReadmeUnavailable(false);
      return;
    }

    let isCancelled = false;
    setReadmeLoading(true);
    setReadmeUnavailable(false);
    setReadmeContent(null);

    const readmeUrl = `/api/repo-file?owner=${encodeURIComponent(owner!)}&slug=${encodeURIComponent(repoSlugName!)}&path=${encodeURIComponent('README.md')}`;

    fetch(readmeUrl)
      .then(async res => {
        if (isCancelled) return;
        if (res.ok) {
          const text = await res.text();
          if (!isCancelled) setReadmeContent(text);
        } else {
          if (!isCancelled) setReadmeUnavailable(true);
        }
      })
      .catch(() => {
        if (!isCancelled) setReadmeUnavailable(true);
      })
      .finally(() => {
        if (!isCancelled) setReadmeLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [app.id, hasRunnableDeployment, hasLinkedRepo, owner, repoSlugName]);

  const getStatusBadge = (state: AppDeploymentState) => {
    switch (state) {
      case 'active':
        return (
          <span className="bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded border border-emerald-600 flex items-center gap-1 font-bold font-mono text-[11px]" data-testid="deployment-state-badge">
            <Shield size={11} /> ACTIVE (VERIFIED DEPLOYMENT)
          </span>
        );
      case 'deployable':
        return (
          <span className="bg-blue-950 text-blue-300 px-2 py-0.5 rounded border border-blue-600 flex items-center gap-1 font-bold font-mono text-[11px]" data-testid="deployment-state-badge">
            <CheckCircle2 size={11} /> DEPLOYABLE (PROMOTION PENDING)
          </span>
        );
      case 'building':
        return (
          <span className="bg-sky-950 text-sky-300 px-2 py-0.5 rounded border border-sky-600 flex items-center gap-1 font-bold font-mono text-[11px]" data-testid="deployment-state-badge">
            <RefreshCw size={11} className="animate-spin" /> BUILDING CANDIDATE
          </span>
        );
      case 'source_ready':
        return (
          <span className="bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded border border-indigo-600 flex items-center gap-1 font-bold font-mono text-[11px]" data-testid="deployment-state-badge">
            <GitBranch size={11} /> SOURCE READY (GITSMITH)
          </span>
        );
      case 'failed':
        return (
          <span className="bg-rose-950 text-rose-300 px-2 py-0.5 rounded border border-rose-600 flex items-center gap-1 font-bold font-mono text-[11px]" data-testid="deployment-state-badge">
            <XCircle size={11} /> DEPLOYMENT FAILED
          </span>
        );
      case 'retired':
        return (
          <span className="bg-gray-800 text-gray-400 px-2 py-0.5 rounded border border-gray-600 flex items-center gap-1 font-bold font-mono text-[11px]" data-testid="deployment-state-badge">
            <Info size={11} /> RETIRED
          </span>
        );
      case 'draft':
      default:
        return (
          <span className="bg-amber-950 text-amber-300 px-2 py-0.5 rounded border border-amber-600 flex items-center gap-1 font-bold font-mono text-[11px]" data-testid="deployment-state-badge">
            <AlertTriangle size={11} /> DRAFT (UNVERIFIED)
          </span>
        );
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#ece9d8] font-tahoma text-xs overflow-hidden" data-testid="ephemeral-live-app-container">
      <div className="bg-gradient-to-r from-gray-900 via-blue-950 to-gray-900 text-white p-2 flex items-center justify-between border-b-2 border-gray-700 flex-wrap gap-2 shadow-sm select-none">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${isVerifiedActive ? 'bg-green-500 animate-pulse' : deploymentState === 'failed' ? 'bg-red-500' : 'bg-amber-400'}`} />
          <span className="font-bold text-xs">{app.name} Live Sandbox</span>
          <span className="text-gray-400 font-mono text-[11px]">({app.version})</span>
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px]">
          {getStatusBadge(deploymentState)}
          {isVerifiedActive && liveUrl && (
            <a
              href={liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => playClickSound()}
              className="bg-blue-900 hover:bg-blue-800 text-cyan-300 hover:text-white px-2.5 py-1 rounded text-[11px] font-mono transition-colors flex items-center gap-1 border border-blue-600 shadow-sm font-bold"
            >
              <span>Open published app</span>
              <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>

      <div className="flex-1 bg-white overflow-hidden flex flex-col">
        {isVerifiedActive && liveUrl ? (
          <div className="flex-1 bg-white relative">
            <iframe
              src={liveUrl}
              title={app.name}
              className="w-full h-full border-0 absolute inset-0"
              allow="autoplay; fullscreen"
            />
          </div>
        ) : (
          <div className="flex-1 bg-[#ece9d8] p-6 sm:p-10 flex flex-col items-center text-center font-tahoma overflow-y-auto" data-testid="honest-deployment-surface">
            {hasLinkedRepo && (
              <div className="bg-white border-2 border-t-white border-l-white border-b-black border-r-black p-5 max-w-xl w-full shadow-lg text-left mb-4" data-testid="sandbox-readme-block">
                <div className="bg-gradient-to-r from-[#000080] to-[#1084d0] text-white px-3 py-1.5 flex items-center justify-between mb-3 select-none font-bold text-xs">
                  <div className="flex items-center gap-2">
                    <FileCode size={13} />
                    <span>README · {app.repoSlug}</span>
                  </div>
                </div>
                {readmeLoading ? (
                  <p className="text-xs text-gray-500 font-mono animate-pulse" data-testid="readme-loading">Loading README.md from repository...</p>
                ) : readmeContent ? (
                  <MarkdownRenderer content={readmeContent} />
                ) : (
                  <p className="text-[11px] text-gray-500 font-mono" data-testid="readme-unavailable">
                    {readmeUnavailable ? 'README unavailable.' : 'No README.md found in this repository.'}
                  </p>
                )}
              </div>
            )}

            <div className="bg-w95-gray border-2 border-t-white border-l-white border-b-black border-r-black p-6 max-w-xl w-full shadow-lg text-left">
              <div className="bg-gradient-to-r from-[#000080] to-[#1084d0] text-white px-3 py-1.5 flex items-center justify-between mb-4 select-none font-bold text-xs">
                <div className="flex items-center gap-2">
                  <span>{deploymentState === 'failed' ? '🚫' : '⚠️'}</span>
                  <span>DEPLOYMENT LIFECYCLE · {deploymentState.toUpperCase()}</span>
                </div>
                <span className="font-mono text-[10px] text-blue-200">RIG.EXE &middot; GITSMITH</span>
              </div>

              <div className="flex items-start gap-4 mb-4">
                <div className="text-3xl select-none mt-1">
                  {deploymentState === 'failed' ? '❌' : deploymentState === 'retired' ? '📦' : '🏗️'}
                </div>
                <div className="flex-1">
                  <h2 className="font-bold text-sm text-gray-900 mb-1" data-testid="deployment-headline">
                    {honestInfo.headline}
                  </h2>
                  <p className="text-xs text-gray-700 leading-relaxed font-sans" data-testid="deployment-error-message">
                    {honestInfo.subtext}
                  </p>
                </div>
              </div>

              <div className="bg-[#0f172a] text-emerald-400 border border-gray-700 p-3.5 rounded font-mono text-[11px] mb-4 space-y-1 overflow-x-auto shadow-inner" data-testid="deployment-evidence-box">
                <div className="text-gray-400 border-b border-gray-800 pb-1 mb-1.5 font-bold flex justify-between">
                  <span>[RIG & GITSMITH LIFECYCLE EVIDENCE]</span>
                  <span className="text-amber-400">{deploymentState.toUpperCase()}</span>
                </div>
                <div><span className="text-gray-400">Target App:</span> {app.name} ({app.id})</div>
                <div><span className="text-gray-400">Target Hostname:</span> https://{app.id}.nates-software.com</div>
                <div><span className="text-gray-400">Version:</span> {app.version}</div>
                <div><span className="text-gray-400">Lifecycle State:</span> <span className={deploymentState === 'failed' ? 'text-rose-400 font-bold' : 'text-amber-300'}>{deploymentState}</span></div>
                <div><span className="text-gray-400">Detected Project Type:</span> {app.detectedProjectType || 'Awaiting repository intake'}</div>
                {app.activeCommitOid && <div><span className="text-gray-400">Commit OID:</span> {app.activeCommitOid}</div>}
                {shortError && (
                  <div className="mt-2 pt-2 border-t border-gray-800 text-rose-300">
                    <span className="font-bold text-rose-400">Error Evidence:</span> {shortError}
                  </div>
                )}
                {app.deploymentEvidence && (
                  <div className="mt-2 pt-2 border-t border-gray-800 text-cyan-300 text-[10px]">
                    <pre className="whitespace-pre-wrap">{typeof app.deploymentEvidence === 'string' ? app.deploymentEvidence : JSON.stringify(app.deploymentEvidence, null, 2)}</pre>
                  </div>
                )}
              </div>

              <div className="bg-yellow-50 border border-yellow-300 p-3 rounded text-[11px] text-gray-800 mb-4">
                <div className="font-bold text-yellow-900 mb-1 flex items-center gap-1.5">
                  <FileCode size={13} />
                  <span>Deployment Invariant:</span>
                </div>
                <p className="text-gray-700 leading-snug mb-2">
                  Catalog publication does not imply active deployment. An app receives a live standalone hostname only after reaching <strong>deployable</strong> and successfully promoting a verified revision.
                </p>
                <div className="font-bold text-gray-800 mb-0.5">Deployment Steps:</div>
                <ul className="list-disc pl-4 space-y-0.5 text-gray-600">
                  {honestInfo.guidance.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ul>
              </div>

              <div className="flex items-center justify-end gap-2 flex-wrap">
                <a
                  href={`https://gitsmith.nates-software.com?repo=${app.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-w95 text-xs py-1.5 px-3 font-bold bg-gray-200 hover:bg-white text-black flex items-center gap-1"
                >
                  <GitBranch size={12} />
                  <span>Open GITSMITH Repo</span>
                </a>
                <a
                  href={`https://rig.nates-software.com?app=${app.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-w95 text-xs py-1.5 px-3 font-bold bg-gray-200 hover:bg-white text-black flex items-center gap-1"
                >
                  <Cpu size={12} />
                  <span>RIG Runtime HUD</span>
                </a>
                <a
                  href="https://nates-software.com"
                  className="btn-w95 text-xs py-1.5 px-3 font-bold bg-blue-900 text-white hover:bg-blue-800 flex items-center gap-1"
                >
                  <span>Return to Web OS</span>
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
