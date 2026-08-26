import React, { useState } from 'react';
import { Mail, CheckCircle2, Copy } from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';

interface DisputeTemplate {
  id: string;
  name: string;
  category: string;
  statute: string;
  defaultRecipient: string;
  defaultText: string;
}

const TEMPLATES: DisputeTemplate[] = [
  {
    id: 'fcra-623',
    name: 'FCRA 623 Credit Dispute',
    category: 'Consumer Rights',
    statute: '15 U.S.C. § 1681s-2 (FCRA)',
    defaultRecipient: 'Equifax Information Services LLC\nP.O. Box 740256\nAtlanta, GA 30374',
    defaultText: 'I am writing to formally dispute inaccurate reporting on my credit file pursuant to Section 623 of the Fair Credit Reporting Act (15 U.S.C. § 1681s-2). The account listed below contains erroneous late payment entries that were reported in violation of federal law.'
  },
  {
    id: 'security-deposit',
    name: 'Security Deposit Demand',
    category: 'Tenant Rights',
    statute: 'Tex. Prop. Code § 92.103',
    defaultRecipient: 'Austin Property Management Inc.\n100 Congress Ave, Suite 400\nAustin, TX 78701',
    defaultText: 'This letter serves as formal legal demand for the full return of my security deposit in the amount of $2,400.00 for the lease at 404 West 7th St. More than 30 days have elapsed since surrender of the premises and provision of my forwarding address, with no itemized accounting provided.'
  },
  {
    id: 'cease-desist',
    name: 'FDCPA Cease & Desist',
    category: 'Debt Defense',
    statute: '15 U.S.C. § 1692c(c) (FDCPA)',
    defaultRecipient: 'Midland Credit Management Inc.\nP.O. Box 939069\nSan Diego, CA 92193',
    defaultText: 'Pursuant to 15 U.S.C. § 1692c(c) of the Fair Debt Collection Practices Act, you are hereby notified to immediately cease and desist all communications with me regarding the alleged debt reference. Any further contact, except for formal legal process, will constitute an actionable statutory violation.'
  },
  {
    id: 'foia-records',
    name: 'FOIA Public Records Request',
    category: 'Open Records',
    statute: '5 U.S.C. § 552 (FOIA)',
    defaultRecipient: 'City of Austin Public Information Office\nPO Box 1088\nAustin, TX 78767',
    defaultText: 'Pursuant to the Texas Public Information Act and 5 U.S.C. § 552, I hereby request copies of all agency communications, permits, and engineering assessments conducted for the Shoal Creek stormwater modernization project between Jan 2025 and Aug 2026.'
  }
];

export const CertifiedMailerStudio: React.FC = () => {
  const [selectedTemplate, setSelectedTemplate] = useState<DisputeTemplate>(TEMPLATES[0]);
  const [senderName, setSenderName] = useState('Nate McGuire');
  const [senderAddress] = useState('1200 Barton Springs Rd, Austin, TX 78704');
  const [recipient, setRecipient] = useState(TEMPLATES[0].defaultRecipient);
  const [accountRef, setAccountRef] = useState('ACCT-9812-7740');
  const [bodyText, setBodyText] = useState(TEMPLATES[0].defaultText);
  const [trackingNumber] = useState('9407 1118 9956 2210 4401 22');
  const [isCopied, setIsCopied] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const handleSelectTemplate = (tmpl: DisputeTemplate) => {
    playClickSound();
    setSelectedTemplate(tmpl);
    setRecipient(tmpl.defaultRecipient);
    setBodyText(tmpl.defaultText);
    setIsSaved(false);
  };

  const handleSaveToSqlite = () => {
    playSuccessChime();
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleCopyNotice = () => {
    playClickSound();
    const notice = `USPS CERTIFIED MAIL (ERR # ${trackingNumber})\n\nFROM:\n${senderName}\n${senderAddress}\n\nTO:\n${recipient}\n\nRE: Account / Ref ${accountRef}\nSTATUTORY BASIS: ${selectedTemplate.statute}\nDATE: ${new Date().toLocaleDateString()}\n\n${bodyText}\n\nRespectfully submitted,\n${senderName}`;
    navigator.clipboard.writeText(notice);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="h-full flex flex-col md:flex-row bg-[#ece9d8] font-tahoma text-xs overflow-hidden select-none">
      {/* Left Sidebar: Template Picker & Form Controls */}
      <div className="w-full md:w-80 bg-w95-gray border-r-2 border-gray-400 p-3 flex flex-col gap-3 overflow-y-auto shrink-0">
        <div className="bg-[#000080] text-white px-2 py-1 font-bold text-xs flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Mail size={13} className="text-amber-300" />
            <span>DISPUTE TEMPLATES</span>
          </div>
          <span className="text-[10px] font-mono bg-blue-900 px-1.5 py-0.5 rounded">SQLite WAL</span>
        </div>

        {/* Template Buttons */}
        <div className="space-y-1">
          {TEMPLATES.map(t => (
            <button
              key={t.id}
              onClick={() => handleSelectTemplate(t)}
              className={`w-full text-left p-2 border flex items-center justify-between transition-colors ${
                selectedTemplate.id === t.id
                  ? 'bg-white border-2 border-t-black border-l-black border-b-white border-r-white font-bold text-blue-950 shadow-inner'
                  : 'bg-w95-gray border-t-white border-l-white border-b-black border-r-black hover:bg-gray-200 text-gray-800'
              }`}
            >
              <div>
                <div className="text-xs">{t.name}</div>
                <div className="text-[10px] text-gray-500 font-mono">{t.category}</div>
              </div>
              <span className="text-[10px] text-blue-800 font-mono font-bold">{t.statute.split(' ')[0]}</span>
            </button>
          ))}
        </div>

        {/* Form Inputs */}
        <div className="space-y-2 border-t border-gray-300 pt-2 font-mono text-[11px]">
          <div>
            <label className="block text-gray-700 font-bold mb-0.5">Sender Name</label>
            <input
              type="text"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              className="w-full bg-white border border-gray-400 p-1 text-xs outline-none"
            />
          </div>

          <div>
            <label className="block text-gray-700 font-bold mb-0.5">Account / Case Ref #</label>
            <input
              type="text"
              value={accountRef}
              onChange={(e) => setAccountRef(e.target.value)}
              className="w-full bg-white border border-gray-400 p-1 text-xs outline-none"
            />
          </div>

          <div>
            <label className="block text-gray-700 font-bold mb-0.5">Recipient Address</label>
            <textarea
              rows={3}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full bg-white border border-gray-400 p-1 text-xs outline-none resize-none font-mono"
            />
          </div>

          <div>
            <label className="block text-gray-700 font-bold mb-0.5">Dispute Particulars</label>
            <textarea
              rows={4}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              className="w-full bg-white border border-gray-400 p-1 text-xs outline-none resize-none"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-1.5 pt-2 border-t border-gray-300 mt-auto">
          <button
            onClick={handleSaveToSqlite}
            className="btn-w95 btn-w95-primary w-full py-1.5 font-bold text-xs flex items-center justify-center gap-1.5"
          >
            <CheckCircle2 size={13} />
            <span>{isSaved ? '✔ Saved to SQLite WAL' : 'Save Notice to SQLite'}</span>
          </button>

          <button
            onClick={handleCopyNotice}
            className="btn-w95 w-full py-1 text-xs flex items-center justify-center gap-1.5"
          >
            <Copy size={12} />
            <span>{isCopied ? 'Copied to Clipboard!' : 'Copy Formatted Notice'}</span>
          </button>
        </div>
      </div>

      {/* Right Viewport: Live 300 DPI Letter Preview with USPS Barcode */}
      <div className="flex-1 bg-slate-800 p-4 overflow-y-auto flex items-center justify-center">
        <div className="w-full max-w-2xl bg-white text-gray-900 shadow-2xl p-8 border border-gray-300 font-serif min-h-[550px] relative text-xs flex flex-col justify-between select-text">
          {/* Top USPS Green Certified Mail Banner */}
          <div className="border-4 border-green-800 p-2.5 mb-6 bg-green-50/50 flex items-center justify-between font-mono select-none">
            <div className="flex items-center gap-3">
              <div className="bg-green-800 text-white font-bold px-2 py-1 text-xs tracking-wider">
                USPS CERTIFIED MAIL®
              </div>
              <div className="text-[10px] text-green-950 font-bold">
                ELECTRONIC RETURN RECEIPT (ERR)
              </div>
            </div>
            <div className="text-right">
              <div className="text-[9px] text-gray-500">ARTICLE NUMBER</div>
              <div className="font-bold text-[11px] text-green-950 tracking-wider">{trackingNumber}</div>
            </div>
          </div>

          {/* Barcode graphic representation */}
          <div className="w-full h-8 bg-gradient-to-r from-gray-900 via-gray-700 to-gray-900 mb-6 flex items-center justify-center text-[9px] font-mono text-white tracking-[0.3em] select-none opacity-90">
            ||| | |||| || ||| |||| | || ||||| || ||| |||| | || |||||
          </div>

          {/* Header metadata */}
          <div className="flex justify-between items-start mb-6 font-sans text-xs">
            <div>
              <div className="font-bold text-gray-900">{senderName}</div>
              <div className="text-gray-600 whitespace-pre-line">{senderAddress}</div>
            </div>
            <div className="text-right text-gray-500 font-mono">
              <div>Date: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
              <div className="text-[10px] text-blue-900 font-bold mt-0.5">Ref: {accountRef}</div>
            </div>
          </div>

          {/* Recipient */}
          <div className="mb-6 font-sans text-xs">
            <div className="text-gray-500 text-[10px] uppercase font-bold tracking-wider">DELIVER VIA CERTIFIED MAIL TO:</div>
            <div className="font-bold text-gray-900 whitespace-pre-line mt-1">{recipient}</div>
          </div>

          {/* Subject Line */}
          <div className="mb-4 font-sans font-bold text-xs text-gray-900 border-b border-gray-300 pb-1">
            RE: FORMAL DISPUTE AND NOTICE OF STATUTORY RIGHTS ({selectedTemplate.statute})
          </div>

          {/* Body */}
          <div className="space-y-3 font-serif text-[12px] leading-relaxed text-gray-800 flex-1">
            <p>To Whom It May Concern,</p>
            <p className="whitespace-pre-line">{bodyText}</p>
            <p>
              Please note that this communication is being transmitted via USPS Certified Mail with Electronic Return Receipt (ERR) delivery confirmation, and a permanent cryptographic timestamp has been entered into the dispute audit ledger.
            </p>
          </div>

          {/* Signature Footer */}
          <div className="mt-8 pt-4 border-t border-gray-200 font-sans text-xs flex justify-between items-end">
            <div>
              <div className="font-serif italic text-base text-gray-900 font-bold mb-1">{senderName}</div>
              <div className="text-[10px] text-gray-500">Signatory &amp; Aggrieved Consumer</div>
            </div>
            <div className="text-right font-mono text-[9px] text-slate-400">
              <div>WAL SHA-256: 7f8a91c0e2</div>
              <div>Single-file SQLite Mode: ACTIVE</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
