import React, { useState, useEffect, useRef } from 'react';
import {
  Mail,
  Printer,
  Copy,
  Save,
  Plus,
  Trash2,
  FileText,
  ShieldAlert,
  HelpCircle,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Send,
  RotateCcw,
  Check,
  Download,
  Upload,
  Sparkles,
  Info,
  Archive
} from 'lucide-react';
import {
  MailPiece,
  MailLifecycleStatus,
  EvidenceRecord,
  EvidenceType,
  CertifiedMailerStore,
  DisputeStarterTemplate,
  US_STATES,
  STARTER_TEMPLATES,
  CERTIFIED_MAILER_STORAGE_KEY,
  validateUSAddress,
  validateTrackingNumber,
  validateMailPiece,
  validateEvidenceRecord,
  canTransitionStatus,
  transitionMailPieceStatus,
  createEmptyStore,
  createNewMailPiece,
  loadStoreFromLocalStorage,
  saveStoreToLocalStorage,
  serializeStoreToJson,
  importStoreFromJson,
  formatAddressMultiLine,
  formatTrackingNumberForDisplay,
  generateNoticePlainText
} from '../lib/certifiedMailerDomain';
import { playClickSound, playSuccessChime, playErrorBeep } from '../lib/soundEngine';

type ActiveTab = 'editor' | 'lifecycle' | 'storage' | 'disclaimers';

export const CertifiedMailerStudio: React.FC = () => {
  const [initialLoad] = useState(() => loadStoreFromLocalStorage());
  const [store, setStore] = useState<CertifiedMailerStore>(initialLoad.store);
  const didMount = useRef(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>('editor');
  const [activeAddressTab, setActiveAddressTab] = useState<'sender' | 'recipient'>('sender');
  const [statusNotice, setStatusNotice] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(
    initialLoad.warning ? { text: initialLoad.warning, type: 'error' } : null
  );

  // Active mail piece selection
  const activePiece: MailPiece | undefined =
    store.pieces.find(p => p.id === store.activePieceId) || store.pieces[0];

  // Modal dialog states
  const [modalMode, setModalMode] = useState<
    | null
    | { type: 'template_picker' }
    | { type: 'transition'; targetStatus: MailLifecycleStatus }
    | { type: 'add_evidence' }
    | { type: 'delete_confirm'; pieceId: string }
    | { type: 'import_json' }
    | { type: 'clear_storage_confirm' }
  >(null);

  // Transition modal inputs
  const [transitionUserConfirmed, setTransitionUserConfirmed] = useState(false);
  const [transitionNotes, setTransitionNotes] = useState('');
  const [evidenceType, setEvidenceType] = useState<EvidenceType>('acceptance_receipt');
  const [evidenceTitle, setEvidenceTitle] = useState('');
  const [evidenceSource, setEvidenceSource] = useState('');
  const [evidenceObservedDate, setEvidenceObservedDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [evidenceReference, setEvidenceReference] = useState('');
  const [evidenceNotes, setEvidenceNotes] = useState('');

  // Import JSON modal text
  const [importJsonText, setImportJsonText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  // Auto-save store to localStorage when store changes
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    const result = saveStoreToLocalStorage(store);
    if (!result.success) {
      setStatusNotice({
        text: result.error || 'Certified Mailer could not save this change in browser storage.',
        type: 'error'
      });
    }
  }, [store]);

  useEffect(() => {
    if (!modalMode) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModalMode(null);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [modalMode]);

  const showNotification = (text: string, type: 'success' | 'info' | 'error' = 'info') => {
    setStatusNotice({ text, type });
    if (type === 'success') {
      playSuccessChime();
    } else if (type === 'error') {
      playErrorBeep();
    }
    setTimeout(() => {
      setStatusNotice(prev => (prev?.text === text ? null : prev));
    }, 4000);
  };

  // Helper to update active mail piece
  const updateActivePiece = (updater: (prevPiece: MailPiece) => MailPiece) => {
    if (!activePiece) return;
    const updated = updater(activePiece);
    const updatedWithTimestamp = {
      ...updated,
      updatedAt: new Date().toISOString()
    };
    setStore(prev => ({
      ...prev,
      pieces: prev.pieces.map(p => (p.id === activePiece.id ? updatedWithTimestamp : p))
    }));
  };

  // Create new mail piece
  const handleCreateNewPiece = (template?: DisputeStarterTemplate) => {
    playClickSound();
    const newPiece = createNewMailPiece(undefined, template);
    setStore(prev => ({
      ...prev,
      activePieceId: newPiece.id,
      pieces: [newPiece, ...prev.pieces]
    }));
    setModalMode(null);
    setActiveTab('editor');
    showNotification(
      template
        ? `Created draft from "${template.name}". Please fill in your sender details.`
        : 'Created new blank mail piece draft.',
      'success'
    );
  };

  // Delete mail piece
  const handleDeletePiece = (pieceId: string) => {
    playClickSound();
    setStore(prev => {
      const filtered = prev.pieces.filter(p => p.id !== pieceId);
      return {
        ...prev,
        activePieceId: filtered.length > 0 ? filtered[0].id : null,
        pieces: filtered
      };
    });
    setModalMode(null);
    showNotification('Mail piece deleted from local storage.', 'info');
  };

  // Switch active piece
  const handleSelectPiece = (pieceId: string) => {
    playClickSound();
    setStore(prev => ({
      ...prev,
      activePieceId: pieceId
    }));
  };

  // Transition status handler
  const handleExecuteTransition = (targetStatus: MailLifecycleStatus) => {
    if (!activePiece) return;

    let pendingEvidence: Partial<EvidenceRecord> | undefined;
    if (targetStatus === 'mailed' || targetStatus === 'delivered' || targetStatus === 'returned' || modalMode?.type === 'add_evidence') {
      if (evidenceTitle.trim() || evidenceSource.trim()) {
        pendingEvidence = {
          type: evidenceType,
          title: evidenceTitle.trim() || `${targetStatus.toUpperCase()} Evidence Record`,
          source: evidenceSource.trim(),
          observedDate: evidenceObservedDate.trim(),
          reference: evidenceReference.trim() || undefined,
          notes: evidenceNotes.trim() || undefined
        };
      }
    }

    const { updatedPiece, error } = transitionMailPieceStatus(activePiece, targetStatus, {
      userConfirmed: transitionUserConfirmed,
      notes: transitionNotes,
      newEvidence: pendingEvidence
    });

    if (error) {
      playErrorBeep();
      showNotification(error, 'error');
      return;
    }

    updateActivePiece(() => updatedPiece);
    setModalMode(null);
    setTransitionUserConfirmed(false);
    setTransitionNotes('');
    setEvidenceTitle('');
    setEvidenceSource('');
    setEvidenceReference('');
    setEvidenceNotes('');
    showNotification(`Mail piece status moved to ${targetStatus.toUpperCase()}.`, 'success');
  };

  // Add ad-hoc evidence record
  const handleAddEvidenceOnly = () => {
    if (!activePiece) return;
    const newRecord: EvidenceRecord = {
      id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: evidenceType,
      title: evidenceTitle.trim() || 'Evidence Journal Record',
      source: evidenceSource.trim() || 'User Observation',
      observedDate: evidenceObservedDate.trim(),
      reference: evidenceReference.trim() || undefined,
      notes: evidenceNotes.trim() || undefined,
      createdAt: new Date().toISOString()
    };

    const validation = validateEvidenceRecord(newRecord);
    if (!validation.isValid) {
      const err = Object.values(validation.errors)[0] || 'Invalid evidence record';
      playErrorBeep();
      showNotification(err, 'error');
      return;
    }

    updateActivePiece(prev => ({
      ...prev,
      evidence: [...prev.evidence, newRecord]
    }));

    setModalMode(null);
    setEvidenceTitle('');
    setEvidenceSource('');
    setEvidenceReference('');
    setEvidenceNotes('');
    showNotification('Evidence record logged in local journal.', 'success');
  };

  // Copy notice plain text
  const handleCopyNotice = async () => {
    if (!activePiece) return;
    playClickSound();
    const notice = generateNoticePlainText(activePiece);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(notice);
        showNotification('Notice text copied to clipboard.', 'success');
      } else {
        // Fallback
        const textarea = document.createElement('textarea');
        textarea.value = notice;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showNotification('Notice text copied to clipboard.', 'success');
      }
    } catch {
      showNotification('Clipboard write failed. Please select and copy text manually.', 'error');
    }
  };

  // Print letter
  const handlePrintLetter = () => {
    playClickSound();
    window.print();
  };

  // Export JSON
  const handleExportJson = () => {
    playClickSound();
    const jsonStr = serializeStoreToJson(store);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `certified-mailer-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotification('Exported local records to JSON backup.', 'success');
  };

  // Import JSON
  const handleImportJson = () => {
    playClickSound();
    setImportError(null);
    const result = importStoreFromJson(importJsonText);
    if (!result.success || !result.store) {
      setImportError(result.error || 'Failed to parse JSON file.');
      playErrorBeep();
      return;
    }

    setStore(result.store);
    setModalMode(null);
    setImportJsonText('');
    showNotification(`Successfully imported ${result.importedCount} mail piece(s).`, 'success');
  };

  // File upload for JSON import
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      const text = evt.target?.result as string;
      if (text) {
        setImportJsonText(text);
      }
    };
    reader.readAsText(file);
  };

  // Clear all local storage
  const handleClearLocalStorage = () => {
    playClickSound();
    const empty = createEmptyStore();
    setStore(empty);
    saveStoreToLocalStorage(empty);
    setModalMode(null);
    showNotification('All local records cleared. Starting fresh.', 'info');
  };

  // Validation results for currently active piece
  const pieceValidation = activePiece ? validateMailPiece(activePiece) : null;
  const trackingValidation = activePiece ? validateTrackingNumber(activePiece.trackingNumber) : null;
  const senderValidation = activePiece ? validateUSAddress(activePiece.sender) : null;
  const recipientValidation = activePiece ? validateUSAddress(activePiece.recipient) : null;

  return (
    <div className="h-full flex flex-col bg-[#ece9d8] font-tahoma text-xs overflow-hidden text-gray-900">
      {/* Top Application Header Bar */}
      <header className="bg-gradient-to-r from-[#000080] via-[#104e8b] to-[#000080] text-white px-3 py-1.5 flex items-center justify-between border-b-2 border-gray-400 select-none shrink-0 shadow-sm">
        <div className="flex items-center gap-2">
          <Mail size={16} className="text-yellow-300" aria-hidden="true" />
          <h1 className="font-bold text-xs tracking-wide">CERTIFIED MAILER v1.0</h1>
          <span className="bg-blue-900 border border-blue-400 text-[10px] px-1.5 py-0.5 rounded font-mono text-cyan-200">
            Local-First Journal
          </span>
        </div>

        {/* Global Action Tools */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              playClickSound();
              setModalMode({ type: 'template_picker' });
            }}
            className="btn-w95 text-[11px] py-0.5 px-2 flex items-center gap-1 font-bold text-blue-950 bg-amber-100 hover:bg-amber-200 border-amber-300"
            title="Open sample starter templates (Not legal advice)"
          >
            <Sparkles size={11} className="text-amber-700" />
            <span>Templates</span>
          </button>

          <button
            onClick={() => handleCreateNewPiece()}
            className="btn-w95 btn-w95-primary text-[11px] py-0.5 px-2 flex items-center gap-1 font-bold"
            title="Create a new blank mail piece"
          >
            <Plus size={12} />
            <span>New Mail Piece</span>
          </button>
        </div>
      </header>

      {/* Accessible Live Status Banner */}
      {statusNotice && (
        <div
          role="status"
          aria-live="polite"
          className={`px-3 py-1 text-xs border-b font-mono flex items-center justify-between ${
            statusNotice.type === 'success'
              ? 'bg-emerald-100 text-emerald-950 border-emerald-300'
              : statusNotice.type === 'error'
              ? 'bg-rose-100 text-rose-950 border-rose-300'
              : 'bg-amber-100 text-amber-950 border-amber-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusNotice.type === 'success' && <CheckCircle2 size={13} className="text-emerald-700" />}
            {statusNotice.type === 'error' && <AlertTriangle size={13} className="text-rose-700" />}
            {statusNotice.type === 'info' && <Info size={13} className="text-amber-700" />}
            <span>{statusNotice.text}</span>
          </div>
          <button
            onClick={() => setStatusNotice(null)}
            className="text-[10px] underline font-sans text-gray-600 hover:text-black ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Studio Body (Split View) */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Pane: Mail Piece Selector, Forms, Tabs */}
        <div className="w-full md:w-[420px] lg:w-[460px] bg-[#d4d0c8] border-r-2 border-gray-400 flex flex-col overflow-hidden shrink-0">
          {/* Mail Piece Selector Dropdown & Quick Info */}
          <div className="p-2 border-b border-gray-300 bg-gray-200 flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              <label htmlFor="piece-selector" className="sr-only">
                Select Active Mail Piece
              </label>
              {store.pieces.length === 0 ? (
                <div className="text-xs text-gray-600 italic px-1 py-1">No mail pieces in local store</div>
              ) : (
                <select
                  id="piece-selector"
                  value={activePiece?.id || ''}
                  onChange={e => handleSelectPiece(e.target.value)}
                  className="w-full bg-white border border-gray-400 p-1 text-xs font-bold text-gray-800 outline-none focus:ring-1 focus:ring-blue-600"
                >
                  {store.pieces.map(p => (
                    <option key={p.id} value={p.id}>
                      [{p.status.toUpperCase()}] {p.title || 'Untitled Mail Piece'}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {activePiece && (
              <button
                onClick={() => {
                  playClickSound();
                  setModalMode({ type: 'delete_confirm', pieceId: activePiece.id });
                }}
                className="btn-w95 text-[11px] p-1 text-rose-800 hover:bg-rose-100"
                title="Delete this mail piece"
                aria-label="Delete active mail piece"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b-2 border-gray-400 bg-gray-200 px-1 pt-1 gap-1 select-none text-[11px] font-bold">
            <button
              onClick={() => {
                playClickSound();
                setActiveTab('editor');
              }}
              className={`px-3 py-1.5 border-t border-l border-r rounded-t transition-colors ${
                activeTab === 'editor'
                  ? 'bg-[#ece9d8] border-gray-400 text-blue-950 font-bold border-b-2 border-b-[#ece9d8] -mb-[2px] z-10'
                  : 'bg-gray-300 border-gray-400 text-gray-600 hover:bg-gray-200'
              }`}
            >
              📝 Letter Editor
            </button>
            <button
              onClick={() => {
                playClickSound();
                setActiveTab('lifecycle');
              }}
              className={`px-3 py-1.5 border-t border-l border-r rounded-t transition-colors flex items-center gap-1 ${
                activeTab === 'lifecycle'
                  ? 'bg-[#ece9d8] border-gray-400 text-blue-950 font-bold border-b-2 border-b-[#ece9d8] -mb-[2px] z-10'
                  : 'bg-gray-300 border-gray-400 text-gray-600 hover:bg-gray-200'
              }`}
            >
              📮 Lifecycle & Evidence
              {activePiece && activePiece.evidence.length > 0 && (
                <span className="bg-blue-800 text-white rounded-full px-1.5 py-0.2 text-[9px]">
                  {activePiece.evidence.length}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                playClickSound();
                setActiveTab('storage');
              }}
              className={`px-3 py-1.5 border-t border-l border-r rounded-t transition-colors ${
                activeTab === 'storage'
                  ? 'bg-[#ece9d8] border-gray-400 text-blue-950 font-bold border-b-2 border-b-[#ece9d8] -mb-[2px] z-10'
                  : 'bg-gray-300 border-gray-400 text-gray-600 hover:bg-gray-200'
              }`}
            >
              💾 Storage
            </button>
            <button
              onClick={() => {
                playClickSound();
                setActiveTab('disclaimers');
              }}
              className={`px-3 py-1.5 border-t border-l border-r rounded-t transition-colors ${
                activeTab === 'disclaimers'
                  ? 'bg-[#ece9d8] border-gray-400 text-blue-950 font-bold border-b-2 border-b-[#ece9d8] -mb-[2px] z-10'
                  : 'bg-gray-300 border-gray-400 text-gray-600 hover:bg-gray-200'
              }`}
            >
              ℹ️ Disclaimers
            </button>
          </div>

          {/* Tab Contents */}
          <div className="flex-1 p-3 overflow-y-auto bg-[#ece9d8]">
            {/* If no active piece is available, show empty state prompt */}
            {!activePiece ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4">
                <div className="w-12 h-12 rounded-full bg-blue-100 border border-blue-300 flex items-center justify-center text-blue-900">
                  <Mail size={24} />
                </div>
                <div>
                  <h2 className="font-bold text-sm text-gray-800">No Mail Pieces Yet</h2>
                  <p className="text-gray-600 text-xs mt-1 max-w-xs">
                    Your journal is completely blank and private. No records leave this browser.
                  </p>
                </div>
                <div className="flex flex-col gap-2 w-full max-w-xs">
                  <button
                    onClick={() => handleCreateNewPiece()}
                    className="btn-w95 btn-w95-primary w-full py-1.5 font-bold"
                  >
                    + Create Blank Draft
                  </button>
                  <button
                    onClick={() => {
                      playClickSound();
                      setModalMode({ type: 'template_picker' });
                    }}
                    className="btn-w95 w-full py-1.5 font-bold bg-amber-100 hover:bg-amber-200 border-amber-300 text-amber-900"
                  >
                    <Sparkles size={13} className="mr-1 inline" />
                    Explore Starter Templates
                  </button>
                </div>
              </div>
            ) : activeTab === 'editor' ? (
              /* TAB 1: LETTER EDITOR */
              <div className="space-y-3">
                {/* Mail Piece Title & Category */}
                <div className="bg-white border border-gray-400 p-2 space-y-2">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label htmlFor="piece-title" className="block text-gray-700 font-bold mb-0.5 text-[11px]">
                        Mail Piece Name / Label *
                      </label>
                      <input
                        id="piece-title"
                        type="text"
                        value={activePiece.title}
                        onChange={e => updateActivePiece(p => ({ ...p, title: e.target.value }))}
                        placeholder="e.g. Security Deposit Demand Notice"
                        className="w-full bg-white border border-gray-400 p-1 text-xs outline-none focus:ring-1 focus:ring-blue-600"
                      />
                      {pieceValidation?.errors.title && (
                        <p role="alert" className="text-rose-700 text-[10px] mt-0.5">
                          {pieceValidation.errors.title}
                        </p>
                      )}
                    </div>
                    <div className="w-1/3">
                      <label htmlFor="piece-ref" className="block text-gray-700 font-bold mb-0.5 text-[11px]">
                        Account / Case #
                      </label>
                      <input
                        id="piece-ref"
                        type="text"
                        value={activePiece.referenceNumber || ''}
                        onChange={e => updateActivePiece(p => ({ ...p, referenceNumber: e.target.value }))}
                        placeholder="e.g. ACCT-8921"
                        className="w-full bg-white border border-gray-400 p-1 text-xs outline-none focus:ring-1 focus:ring-blue-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="statutory-ref" className="block text-gray-700 font-bold mb-0.5 text-[11px]">
                      Statutory Basis / Reference (Optional)
                    </label>
                    <input
                      id="statutory-ref"
                      type="text"
                      value={activePiece.statutoryReference || ''}
                      onChange={e => updateActivePiece(p => ({ ...p, statutoryReference: e.target.value }))}
                      placeholder="e.g. Tex. Prop. Code § 92.103 or 15 U.S.C. § 1681s-2"
                      className="w-full bg-white border border-gray-400 p-1 text-xs outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>
                </div>

                {/* Structured Address Switcher (Sender vs Recipient) */}
                <div className="bg-white border border-gray-400 p-2 space-y-2">
                  <div className="flex items-center justify-between border-b pb-1">
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          playClickSound();
                          setActiveAddressTab('sender');
                        }}
                        className={`px-2 py-0.5 text-xs font-bold border ${
                          activeAddressTab === 'sender'
                            ? 'bg-blue-900 text-white border-blue-900'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-300'
                        }`}
                      >
                        Sender Address (From)
                        {!senderValidation?.isValid && <span className="text-rose-300 ml-1">●</span>}
                      </button>
                      <button
                        onClick={() => {
                          playClickSound();
                          setActiveAddressTab('recipient');
                        }}
                        className={`px-2 py-0.5 text-xs font-bold border ${
                          activeAddressTab === 'recipient'
                            ? 'bg-blue-900 text-white border-blue-900'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-300'
                        }`}
                      >
                        Recipient Address (To)
                        {!recipientValidation?.isValid && <span className="text-rose-300 ml-1">●</span>}
                      </button>
                    </div>

                    <span className="text-[10px] text-gray-500 font-mono">
                      {activeAddressTab === 'sender'
                        ? senderValidation?.isValid
                          ? '✔ Complete'
                          : '⚠️ Incomplete'
                        : recipientValidation?.isValid
                        ? '✔ Complete'
                        : '⚠️ Incomplete'}
                    </span>
                  </div>

                  {activeAddressTab === 'sender' ? (
                    /* Sender Structured Fields */
                    <div className="space-y-1.5 pt-1">
                      <div>
                        <label htmlFor="sender-name" className="block text-gray-700 font-bold text-[10px]">
                          Sender Full Name / Business Name *
                        </label>
                        <input
                          id="sender-name"
                          type="text"
                          value={activePiece.sender.name}
                          onChange={e =>
                            updateActivePiece(p => ({
                              ...p,
                              sender: { ...p.sender, name: e.target.value }
                            }))
                          }
                          placeholder="Your Name or Organization"
                          className="w-full bg-white border border-gray-400 p-1 text-xs outline-none focus:ring-1 focus:ring-blue-600"
                        />
                        {senderValidation?.errors.name && (
                          <p role="alert" className="text-rose-700 text-[10px]">
                            {senderValidation.errors.name}
                          </p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="sender-line1" className="block text-gray-700 font-bold text-[10px]">
                          Street Address Line 1 *
                        </label>
                        <input
                          id="sender-line1"
                          type="text"
                          value={activePiece.sender.addressLine1}
                          onChange={e =>
                            updateActivePiece(p => ({
                              ...p,
                              sender: { ...p.sender, addressLine1: e.target.value }
                            }))
                          }
                          placeholder="123 Main St"
                          className="w-full bg-white border border-gray-400 p-1 text-xs outline-none focus:ring-1 focus:ring-blue-600"
                        />
                        {senderValidation?.errors.addressLine1 && (
                          <p role="alert" className="text-rose-700 text-[10px]">
                            {senderValidation.errors.addressLine1}
                          </p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="sender-line2" className="block text-gray-700 font-bold text-[10px]">
                          Address Line 2 (Apt, Suite, Unit, P.O. Box)
                        </label>
                        <input
                          id="sender-line2"
                          type="text"
                          value={activePiece.sender.addressLine2 || ''}
                          onChange={e =>
                            updateActivePiece(p => ({
                              ...p,
                              sender: { ...p.sender, addressLine2: e.target.value }
                            }))
                          }
                          placeholder="Suite 400 (Optional)"
                          className="w-full bg-white border border-gray-400 p-1 text-xs outline-none focus:ring-1 focus:ring-blue-600"
                        />
                      </div>

                      <div className="grid grid-cols-12 gap-1.5">
                        <div className="col-span-6">
                          <label htmlFor="sender-city" className="block text-gray-700 font-bold text-[10px]">
                            City *
                          </label>
                          <input
                            id="sender-city"
                            type="text"
                            value={activePiece.sender.city}
                            onChange={e =>
                              updateActivePiece(p => ({
                                ...p,
                                sender: { ...p.sender, city: e.target.value }
                              }))
                            }
                            placeholder="Austin"
                            className="w-full bg-white border border-gray-400 p-1 text-xs outline-none focus:ring-1 focus:ring-blue-600"
                          />
                          {senderValidation?.errors.city && (
                            <p role="alert" className="text-rose-700 text-[10px]">
                              {senderValidation.errors.city}
                            </p>
                          )}
                        </div>

                        <div className="col-span-3">
                          <label htmlFor="sender-state" className="block text-gray-700 font-bold text-[10px]">
                            State *
                          </label>
                          <select
                            id="sender-state"
                            value={activePiece.sender.state}
                            onChange={e =>
                              updateActivePiece(p => ({
                                ...p,
                                sender: { ...p.sender, state: e.target.value }
                              }))
                            }
                            className="w-full bg-white border border-gray-400 p-1 text-xs outline-none focus:ring-1 focus:ring-blue-600 font-mono"
                          >
                            <option value="">--</option>
                            {US_STATES.map(s => (
                              <option key={s.code} value={s.code}>
                                {s.code} - {s.name}
                              </option>
                            ))}
                          </select>
                          {senderValidation?.errors.state && (
                            <p role="alert" className="text-rose-700 text-[10px]">
                              {senderValidation.errors.state}
                            </p>
                          )}
                        </div>

                        <div className="col-span-3">
                          <label htmlFor="sender-zip" className="block text-gray-700 font-bold text-[10px]">
                            ZIP *
                          </label>
                          <input
                            id="sender-zip"
                            type="text"
                            value={activePiece.sender.postalCode}
                            onChange={e =>
                              updateActivePiece(p => ({
                                ...p,
                                sender: { ...p.sender, postalCode: e.target.value }
                              }))
                            }
                            placeholder="78701"
                            className="w-full bg-white border border-gray-400 p-1 text-xs outline-none focus:ring-1 focus:ring-blue-600 font-mono"
                          />
                          {senderValidation?.errors.postalCode && (
                            <p role="alert" className="text-rose-700 text-[10px]">
                              {senderValidation.errors.postalCode}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Recipient Structured Fields */
                    <div className="space-y-1.5 pt-1">
                      <div>
                        <label htmlFor="recipient-name" className="block text-gray-700 font-bold text-[10px]">
                          Recipient Individual / Organization Name *
                        </label>
                        <input
                          id="recipient-name"
                          type="text"
                          value={activePiece.recipient.name}
                          onChange={e =>
                            updateActivePiece(p => ({
                              ...p,
                              recipient: { ...p.recipient, name: e.target.value }
                            }))
                          }
                          placeholder="Recipient Company / Individual"
                          className="w-full bg-white border border-gray-400 p-1 text-xs outline-none focus:ring-1 focus:ring-blue-600"
                        />
                        {recipientValidation?.errors.name && (
                          <p role="alert" className="text-rose-700 text-[10px]">
                            {recipientValidation.errors.name}
                          </p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="recipient-line1" className="block text-gray-700 font-bold text-[10px]">
                          Street Address Line 1 *
                        </label>
                        <input
                          id="recipient-line1"
                          type="text"
                          value={activePiece.recipient.addressLine1}
                          onChange={e =>
                            updateActivePiece(p => ({
                              ...p,
                              recipient: { ...p.recipient, addressLine1: e.target.value }
                            }))
                          }
                          placeholder="400 Congress Ave"
                          className="w-full bg-white border border-gray-400 p-1 text-xs outline-none focus:ring-1 focus:ring-blue-600"
                        />
                        {recipientValidation?.errors.addressLine1 && (
                          <p role="alert" className="text-rose-700 text-[10px]">
                            {recipientValidation.errors.addressLine1}
                          </p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="recipient-line2" className="block text-gray-700 font-bold text-[10px]">
                          Address Line 2 (Suite, Floor, Dept, P.O. Box)
                        </label>
                        <input
                          id="recipient-line2"
                          type="text"
                          value={activePiece.recipient.addressLine2 || ''}
                          onChange={e =>
                            updateActivePiece(p => ({
                              ...p,
                              recipient: { ...p.recipient, addressLine2: e.target.value }
                            }))
                          }
                          placeholder="Suite 1000 (Optional)"
                          className="w-full bg-white border border-gray-400 p-1 text-xs outline-none focus:ring-1 focus:ring-blue-600"
                        />
                      </div>

                      <div className="grid grid-cols-12 gap-1.5">
                        <div className="col-span-6">
                          <label htmlFor="recipient-city" className="block text-gray-700 font-bold text-[10px]">
                            City *
                          </label>
                          <input
                            id="recipient-city"
                            type="text"
                            value={activePiece.recipient.city}
                            onChange={e =>
                              updateActivePiece(p => ({
                                ...p,
                                recipient: { ...p.recipient, city: e.target.value }
                              }))
                            }
                            placeholder="Austin"
                            className="w-full bg-white border border-gray-400 p-1 text-xs outline-none focus:ring-1 focus:ring-blue-600"
                          />
                          {recipientValidation?.errors.city && (
                            <p role="alert" className="text-rose-700 text-[10px]">
                              {recipientValidation.errors.city}
                            </p>
                          )}
                        </div>

                        <div className="col-span-3">
                          <label htmlFor="recipient-state" className="block text-gray-700 font-bold text-[10px]">
                            State *
                          </label>
                          <select
                            id="recipient-state"
                            value={activePiece.recipient.state}
                            onChange={e =>
                              updateActivePiece(p => ({
                                ...p,
                                recipient: { ...p.recipient, state: e.target.value }
                              }))
                            }
                            className="w-full bg-white border border-gray-400 p-1 text-xs outline-none focus:ring-1 focus:ring-blue-600 font-mono"
                          >
                            <option value="">--</option>
                            {US_STATES.map(s => (
                              <option key={s.code} value={s.code}>
                                {s.code} - {s.name}
                              </option>
                            ))}
                          </select>
                          {recipientValidation?.errors.state && (
                            <p role="alert" className="text-rose-700 text-[10px]">
                              {recipientValidation.errors.state}
                            </p>
                          )}
                        </div>

                        <div className="col-span-3">
                          <label htmlFor="recipient-zip" className="block text-gray-700 font-bold text-[10px]">
                            ZIP *
                          </label>
                          <input
                            id="recipient-zip"
                            type="text"
                            value={activePiece.recipient.postalCode}
                            onChange={e =>
                              updateActivePiece(p => ({
                                ...p,
                                recipient: { ...p.recipient, postalCode: e.target.value }
                              }))
                            }
                            placeholder="78701"
                            className="w-full bg-white border border-gray-400 p-1 text-xs outline-none focus:ring-1 focus:ring-blue-600 font-mono"
                          />
                          {recipientValidation?.errors.postalCode && (
                            <p role="alert" className="text-rose-700 text-[10px]">
                              {recipientValidation.errors.postalCode}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Tracking Number (Optional & User-Entered) */}
                <div className="bg-white border border-gray-400 p-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor="piece-tracking" className="block text-gray-700 font-bold text-[11px]">
                      USPS Certified Article # (Optional)
                    </label>
                    <span className="text-[10px] font-mono text-amber-800 bg-amber-50 px-1 py-0.5 rounded border border-amber-200">
                      ⚠️ User-Entered · Unverified
                    </span>
                  </div>
                  <input
                    id="piece-tracking"
                    type="text"
                    value={activePiece.trackingNumber || ''}
                    onChange={e =>
                      updateActivePiece(p => ({
                        ...p,
                        trackingNumber: e.target.value
                      }))
                    }
                    placeholder="e.g. 9407 1118 9956 2210 4401 22 (from PS Form 3800)"
                    className="w-full bg-white border border-gray-400 p-1 text-xs font-mono outline-none focus:ring-1 focus:ring-blue-600"
                  />
                  {trackingValidation && !trackingValidation.isValid && (
                    <p role="alert" className="text-rose-700 text-[10px]">
                      {trackingValidation.error}
                    </p>
                  )}
                  <p className="text-[10px] text-gray-500 leading-tight">
                    Enter the 20-22 digit article number from your USPS PS Form 3800 Certified Mail receipt. This app does not sync with USPS tracking APIs.
                  </p>
                </div>

                {/* Letter Subject & Body Content */}
                <div className="bg-white border border-gray-400 p-2 space-y-2">
                  <div>
                    <label htmlFor="letter-subject" className="block text-gray-700 font-bold mb-0.5 text-[11px]">
                      Subject Line *
                    </label>
                    <input
                      id="letter-subject"
                      type="text"
                      value={activePiece.subject}
                      onChange={e => updateActivePiece(p => ({ ...p, subject: e.target.value }))}
                      placeholder="e.g. Demand for Full Return of Security Deposit"
                      className="w-full bg-white border border-gray-400 p-1 text-xs outline-none focus:ring-1 focus:ring-blue-600"
                    />
                    {pieceValidation?.errors.subject && (
                      <p role="alert" className="text-rose-700 text-[10px] mt-0.5">
                        {pieceValidation.errors.subject}
                      </p>
                    )}
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-0.5">
                      <label htmlFor="letter-body" className="block text-gray-700 font-bold text-[11px]">
                        Letter Body *
                      </label>
                      <span className="text-[10px] font-mono text-gray-500">
                        {activePiece.body.length} / 20,000 chars
                      </span>
                    </div>
                    <textarea
                      id="letter-body"
                      rows={8}
                      value={activePiece.body}
                      onChange={e => updateActivePiece(p => ({ ...p, body: e.target.value }))}
                      placeholder="Enter the complete formal notice or letter text..."
                      className="w-full bg-white border border-gray-400 p-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-600 font-serif leading-relaxed"
                    />
                    {pieceValidation?.errors.body && (
                      <p role="alert" className="text-rose-700 text-[10px]">
                        {pieceValidation.errors.body}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : activeTab === 'lifecycle' ? (
              /* TAB 2: LIFECYCLE & EVIDENCE JOURNAL */
              <div className="space-y-3">
                {/* Current Status Box */}
                <div className="bg-white border border-gray-400 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">
                        Current Status
                      </span>
                      <div className="text-sm font-bold text-blue-950 flex items-center gap-1.5 mt-0.5">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            activePiece.status === 'draft'
                              ? 'bg-amber-500'
                              : activePiece.status === 'ready_to_print'
                              ? 'bg-cyan-500'
                              : activePiece.status === 'mailed'
                              ? 'bg-blue-600'
                              : activePiece.status === 'delivered'
                              ? 'bg-emerald-600'
                              : activePiece.status === 'returned'
                              ? 'bg-purple-600'
                              : 'bg-gray-600'
                          }`}
                        />
                        <span>{activePiece.status.replace(/_/g, ' ').toUpperCase()}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        playClickSound();
                        setModalMode({ type: 'add_evidence' });
                      }}
                      className="btn-w95 text-[11px] py-1 px-2 flex items-center gap-1 font-bold"
                    >
                      <Plus size={11} />
                      <span>Log Evidence Record</span>
                    </button>
                  </div>

                  {/* Transition Action Buttons with Guards */}
                  <div className="border-t pt-2 space-y-1.5">
                    <div className="text-[10px] font-bold text-gray-700">Available Guarded Transitions:</div>

                    {activePiece.status === 'draft' && (
                      <button
                        onClick={() => handleExecuteTransition('ready_to_print')}
                        disabled={!canTransitionStatus(activePiece, 'ready_to_print').allowed}
                        className="btn-w95 btn-w95-primary w-full py-1 text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        <CheckCircle2 size={13} />
                        <span>Advance to Ready to Print</span>
                      </button>
                    )}

                    {activePiece.status === 'ready_to_print' && (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => {
                            playClickSound();
                            setTransitionUserConfirmed(false);
                            setEvidenceType('acceptance_receipt');
                            setEvidenceTitle('USPS Retail Acceptance Receipt PS 3800');
                            setEvidenceSource('Post Office Counter');
                            setModalMode({ type: 'transition', targetStatus: 'mailed' });
                          }}
                          className="btn-w95 btn-w95-primary py-1.5 text-xs flex items-center justify-center gap-1 font-bold"
                        >
                          <Send size={12} />
                          <span>Mark Mailed...</span>
                        </button>

                        <button
                          onClick={() => handleExecuteTransition('draft')}
                          className="btn-w95 py-1.5 text-xs flex items-center justify-center gap-1"
                        >
                          <RotateCcw size={12} />
                          <span>Return to Draft</span>
                        </button>
                      </div>
                    )}

                    {activePiece.status === 'mailed' && (
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => {
                              playClickSound();
                              setTransitionUserConfirmed(false);
                              setEvidenceType('delivery_receipt');
                              setEvidenceTitle('Signed Return Receipt PS 3811 (Green Card)');
                              setEvidenceSource('Physical Mail Delivery Confirmation');
                              setModalMode({ type: 'transition', targetStatus: 'delivered' });
                            }}
                            className="btn-w95 bg-emerald-800 text-white hover:bg-emerald-900 border-emerald-950 py-1.5 text-xs flex items-center justify-center gap-1 font-bold"
                          >
                            <Check size={12} />
                            <span>Mark Delivered...</span>
                          </button>

                          <button
                            onClick={() => {
                              playClickSound();
                              setTransitionUserConfirmed(false);
                            setEvidenceType('return_notice');
                              setEvidenceTitle('USPS Return to Sender Postal Marking');
                              setEvidenceSource('Returned Envelope Inspection');
                              setModalMode({ type: 'transition', targetStatus: 'returned' });
                            }}
                            className="btn-w95 bg-purple-900 text-white hover:bg-purple-950 border-purple-950 py-1.5 text-xs flex items-center justify-center gap-1 font-bold"
                          >
                            <RotateCcw size={12} />
                            <span>Mark Returned...</span>
                          </button>
                        </div>

                        <button
                          onClick={() => {
                            playClickSound();
                            setTransitionUserConfirmed(false);
                            setModalMode({ type: 'transition', targetStatus: 'closed' });
                          }}
                          className="btn-w95 w-full py-1 text-xs flex items-center justify-center gap-1 text-gray-700"
                        >
                          <Archive size={12} />
                          <span>Close Mail Piece...</span>
                        </button>
                      </div>
                    )}

                    {(activePiece.status === 'delivered' || activePiece.status === 'returned') && (
                      <button
                        onClick={() => {
                          playClickSound();
                          setTransitionUserConfirmed(false);
                          setModalMode({ type: 'transition', targetStatus: 'closed' });
                        }}
                        className="btn-w95 btn-w95-primary w-full py-1.5 text-xs flex items-center justify-center gap-1 font-bold"
                      >
                        <Archive size={12} />
                        <span>Close &amp; Archive Record...</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Evidence Records Journal */}
                <div className="bg-white border border-gray-400 p-3 space-y-2">
                  <div className="flex items-center justify-between border-b pb-1">
                    <h3 className="font-bold text-xs text-gray-800 flex items-center gap-1.5">
                      <FileText size={13} className="text-blue-900" />
                      <span>Evidence Records ({activePiece.evidence.length})</span>
                    </h3>
                    <span className="text-[10px] text-gray-500 italic">Self-entered journal</span>
                  </div>

                  {activePiece.evidence.length === 0 ? (
                    <div className="text-gray-500 text-center py-4 text-xs italic bg-gray-50 border border-dashed border-gray-300">
                      No evidence records logged yet. Evidence records store your postal receipts, tracking observations, and return cards.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {activePiece.evidence.map((ev, idx) => (
                        <div key={ev.id} className="p-2 border border-gray-300 bg-gray-50 text-[11px] space-y-1">
                          <div className="flex items-center justify-between font-bold">
                            <span className="text-blue-950">
                              {idx + 1}. {ev.title}
                            </span>
                            <span className="font-mono text-[10px] bg-blue-100 text-blue-900 px-1 py-0.2 rounded">
                              {ev.type.replace(/_/g, ' ').toUpperCase()}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 text-gray-600 text-[10px]">
                            <div>Observed: {ev.observedDate}</div>
                            <div>Source: {ev.source}</div>
                          </div>
                          {ev.reference && (
                            <div className="text-gray-700 font-mono text-[10px]">
                              Ref: {ev.reference}
                            </div>
                          )}
                          {ev.notes && <div className="text-gray-600 italic">{ev.notes}</div>}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="p-2 bg-amber-50 border border-amber-200 text-[10px] text-amber-900 leading-snug">
                    <strong>Notice:</strong> Certified Mailer does not verify or authenticate evidence. All evidence entries are user-recorded for personal recordkeeping.
                  </div>
                </div>

                {/* Transition History Audit Timeline */}
                <div className="bg-white border border-gray-400 p-3 space-y-2">
                  <h3 className="font-bold text-xs text-gray-800 flex items-center gap-1.5 border-b pb-1">
                    <Clock size={13} className="text-blue-900" />
                    <span>Lifecycle Transition Log</span>
                  </h3>
                  <div className="space-y-1.5 font-mono text-[10px]">
                    {activePiece.history.map(evt => (
                      <div key={evt.id} className="p-1.5 bg-gray-100 border border-gray-300">
                        <div className="flex justify-between font-bold text-gray-800">
                          <span>
                            {evt.fromStatus} → {evt.toStatus}
                          </span>
                          <span className="text-gray-500 font-normal">
                            {new Date(evt.timestamp).toLocaleString()}
                          </span>
                        </div>
                        {evt.notes && <div className="text-gray-600 font-sans mt-0.5">{evt.notes}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : activeTab === 'storage' ? (
              /* TAB 3: STORAGE & PORTABILITY */
              <div className="space-y-3">
                <div className="bg-white border border-gray-400 p-3 space-y-2">
                  <h3 className="font-bold text-xs text-blue-950 flex items-center gap-1.5">
                    <Save size={13} />
                    <span>Local-First Browser Persistence</span>
                  </h3>
                  <p className="text-[11px] text-gray-700 leading-relaxed">
                    Mail pieces and evidence records are saved in this site's browser storage (key: <code className="font-mono bg-gray-100 px-1">{CERTIFIED_MAILER_STORAGE_KEY}</code>). This storage is not encrypted; anyone with access to this browser profile may be able to read it.
                  </p>
                  <div className="p-2 bg-gray-100 border text-[11px] space-y-1 font-mono">
                    <div>Total Mail Pieces: {store.pieces.length}</div>
                    <div>Store Version: {store.version}</div>
                    <div>Active Piece ID: {store.activePieceId || 'None'}</div>
                  </div>
                </div>

                <div className="bg-white border border-gray-400 p-3 space-y-2">
                  <h3 className="font-bold text-xs text-blue-950 flex items-center gap-1.5">
                    <Download size={13} />
                    <span>JSON Backup &amp; Portability</span>
                  </h3>
                  <p className="text-[11px] text-gray-700 leading-relaxed">
                    Export your complete records to a standardized JSON backup file, or restore from an existing backup.
                  </p>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      onClick={handleExportJson}
                      className="btn-w95 btn-w95-primary py-1.5 text-xs flex items-center justify-center gap-1 font-bold"
                    >
                      <Download size={12} />
                      <span>Export All (JSON)</span>
                    </button>
                    <button
                      onClick={() => {
                        playClickSound();
                        setImportError(null);
                        setImportJsonText('');
                        setModalMode({ type: 'import_json' });
                      }}
                      className="btn-w95 py-1.5 text-xs flex items-center justify-center gap-1 font-bold"
                    >
                      <Upload size={12} />
                      <span>Import (JSON)...</span>
                    </button>
                  </div>
                </div>

                <div className="bg-white border border-rose-300 p-3 space-y-2">
                  <h3 className="font-bold text-xs text-rose-950 flex items-center gap-1.5">
                    <Trash2 size={13} className="text-rose-800" />
                    <span>Clear Local Storage</span>
                  </h3>
                  <p className="text-[11px] text-gray-700 leading-relaxed">
                    Clears all Certified Mailer records stored by this site in this browser profile. Export a JSON backup first if you want to keep your records.
                  </p>
                  <button
                    onClick={() => {
                      playClickSound();
                      setModalMode({ type: 'clear_storage_confirm' });
                    }}
                    className="btn-w95 btn-w95-danger py-1 px-3 text-xs flex items-center gap-1 font-bold"
                  >
                    <Trash2 size={12} />
                    <span>Clear All Local Storage Records</span>
                  </button>
                </div>
              </div>
            ) : (
              /* TAB 4: DISCLAIMERS & PRIVACY */
              <div className="space-y-3">
                <div className="bg-white border border-gray-400 p-3 space-y-2">
                  <h3 className="font-bold text-xs text-blue-950 flex items-center gap-1.5">
                    <ShieldAlert size={14} className="text-blue-800" />
                    <span>Privacy &amp; Data Ownership</span>
                  </h3>
                  <p className="text-[11px] text-gray-700 leading-relaxed">
                    Certified Mailer does not send addresses, notices, tracking numbers, or evidence records to a Nate's Software server. They are kept in this site's browser storage unless you export them. Browser extensions, browser sync, other people using this profile, or device backups may still have access. Clearing site data will delete these local records.
                  </p>
                </div>

                <div className="bg-white border border-gray-400 p-3 space-y-2">
                  <h3 className="font-bold text-xs text-amber-950 flex items-center gap-1.5">
                    <AlertTriangle size={14} className="text-amber-800" />
                    <span>Postal Service Disclosure</span>
                  </h3>
                  <p className="text-[11px] text-gray-700 leading-relaxed">
                    Certified Mailer is a mail preparation and evidence journaling utility. It is <strong>NOT affiliated with, endorsed by, or integrated with the United States Postal Service (USPS)</strong>.
                  </p>
                  <p className="text-[11px] text-gray-700 leading-relaxed">
                    Official Certified Mail forms (USPS PS Form 3800, PS Form 3811 Return Receipt) and valid postal rates must be obtained directly from an authorized USPS facility or licensed postal vendor.
                  </p>
                </div>

                <div className="bg-white border border-gray-400 p-3 space-y-2">
                  <h3 className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                    <HelpCircle size={14} className="text-gray-800" />
                    <span>No Legal Advice Warranty</span>
                  </h3>
                  <p className="text-[11px] text-gray-700 leading-relaxed">
                    Sample starter templates and statutory citations are provided strictly for educational and drafting convenience. Use of this application does not create an attorney-client relationship and does not constitute formal legal counsel. Users should verify statutory compliance in their specific jurisdiction.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Pane: Live Printable Letter Document Viewport */}
        <div className="flex-1 bg-slate-800 p-4 md:p-6 overflow-y-auto flex flex-col items-center">
          {/* Top Document Action Bar (Screen Only) */}
          <div className="w-full max-w-2xl bg-[#d4d0c8] border-2 border-gray-400 p-2 mb-4 flex items-center justify-between gap-2 shadow select-none print:hidden">
            <div className="flex items-center gap-2">
              <span className="font-bold text-xs text-gray-800">DOCUMENT PREVIEW</span>
              {activePiece && (
                <span className="text-[10px] font-mono bg-white px-2 py-0.5 border border-gray-400">
                  Status: {activePiece.status.toUpperCase()}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handlePrintLetter}
                disabled={!activePiece}
                className="btn-w95 btn-w95-primary py-1 px-2.5 text-xs flex items-center gap-1.5 font-bold disabled:opacity-50"
                title="Print clean letter page via browser"
              >
                <Printer size={13} />
                <span>Print Letter</span>
              </button>

              <button
                onClick={handleCopyNotice}
                disabled={!activePiece}
                className="btn-w95 py-1 px-2.5 text-xs flex items-center gap-1.5 disabled:opacity-50"
                title="Copy formatted plaintext notice to clipboard"
              >
                <Copy size={13} />
                <span>Copy Text</span>
              </button>
            </div>
          </div>

          {/* Letter Document Container (Printable) */}
          {activePiece ? (
            <div
              id="printable-certified-letter"
              className="w-full max-w-2xl bg-white text-gray-900 shadow-2xl p-8 md:p-10 border border-gray-300 font-serif min-h-[700px] flex flex-col justify-between select-text print:shadow-none print:border-none print:p-0 print:m-0 print:max-w-none print:w-full"
            >
              {/* Header Box */}
              <div>
                {/* Official Certified Mail Preparation Header Banner */}
                <div className="border-2 border-blue-900 p-3 mb-6 bg-slate-50 flex items-start justify-between font-sans">
                  <div>
                    <div className="font-bold text-xs text-blue-950 tracking-wider">
                      USPS CERTIFIED MAIL® PREPARATION &amp; JOURNAL RECORD
                    </div>
                    <div className="text-[9px] text-gray-500 mt-0.5">
                      Client-Side Journal Record · Affix Official USPS PS Form 3800 at Mailing
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="text-[9px] text-gray-500">USER-ENTERED ARTICLE #</div>
                    <div className="font-bold text-xs text-blue-950">
                      {activePiece.trackingNumber
                        ? formatTrackingNumberForDisplay(activePiece.trackingNumber)
                        : 'Not Specified (Unverified)'}
                    </div>
                  </div>
                </div>

                {/* Sender & Date Header */}
                <div className="flex justify-between items-start mb-6 font-sans text-xs">
                  <div>
                    <div className="font-bold text-gray-900 text-sm">
                      {activePiece.sender.name || '[Sender Name]'}
                    </div>
                    <div className="text-gray-600 whitespace-pre-line leading-relaxed">
                      {formatAddressMultiLine({
                        ...activePiece.sender,
                        name: ''
                      }).trim() || '[Sender Address Line, City, State ZIP]'}
                    </div>
                  </div>

                  <div className="text-right text-gray-600 font-mono text-[11px]">
                    <div>
                      Date:{' '}
                      {new Date(activePiece.updatedAt || activePiece.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </div>
                    {activePiece.referenceNumber && (
                      <div className="text-blue-950 font-bold mt-0.5">
                        Ref #: {activePiece.referenceNumber}
                      </div>
                    )}
                    {activePiece.statutoryReference && (
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        Basis: {activePiece.statutoryReference}
                      </div>
                    )}
                  </div>
                </div>

                {/* Recipient Block */}
                <div className="mb-6 font-sans text-xs bg-gray-50/70 p-3 border-l-4 border-blue-900">
                  <div className="text-gray-500 text-[9px] uppercase font-bold tracking-wider mb-1">
                    DELIVER VIA USPS CERTIFIED MAIL TO:
                  </div>
                  <div className="font-bold text-gray-900 text-sm">
                    {activePiece.recipient.name || '[Recipient Name]'}
                  </div>
                  <div className="text-gray-700 whitespace-pre-line leading-relaxed mt-0.5">
                    {formatAddressMultiLine({
                      ...activePiece.recipient,
                      name: ''
                    }).trim() || '[Recipient Street Address, City, State ZIP]'}
                  </div>
                </div>

                {/* Subject Line */}
                <div className="mb-4 font-sans font-bold text-xs text-gray-900 border-b border-gray-300 pb-1.5">
                  RE: {activePiece.subject || '[Subject Line]'}
                </div>

                {/* Letter Body Text */}
                <div className="font-serif text-[13px] leading-relaxed text-gray-800 whitespace-pre-line space-y-4 min-h-[220px]">
                  <p>To Whom It May Concern,</p>
                  <p>{activePiece.body || '[Letter body content will appear here...]'}</p>
                </div>
              </div>

              {/* Bottom Signature & Evidence Summary */}
              <div className="mt-8 pt-4 border-t border-gray-300 font-sans text-xs">
                <div className="flex justify-between items-end mb-6">
                  <div>
                    <div className="font-serif italic text-base font-bold text-gray-900">
                      {activePiece.sender.name || '[Signature]'}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">Sender &amp; Signatory</div>
                  </div>

                  <div className="text-right text-[10px] text-gray-500 font-mono">
                    <div>Status: {activePiece.status.toUpperCase()}</div>
                    <div>Piece ID: {activePiece.id}</div>
                  </div>
                </div>

                {/* Evidence Summary Box */}
                {activePiece.evidence.length > 0 && (
                  <div className="p-2.5 bg-gray-50 border border-gray-200 text-[10px] space-y-1 font-mono text-gray-700">
                    <div className="font-bold text-gray-900 font-sans">
                      EVIDENCE JOURNAL SUMMARY ({activePiece.evidence.length} Record(s)):
                    </div>
                    {activePiece.evidence.map((ev, idx) => (
                      <div key={ev.id} className="truncate">
                        {idx + 1}. [{ev.type.toUpperCase()}] {ev.title} (Observed: {ev.observedDate}, Source: {ev.source})
                      </div>
                    ))}
                  </div>
                )}

                {/* Truthful Footer Disclaimer */}
                <div className="mt-3 text-[9px] text-gray-400 leading-tight">
                  Notice: Prepared with Certified Mailer client-side journal. Not affiliated with the USPS. Official PS Form 3800 / 3811 and postage must be purchased from USPS.
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full max-w-2xl bg-white p-12 text-center text-gray-500 italic border border-gray-300">
              Select or create a mail piece to view preview.
            </div>
          )}
        </div>
      </div>

      {/* Footer Status Bar */}
      <footer className="bg-[#d4d0c8] border-t-2 border-white px-3 py-1 text-[11px] flex items-center justify-between text-gray-700 select-none shrink-0 font-sans">
        <div className="flex items-center gap-3">
          <span>Ready</span>
          <span className="text-gray-400">|</span>
          <span>Storage: Browser LocalStorage</span>
          <span className="text-gray-400">|</span>
          <span>Total Pieces: {store.pieces.length}</span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-gray-500">
          <span>Offline / Local-First</span>
        </div>
      </footer>

      {/* ------------------------------------------------------------------ */}
      {/* MODAL 1: STARTER TEMPLATES PICKER */}
      {/* ------------------------------------------------------------------ */}
      {modalMode?.type === 'template_picker' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="template-dialog-title"
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-xl bg-[#ece9d8] border-2 border-t-white border-l-white border-b-black border-r-black shadow-2xl flex flex-col max-h-[90vh]">
            <div className="titlebar-w95 px-2 py-1 flex justify-between items-center bg-[#000080] text-white font-bold text-xs">
              <span id="template-dialog-title" className="flex items-center gap-1.5">
                <Sparkles size={13} className="text-amber-300" />
                Sample Starter Templates (Starting Points - Not Legal Advice)
              </span>
              <button
                onClick={() => setModalMode(null)}
                className="bg-gray-300 hover:bg-gray-400 text-black px-1.5 py-0.5 text-xs font-bold border border-t-white border-l-white border-b-black border-r-black"
                aria-label="Close template modal"
              >
                ✕
              </button>
            </div>

            <div className="p-3 overflow-y-auto space-y-2">
              <p className="text-xs text-gray-700">
                Choose a starter template below. Templates provide sample structural language. Senders start blank, and all bracketed items should be replaced with your truthful facts.
              </p>

              <div className="space-y-2 pt-1">
                {STARTER_TEMPLATES.map(t => (
                  <div
                    key={t.id}
                    className="p-2.5 bg-white border border-gray-400 space-y-1 hover:border-blue-700 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-xs text-blue-950">{t.name}</div>
                      <span className="text-[10px] font-mono bg-blue-50 text-blue-900 border border-blue-200 px-1.5 py-0.2 rounded">
                        {t.category}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono">
                      Statutory Basis: {t.statutoryReference}
                    </div>
                    <p className="text-[11px] text-gray-600 italic">{t.instructions}</p>
                    <div className="pt-1 flex justify-end">
                      <button
                        onClick={() => handleCreateNewPiece(t)}
                        className="btn-w95 btn-w95-primary text-xs py-1 px-3 font-bold"
                      >
                        Use This Template
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-2 bg-gray-200 border-t border-gray-300 flex justify-end">
              <button onClick={() => setModalMode(null)} className="btn-w95 py-1 px-3 text-xs">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* MODAL 2: LIFECYCLE TRANSITION CONFIRMATION & EVIDENCE INPUT */}
      {/* ------------------------------------------------------------------ */}
      {modalMode?.type === 'transition' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="transition-dialog-title"
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg bg-[#ece9d8] border-2 border-t-white border-l-white border-b-black border-r-black shadow-2xl flex flex-col max-h-[90vh]">
            <div className="titlebar-w95 px-2 py-1 flex justify-between items-center bg-[#000080] text-white font-bold text-xs">
              <span id="transition-dialog-title">
                Confirm Lifecycle Transition: {modalMode.targetStatus.toUpperCase()}
              </span>
              <button
                onClick={() => setModalMode(null)}
                className="bg-gray-300 text-black px-1.5 py-0.5 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3">
              <div className="bg-amber-50 border border-amber-300 p-2 text-xs text-amber-950 space-y-1">
                <strong>Guarded Lifecycle Transition:</strong>
                <p>
                  Advancing to <strong>{modalMode.targetStatus.toUpperCase()}</strong> requires your explicit confirmation and user-entered evidence details.
                </p>
              </div>

              {/* Explicit Confirmation Checkbox */}
              <div className="p-2 bg-white border border-gray-400 flex items-start gap-2">
                <input
                  id="confirm-check"
                  type="checkbox"
                  checked={transitionUserConfirmed}
                  onChange={e => setTransitionUserConfirmed(e.target.checked)}
                  className="mt-0.5"
                />
                <label htmlFor="confirm-check" className="text-xs text-gray-800 font-bold cursor-pointer">
                  {modalMode.targetStatus === 'mailed'
                    ? 'I confirm that this physical mail piece was deposited at a USPS postal counter / facility.'
                    : modalMode.targetStatus === 'delivered'
                    ? 'I confirm that I observed delivery confirmation (e.g. signed return receipt or tracking event).'
                    : modalMode.targetStatus === 'returned'
                    ? 'I confirm that this mail piece was returned to sender.'
                    : 'I confirm that I wish to close / archive this mail piece record.'}
                </label>
              </div>

              {/* Required User-Entered Evidence Record */}
              {(modalMode.targetStatus === 'mailed' ||
                modalMode.targetStatus === 'delivered' ||
                modalMode.targetStatus === 'returned') && (
                <div className="p-3 bg-white border border-gray-400 space-y-2">
                  <div className="font-bold text-xs text-blue-950 border-b pb-1">
                    Enter Evidence Details:
                  </div>

                  <div>
                    <label htmlFor="evidence-title" className="block text-gray-700 font-bold text-[10px]">
                      Evidence Record Title *
                    </label>
                    <input
                      id="evidence-title"
                      type="text"
                      value={evidenceTitle}
                      onChange={e => setEvidenceTitle(e.target.value)}
                      placeholder="e.g. PS Form 3800 Acceptance Receipt"
                      className="w-full bg-white border border-gray-400 p-1 text-xs outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="evidence-source" className="block text-gray-700 font-bold text-[10px]">
                        Source *
                      </label>
                      <input
                        id="evidence-source"
                        type="text"
                        value={evidenceSource}
                        onChange={e => setEvidenceSource(e.target.value)}
                        placeholder="e.g. Downtown Post Office Counter"
                        className="w-full bg-white border border-gray-400 p-1 text-xs outline-none"
                      />
                    </div>

                    <div>
                      <label htmlFor="evidence-date" className="block text-gray-700 font-bold text-[10px]">
                        Observed Date *
                      </label>
                      <input
                        id="evidence-date"
                        type="date"
                        value={evidenceObservedDate}
                        onChange={e => setEvidenceObservedDate(e.target.value)}
                        className="w-full bg-white border border-gray-400 p-1 text-xs outline-none font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="evidence-ref" className="block text-gray-700 font-bold text-[10px]">
                      Reference / Article # (Optional)
                    </label>
                    <input
                      id="evidence-ref"
                      type="text"
                      value={evidenceReference}
                      onChange={e => setEvidenceReference(e.target.value)}
                      placeholder="e.g. 9407111899562210440122 or postmark city"
                      className="w-full bg-white border border-gray-400 p-1 text-xs outline-none font-mono"
                    />
                  </div>

                  <div>
                    <label htmlFor="evidence-notes" className="block text-gray-700 font-bold text-[10px]">
                      Notes &amp; Observations (Optional)
                    </label>
                    <textarea
                      id="evidence-notes"
                      rows={2}
                      value={evidenceNotes}
                      onChange={e => setEvidenceNotes(e.target.value)}
                      placeholder="e.g. Stamped by postal clerk, counter receipt retained in physical file."
                      className="w-full bg-white border border-gray-400 p-1 text-xs outline-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="trans-notes" className="block text-gray-700 font-bold text-[10px]">
                  Transition Audit Note (Optional)
                </label>
                <input
                  id="trans-notes"
                  type="text"
                  value={transitionNotes}
                  onChange={e => setTransitionNotes(e.target.value)}
                  placeholder="e.g. Mailed from Downtown Post Office branch"
                  className="w-full bg-white border border-gray-400 p-1 text-xs outline-none"
                />
              </div>
            </div>

            <div className="p-2 bg-gray-200 border-t border-gray-300 flex justify-end gap-2">
              <button onClick={() => setModalMode(null)} className="btn-w95 py-1 px-3 text-xs">
                Cancel
              </button>
              <button
                onClick={() => handleExecuteTransition(modalMode.targetStatus)}
                disabled={!transitionUserConfirmed}
                className="btn-w95 btn-w95-primary py-1 px-3 text-xs font-bold disabled:opacity-50"
              >
                Confirm &amp; Transition
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* MODAL 3: AD-HOC EVIDENCE RECORD */}
      {/* ------------------------------------------------------------------ */}
      {modalMode?.type === 'add_evidence' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="evidence-dialog-title"
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg bg-[#ece9d8] border-2 border-t-white border-l-white border-b-black border-r-black shadow-2xl flex flex-col max-h-[90vh]">
            <div className="titlebar-w95 px-2 py-1 flex justify-between items-center bg-[#000080] text-white font-bold text-xs">
              <span id="evidence-dialog-title">Log Evidence Record in Journal</span>
              <button
                onClick={() => setModalMode(null)}
                className="bg-gray-300 text-black px-1.5 py-0.5 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3">
              <div>
                <label htmlFor="adhoc-ev-type" className="block text-gray-700 font-bold text-[11px]">
                  Evidence Type *
                </label>
                <select
                  id="adhoc-ev-type"
                  value={evidenceType}
                  onChange={e => setEvidenceType(e.target.value as EvidenceType)}
                  className="w-full bg-white border border-gray-400 p-1 text-xs outline-none"
                >
                  <option value="acceptance_receipt">Acceptance Receipt (PS Form 3800 Counter Stamp)</option>
                  <option value="tracking_event">Tracking Event (User-Observed Online Update)</option>
                  <option value="delivery_receipt">Delivery Receipt (Signed PS 3811 Green Card)</option>
                  <option value="return_notice">Return-to-Sender Notice</option>
                  <option value="other">Other Supporting Record</option>
                </select>
              </div>

              <div>
                <label htmlFor="adhoc-ev-title" className="block text-gray-700 font-bold text-[11px]">
                  Record Title *
                </label>
                <input
                  id="adhoc-ev-title"
                  type="text"
                  value={evidenceTitle}
                  onChange={e => setEvidenceTitle(e.target.value)}
                  placeholder="e.g. Signed Return Card PS Form 3811"
                  className="w-full bg-white border border-gray-400 p-1 text-xs outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="adhoc-ev-source" className="block text-gray-700 font-bold text-[11px]">
                    Evidence Source *
                  </label>
                  <input
                    id="adhoc-ev-source"
                    type="text"
                    value={evidenceSource}
                    onChange={e => setEvidenceSource(e.target.value)}
                    placeholder="e.g. USPS Retail Counter or USPS.com"
                    className="w-full bg-white border border-gray-400 p-1 text-xs outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="adhoc-ev-date" className="block text-gray-700 font-bold text-[11px]">
                    Observed Date *
                  </label>
                  <input
                    id="adhoc-ev-date"
                    type="date"
                    value={evidenceObservedDate}
                    onChange={e => setEvidenceObservedDate(e.target.value)}
                    className="w-full bg-white border border-gray-400 p-1 text-xs outline-none font-mono"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="adhoc-ev-ref" className="block text-gray-700 font-bold text-[11px]">
                  Reference # (Optional)
                </label>
                <input
                  id="adhoc-ev-ref"
                  type="text"
                  value={evidenceReference}
                  onChange={e => setEvidenceReference(e.target.value)}
                  placeholder="e.g. 9407 1118 9956 2210 4401 22"
                  className="w-full bg-white border border-gray-400 p-1 text-xs outline-none font-mono"
                />
              </div>

              <div>
                <label htmlFor="adhoc-ev-notes" className="block text-gray-700 font-bold text-[11px]">
                  Observation Notes (Optional)
                </label>
                <textarea
                  id="adhoc-ev-notes"
                  rows={3}
                  value={evidenceNotes}
                  onChange={e => setEvidenceNotes(e.target.value)}
                  placeholder="Enter specific observations, signatory names, or location details..."
                  className="w-full bg-white border border-gray-400 p-1 text-xs outline-none"
                />
              </div>

              <p className="text-[10px] text-gray-500 italic">
                Note: Evidence records are self-entered by you and stored in local browser storage.
              </p>
            </div>

            <div className="p-2 bg-gray-200 border-t border-gray-300 flex justify-end gap-2">
              <button onClick={() => setModalMode(null)} className="btn-w95 py-1 px-3 text-xs">
                Cancel
              </button>
              <button
                onClick={handleAddEvidenceOnly}
                className="btn-w95 btn-w95-primary py-1 px-3 text-xs font-bold"
              >
                Save Evidence Record
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* MODAL 4: JSON IMPORT */}
      {/* ------------------------------------------------------------------ */}
      {modalMode?.type === 'import_json' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-dialog-title"
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg bg-[#ece9d8] border-2 border-t-white border-l-white border-b-black border-r-black shadow-2xl flex flex-col max-h-[90vh]">
            <div className="titlebar-w95 px-2 py-1 flex justify-between items-center bg-[#000080] text-white font-bold text-xs">
              <span id="import-dialog-title">Import Certified Mailer JSON Backup</span>
              <button
                onClick={() => setModalMode(null)}
                className="bg-gray-300 text-black px-1.5 py-0.5 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3">
              <div>
                <label className="block text-gray-700 font-bold text-xs mb-1">
                  Upload Backup JSON File:
                </label>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileUpload}
                  className="w-full text-xs"
                />
              </div>

              <div>
                <label htmlFor="import-json-area" className="block text-gray-700 font-bold text-xs mb-1">
                  Or Paste JSON Text:
                </label>
                <textarea
                  id="import-json-area"
                  rows={6}
                  value={importJsonText}
                  onChange={e => setImportJsonText(e.target.value)}
                  placeholder='{"version": 1, "pieces": [...]}'
                  className="w-full bg-white border border-gray-400 p-1 text-xs font-mono"
                />
              </div>

              {importError && (
                <div role="alert" className="p-2 bg-rose-100 border border-rose-300 text-rose-950 text-xs">
                  {importError}
                </div>
              )}
            </div>

            <div className="p-2 bg-gray-200 border-t border-gray-300 flex justify-end gap-2">
              <button onClick={() => setModalMode(null)} className="btn-w95 py-1 px-3 text-xs">
                Cancel
              </button>
              <button
                onClick={handleImportJson}
                disabled={!importJsonText.trim()}
                className="btn-w95 btn-w95-primary py-1 px-3 text-xs font-bold disabled:opacity-50"
              >
                Validate &amp; Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* MODAL 5: DELETE CONFIRM */}
      {/* ------------------------------------------------------------------ */}
      {modalMode?.type === 'delete_confirm' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-[#ece9d8] border-2 border-t-white border-l-white border-b-black border-r-black shadow-2xl flex flex-col">
            <div className="titlebar-w95 px-2 py-1 flex justify-between items-center bg-[#800000] text-white font-bold text-xs">
              <span id="delete-dialog-title">Confirm Deletion</span>
              <button
                onClick={() => setModalMode(null)}
                className="bg-gray-300 text-black px-1.5 py-0.5 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-2">
              <p className="text-xs text-gray-800 font-bold">
                Are you sure you want to delete this mail piece?
              </p>
              <p className="text-xs text-gray-600">
                This will permanently delete this mail piece and all of its attached evidence records from this browser. This action cannot be undone.
              </p>
            </div>

            <div className="p-2 bg-gray-200 border-t border-gray-300 flex justify-end gap-2">
              <button onClick={() => setModalMode(null)} className="btn-w95 py-1 px-3 text-xs">
                Cancel
              </button>
              <button
                onClick={() => handleDeletePiece(modalMode.pieceId)}
                className="btn-w95 btn-w95-danger py-1 px-3 text-xs font-bold"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* MODAL 6: CLEAR ALL LOCAL STORAGE CONFIRM */}
      {/* ------------------------------------------------------------------ */}
      {modalMode?.type === 'clear_storage_confirm' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-dialog-title"
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-[#ece9d8] border-2 border-t-white border-l-white border-b-black border-r-black shadow-2xl flex flex-col">
            <div className="titlebar-w95 px-2 py-1 flex justify-between items-center bg-[#800000] text-white font-bold text-xs">
              <span id="clear-dialog-title">Clear All Local Storage Records</span>
              <button
                onClick={() => setModalMode(null)}
                className="bg-gray-300 text-black px-1.5 py-0.5 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-2">
              <p className="text-xs text-gray-800 font-bold">
                Are you sure you want to clear ALL Certified Mailer records?
              </p>
              <p className="text-xs text-gray-600">
                All mail pieces, evidence records, and logs stored by this site in this browser profile will be permanently erased.
              </p>
            </div>

            <div className="p-2 bg-gray-200 border-t border-gray-300 flex justify-end gap-2">
              <button onClick={() => setModalMode(null)} className="btn-w95 py-1 px-3 text-xs">
                Cancel
              </button>
              <button
                onClick={handleClearLocalStorage}
                className="btn-w95 btn-w95-danger py-1 px-3 text-xs font-bold"
              >
                Yes, Clear All Records
              </button>
            </div>
          </div>
        </div>
      )}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #printable-certified-letter,
          #printable-certified-letter * { visibility: visible !important; }
          #printable-certified-letter {
            position: absolute !important;
            inset: 0 auto auto 0 !important;
            width: 100% !important;
            max-width: none !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            box-shadow: none !important;
          }
        }
      `}</style>
    </div>
  );
};
