import React, { useState, useEffect } from 'react';
import { AppListing, AppComment } from '../data/mockData';
import { EphemeralLiveApp } from './EphemeralLiveApp';
import {
  Play,
  Image as ImageIcon,
  MessageSquare,
  Edit3,
  ExternalLink,
  GitBranch,
  Network,
  Bot,
  CreditCard,
  X,
  Check,
  FileText
} from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { CheckoutModal } from './CheckoutModal';
import { ForkWithAiModal } from './ForkWithAiModal';
import { useAlert } from '../context/AlertContext';
import { MarkdownRenderer } from './MarkdownRenderer';
import { Win95Scroll } from './Win95Scroll';

interface ArtifactSandboxProps {
  app: AppListing;
  onFork?: () => void;
  onOpenAI?: () => void;
  onEditPost?: () => void;
  onOpenLiveWindow?: () => void;
  onOpenPostEditor?: (app?: AppListing) => void;
}

export const ArtifactSandbox: React.FC<ArtifactSandboxProps> = ({
  app,
  onOpenPostEditor
}) => {
  const { showAlert } = useAlert();
  const { user, openAuthModal } = useAuth();
  const { isOwned } = useCatalog();
  const isAppOwned = isOwned(app.id);
  const grantableBps = typeof app.grantable_bps === 'number'
    ? app.grantable_bps
    : (typeof app.grantableBps === 'number' ? app.grantableBps : 0);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showForkModal, setShowForkModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'preview' | 'screenshots' | 'comments' | 'spec'>('preview');
  const [activeShotIdx, setActiveShotIdx] = useState(0);

  const [showLineageModal, setShowLineageModal] = useState(false);

  const hasActiveDeployment = Boolean(
    (app.deploymentState === 'active' && (app.activeDeploymentId || app.liveUrl)) ||
    app.liveUrl
  );
  const authoritativeLiveUrl = app.liveUrl || (
    app.deploymentState === 'active' && (app.binaries as any)?.web
      ? (app.binaries as any).web
      : null
  );

  const [comments, setComments] = useState<AppComment[]>(app.comments || []);
  const [newCommentText, setNewCommentText] = useState('');

  const [specContent, setSpecContent] = useState<string | null>(null);
  const [specLoading, setSpecLoading] = useState(false);
  const [specError, setSpecError] = useState<string | null>(null);

  const getRepoFileUrl = (filePath: string): string => {
    const repoQuery = app.repositoryId
      ? `repoId=${encodeURIComponent(app.repositoryId)}`
      : (app.repoSlug
        ? `repo=${encodeURIComponent(app.repoSlug)}`
        : `id=${encodeURIComponent(app.id)}`);
    return `/api/repo-file?${repoQuery}&path=${encodeURIComponent(filePath)}`;
  };

  const resolveScreenshotUrl = (src: string): string => {
    if (!src) return '';
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:') || src.startsWith('/api/')) {
      return src;
    }
    const cleanPath = src.startsWith('repo:') ? src.slice(5) : src;
    return getRepoFileUrl(cleanPath);
  };

  useEffect(() => {
    let isCancelled = false;
    setSpecLoading(true);
    setSpecError(null);
    setSpecContent(null);

    const specUrl = getRepoFileUrl('spec.md');

    fetch(specUrl)
      .then(async res => {
        if (isCancelled) return;
        if (res.ok) {
          const text = await res.text();
          setSpecContent(text);
        } else if (res.status === 404) {
          setSpecContent(null);
        } else {
          setSpecError(`Failed to load spec (HTTP ${res.status})`);
        }
      })
      .catch(err => {
        if (!isCancelled) {
          setSpecError(err?.message || 'Failed to load spec.md');
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setSpecLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [app.id, app.repositoryId, app.repoSlug]);

  const processedSpecContent = React.useMemo(() => {
    if (!specContent) return '';
    const repoQuery = app.repositoryId
      ? `repoId=${encodeURIComponent(app.repositoryId)}`
      : (app.repoSlug
        ? `repo=${encodeURIComponent(app.repoSlug)}`
        : `id=${encodeURIComponent(app.id)}`);

    return specContent.replace(/!\[([^\]]*)\]\((?!(?:https?:\/\/|\/|data:))([^)]+)\)/g, (_, alt, relPath) => {
      const cleanRelPath = relPath.replace(/^\.\//, '');
      return `![${alt}](/api/repo-file?${repoQuery}&path=${encodeURIComponent(cleanRelPath)})`;
    });
  }, [specContent, app.id, app.repositoryId, app.repoSlug]);

  useEffect(() => {
    fetch(`/api/comments?app_id=${app.id}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.comments)) {
          setComments(data.comments);
        } else if (app.isDemo) {
          setComments(app.comments || []);
        } else {
          setComments([]);
        }
      })
      .catch(() => {
        if (app.isDemo) {
          setComments(app.comments || []);
        } else {
          setComments([]);
        }
      });
  }, [app.id, app.isDemo]);

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim()) return;

    if (!user) {
      showAlert("Please log in or create an account to post comments.", "Sign In Required", "warning");
      openAuthModal('login');
      return;
    }

    playClickSound();
    const cleanText = newCommentText.trim();
    setNewCommentText('');

    const tempCommentId = `c-${Date.now()}`;
    const commentObj: AppComment = {
      id: tempCommentId,
      author: `@${user.username}`,
      avatar: user.avatar || '⚡',
      time: 'Just now',
      timestamp: 'Just now',
      text: cleanText,
      upvotes: 1,
      isMaker: user.username === 'nate' || user.username === 'josh'
    };

    setComments(prev => [commentObj, ...prev]);
    playSuccessChime();

    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: app.id,
          author: user.username,
          avatar: user.avatar || '⚡',
          text: cleanText
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.success !== true || !data.comment) {
        throw new Error(data?.error || `Failed to post comment (Status ${res.status})`);
      }
      setComments(prev => prev.map(c => c.id === tempCommentId ? data.comment : c));
    } catch (err: any) {
      setComments(prev => prev.filter(c => c.id !== tempCommentId));
      showAlert(
        err?.message || 'Unable to post comment. Please try again.',
        'Comment Failed',
        'error'
      );
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#ece9d8] text-sm font-tahoma">
      <div className="bg-blue-50 border-2 border-w95-blue p-3 flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex items-center gap-3">
          <div className="text-3xl bg-white p-1 rounded border border-gray-400 shadow-sm">{app.authorAvatar || app.creatorAvatar || '🎯'}</div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base text-w95-blue">{app.name}</span>
              <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-0.5 rounded border border-green-400">
                {app.version}
              </span>
              {app.isDemo ? (
                <span className="bg-amber-100 text-amber-900 border border-amber-400 text-[10px] font-bold font-mono px-1.5 py-0.2 rounded">
                  DEMO DATA
                </span>
              ) : (
                <span className="bg-emerald-100 text-emerald-900 border border-emerald-400 text-[10px] font-bold font-mono px-1.5 py-0.2 rounded">
                  LIVE D1 DROP
                </span>
              )}
              {app.hasCanonicalRepo && app.repoSlug ? (
                <span className="bg-blue-100 text-blue-900 border border-blue-300 font-mono text-[10px] px-1.5 py-0.2 rounded flex items-center gap-1 font-bold" title={`Canonical GITSMITH Repo: ${app.repoSlug}`}>
                  <GitBranch size={10} className="text-blue-700 shrink-0" />
                  <span>{app.repoSlug}</span>
                  {app.repoHeadCommitOid && (
                    <span className="text-blue-600 font-normal">#{app.repoHeadCommitOid.slice(0, 7)}</span>
                  )}
                </span>
              ) : (
                <span className="bg-gray-200 text-gray-600 border border-gray-400 font-mono text-[10px] px-1.5 py-0.2 rounded" title="Source repository not yet on GITSMITH forge">
                  not yet on forge
                </span>
              )}
              <span className="text-gray-500 text-xs font-medium">by @{app.author || app.creator}</span>
            </div>
            <p className="text-gray-600 text-xs mt-0.5 line-clamp-1">{app.tagline}</p>
          </div>
        </div>

        {(() => {
          const tab = (id: string, node: React.ReactNode, key?: string) => {
            const active = activeTab === id;
            return (
              <button
                key={key || id}
                role="tab"
                aria-selected={active}
                onClick={() => { setActiveTab(id as any); playClickSound(); }}
                className={`relative -mb-px text-xs py-1.5 px-3 flex items-center gap-1 whitespace-nowrap border border-gray-500 rounded-t
                  ${active
                    ? 'bg-white text-black font-bold border-b-white z-10 -mt-0.5 pb-2'
                    : 'bg-[#cfcfcf] text-gray-700 border-b-gray-500 hover:bg-[#dcdcdc]'}`}
              >
                {node}
              </button>
            );
          };
          return (
            <div role="tablist" className="flex flex-wrap items-end gap-0.5 border-b border-gray-500 -mb-px pt-1">
              {tab('preview', <><Play size={13} /> Live App</>)}
              {tab('spec', <><FileText size={13} /> Spec</>)}
              {tab('screenshots', <><ImageIcon size={13} /> Shots ({app.screenshots?.length || 0})</>)}
              {tab('comments', <><MessageSquare size={13} /> Comments ({comments.length})</>)}
              {hasActiveDeployment && authoritativeLiveUrl ? (
                <a
                  href={authoritativeLiveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => playClickSound()}
                  title={`Open ${authoritativeLiveUrl} in new tab`}
                  className="ml-auto text-xs py-1 px-2 text-blue-900 font-bold flex items-center gap-1 hover:bg-blue-100 rounded max-w-[45%] min-w-0"
                >
                  <ExternalLink size={12} className="shrink-0" />
                  <span className="truncate">{authoritativeLiveUrl.replace(/^https?:\/\//, '')}</span>
                </a>
              ) : (
                <span
                  className="ml-auto text-xs py-1 px-2 text-gray-400 cursor-not-allowed opacity-70 flex items-center gap-1"
                  title={`Deployment status: ${app.deploymentState || 'draft'} (no active host)`}
                >
                  <ExternalLink size={12} className="shrink-0" />
                  <span className="truncate">{app.deploymentState || 'draft'}</span>
                </span>
              )}
            </div>
          );
        })()}
      </div>

      <Win95Scroll className="flex-1 bg-white border-2 border-gray-400 border-r-white border-b-white p-3 mb-2">
        {activeTab === 'preview' && (
          <div className="h-full flex flex-col">
            <div className="bg-gray-100 p-2 border border-gray-300 mb-2 flex items-center justify-between text-xs font-mono flex-wrap gap-2">
              <div className="flex items-center gap-2">
                {hasActiveDeployment && authoritativeLiveUrl ? (
                  <>
                    <span className="text-gray-700">Live URL: <strong className="text-blue-800 font-mono">{authoritativeLiveUrl}</strong></span>
                    <a
                      href={authoritativeLiveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => playClickSound()}
                      className="btn-w95 text-xs py-1 px-3 bg-blue-50 text-blue-900 font-bold flex items-center gap-1.5 hover:bg-blue-100 shadow-sm border border-blue-400"
                      title={`Open ${authoritativeLiveUrl} in a new browser window`}
                    >
                      <ExternalLink size={13} /> Open in New Window
                    </a>
                  </>
                ) : (
                  <>
                    <span className="text-gray-600 font-mono text-[11px]">
                      Deployment status: <strong className="text-gray-800 uppercase font-bold">{app.deploymentState || 'draft'}</strong> (no active host)
                    </span>
                    <span
                      className="btn-w95 text-xs py-1 px-3 text-gray-400 cursor-not-allowed opacity-70 font-medium border border-gray-300 flex items-center gap-1.5"
                      title="Host not active for draft listing"
                    >
                      <ExternalLink size={13} /> Draft (Unpublished)
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded border border-green-300 font-bold">
                  ● Client-Side Sandbox
                </span>
                <button
                  onClick={() => setShowLineageModal(true)}
                  className="bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-400 px-2 py-0.5 rounded font-bold flex items-center gap-1"
                >
                  <Network size={11} />
                  <span>Lineage DAG</span>
                </button>
              </div>
            </div>

            <div className="flex-1 border-2 border-gray-400 border-t-black border-l-black overflow-hidden relative">
              <EphemeralLiveApp app={app} />
            </div>
          </div>
        )}

        {activeTab === 'spec' && (
          <div className="h-full flex flex-col">
            {specLoading ? (
              <div className="flex-1 flex items-center justify-center p-8 text-gray-500 font-mono text-xs">
                <span className="animate-pulse">Loading spec.md from repository...</span>
              </div>
            ) : processedSpecContent ? (
              <Win95Scroll className="flex-1 p-4 bg-white border border-gray-300 rounded shadow-inner">
                <div className="mb-3 pb-2 border-b border-gray-200 flex items-center justify-between text-xs text-gray-500 font-mono">
                  <span className="flex items-center gap-1.5 font-bold text-gray-700">
                    <FileText size={14} className="text-blue-700" />
                    <span>spec.md</span>
                  </span>
                  {app.repoSlug && (
                    <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded border border-gray-300">
                      {app.repoSlug}
                    </span>
                  )}
                </div>
                <MarkdownRenderer content={processedSpecContent} />
              </Win95Scroll>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-gray-50 border border-dashed border-gray-300 rounded">
                <FileText size={36} className="text-gray-400 mb-2" />
                <h4 className="font-bold text-gray-700 text-sm">
                  {specError ? 'Unable to Load Specification' : 'No Idea Specification Found'}
                </h4>
                <p className="text-xs text-gray-500 max-w-sm mt-1 leading-relaxed">
                  {specError ? (
                    <span className="text-red-700 font-mono text-[11px]">{specError}</span>
                  ) : (
                    <>
                      This repository does not have a <code>spec.md</code> committed at its root yet.
                      Commit a <code>spec.md</code> to the main branch to render the idea pitch and specification here.
                    </>
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'screenshots' && (
          app.screenshots && app.screenshots.length > 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-2">
              <img
                src={resolveScreenshotUrl(app.screenshots[activeShotIdx])}
                alt={app.name}
                className="max-h-[340px] rounded border border-gray-400 shadow-md object-contain"
              />
              {app.screenshots.length > 1 && (
                <div className="flex gap-2 mt-3">
                  {app.screenshots.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveShotIdx(i)}
                      className={`px-3 py-1 text-xs font-mono font-bold rounded ${
                        activeShotIdx === i ? 'bg-blue-800 text-white' : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      Slide {i + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-gray-50 border border-dashed border-gray-300 rounded">
              <ImageIcon size={36} className="text-gray-400 mb-2" />
              <h4 className="font-bold text-gray-700 text-sm">No Screenshots Uploaded</h4>
              <p className="text-xs text-gray-500 max-w-sm mt-1">
                The maker has not attached any screenshot previews to this drop yet.
              </p>
            </div>
          )
        )}

        {activeTab === 'comments' && (
          <div className="h-full flex flex-col space-y-3">
            {app.makerPitch && (
              <div className="bg-amber-50 border-2 border-amber-300 rounded p-3 text-xs space-y-1 shadow-sm">
                <div className="flex items-center justify-between text-amber-900 font-bold font-mono">
                  <span className="flex items-center gap-1.5">
                    <span>{app.authorAvatar || '🎯'}</span>
                    <span>Maker Story &amp; Pitch by @{app.author}</span>
                  </span>
                  <span className="bg-amber-200 text-amber-900 px-1.5 py-0.2 rounded text-[10px] uppercase font-bold">
                    Pinned
                  </span>
                </div>
                <p className="text-amber-950 leading-relaxed italic">
                  "{app.makerPitch}"
                </p>
              </div>
            )}

            {comments.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-gray-500 bg-gray-50 border border-dashed border-gray-300 rounded">
                <MessageSquare size={28} className="text-gray-400 mb-2" />
                <div className="font-bold text-xs text-gray-700">No comments yet</div>
                <p className="text-[11px] text-gray-500 mt-0.5">Be the first to leave feedback for the maker!</p>
              </div>
            ) : (
              <Win95Scroll className="flex-1 space-y-2 border border-gray-300 p-2 bg-gray-50 rounded">
                {comments.map(c => (
                  <div key={c.id} className="bg-white p-2.5 rounded border border-gray-200 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-blue-900 flex items-center gap-1">
                        <span>{c.avatar}</span>
                        <span>{c.author}</span>
                        {c.isMaker && (
                          <span className="bg-blue-100 text-blue-800 text-[9px] font-bold px-1 rounded">
                            MAKER
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] text-gray-400 font-mono">{c.timestamp || c.time}</span>
                    </div>
                    <p className="text-xs text-gray-800 leading-relaxed">{c.text}</p>
                  </div>
                ))}
              </Win95Scroll>
            )}

            <form onSubmit={handleAddComment} className="flex gap-2">
              <input
                type="text"
                placeholder="Leave feedback for maker..."
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                className="flex-1 border border-gray-400 p-2 text-xs outline-none bg-white"
              />
              <button type="submit" className="btn-w95 px-4 py-1 font-bold">
                Post Comment
              </button>
            </form>
          </div>
        )}
      </Win95Scroll>

      <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-gray-400">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => {
              playSuccessChime();
              setShowForkModal(true);
            }}
            className="btn-w95 text-xs py-1.5 px-3 flex items-center gap-1.5 bg-amber-50 font-bold border border-amber-400 text-amber-950 shadow-sm"
          >
            <Bot size={13} className="text-purple-700" />
            <span>⚡ Fork with AI</span>
          </button>
          {grantableBps > 0 && (
            <span
              className="btn-w95 text-xs py-1.5 px-2.5 bg-purple-50 font-bold border border-purple-400 text-purple-950 shadow-sm flex items-center gap-1 font-mono"
              title={`Up to ${grantableBps / 100}% of gross sale proceeds are available to approved contributors`}
            >
              <span className="text-purple-700 font-bold">🎁</span>
              <span>{`Up to ${grantableBps / 100}% of every sale available to contributors`}</span>
            </span>
          )}
          {onOpenPostEditor && (
            <button
              onClick={() => onOpenPostEditor(app)}
              className="btn-w95 text-xs py-1.5 px-3 flex items-center gap-1.5 text-w95-blue"
            >
              <Edit3 size={13} /> Edit Post
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {isAppOwned ? (
            <span className="bg-emerald-100 text-emerald-800 border border-emerald-400 text-xs py-1.5 px-3 rounded font-bold font-mono flex items-center gap-1.5 shadow-sm">
              <Check size={13} className="text-emerald-700 font-bold" />
              <span>License Active on Shelf</span>
            </span>
          ) : (
            <button
              onClick={() => {
                playClickSound();
                setShowCheckoutModal(true);
              }}
              className="btn-w95 btn-w95-primary text-xs py-1.5 px-3 flex items-center gap-1.5 font-bold shadow-sm"
            >
              <CreditCard size={12} />
              <span>Register License (${typeof app.price === 'number' ? app.price : (parseInt(String(app.price || '15').replace(/[^0-9.]/g, ''), 10) || 15)})</span>
            </button>
          )}
          {hasActiveDeployment && authoritativeLiveUrl ? (
            <a
              href={authoritativeLiveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-w95 text-xs py-1.5 px-3 flex items-center gap-1.5 font-bold"
            >
              <ExternalLink size={12} /> Launch Live App &rarr;
            </a>
          ) : (
            <span
              className="btn-w95 text-xs py-1.5 px-3 flex items-center gap-1.5 text-gray-400 cursor-not-allowed opacity-70 font-medium"
              title={`Drop is ${app.deploymentState || 'draft'} metadata; app has not been deployed`}
            >
              <ExternalLink size={12} /> Not yet published
            </span>
          )}
          {app.hasCanonicalRepo && (app.repoSlug || app.repoName || app.repositoryId) ? (
            <a
              href={`https://gitsmith.nates-software.com?repo=${app.repoSlug || app.repoName || app.repositoryId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-w95 text-xs py-1.5 px-2.5 flex items-center gap-1 font-bold"
            >
              <GitBranch size={12} /> View on GITSMITH
            </a>
          ) : (
            <span
              className="btn-w95 text-xs py-1.5 px-2.5 flex items-center gap-1 text-gray-400 cursor-not-allowed opacity-70 font-medium"
              title="Repository not yet initialized on forge"
            >
              <GitBranch size={12} /> No repo on forge
            </span>
          )}
        </div>
      </div>

      {showLineageModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1e293b] border-2 border-slate-600 rounded-lg max-w-lg w-full shadow-2xl p-5 text-slate-100 font-sans text-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-700 pb-3">
              <div className="flex items-center gap-2">
                <Network size={16} className="text-amber-400" />
                <span className="font-bold text-sm text-white font-mono">Immutable Lineage DAG · {app.name}</span>
              </div>
              <button onClick={() => setShowLineageModal(false)} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <div className="bg-[#0f172a] p-3.5 rounded-lg border border-slate-700 space-y-3 font-mono">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Root Author:</span>
                <span className="text-sky-400 font-bold">@{app.author || app.creator}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Lineage Ancestry Depth:</span>
                <span className="text-emerald-400 font-bold">Genesis (Generation 0)</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Downstream Forks:</span>
                <span className="text-amber-400 font-bold">{app.forkCount} Registered Forks</span>
              </div>
            </div>

            <div className="border border-slate-700 rounded-lg p-3 bg-slate-900/60 space-y-2">
              <div className="font-bold text-xs text-white">How a sale splits</div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Someone forks <strong>{app.name}</strong>, sells their version, and the money splits on its own: <strong>10%</strong> to the platform, @{app.author || app.creator} earns the royalty they set for building the original (frozen at fork time), and whoever sold it keeps the rest.
              </p>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setShowLineageModal(false)}
                className="bg-sky-600 hover:bg-sky-500 text-white px-4 py-1.5 rounded font-bold font-mono"
              >
                Close DAG View
              </button>
            </div>
          </div>
        </div>
      )}

      <ForkWithAiModal
        isOpen={showForkModal}
        onClose={() => setShowForkModal(false)}
        app={app}
      />

      <CheckoutModal
        isOpen={showCheckoutModal}
        onClose={() => setShowCheckoutModal(false)}
        app={app}
      />
    </div>
  );
};
