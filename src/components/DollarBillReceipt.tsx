import React from 'react';
import { formatCentsToUsd } from '../lib/profileDomain';
import type { AllocationCalculationResult } from '../lib/commerceDomain';

export interface DollarBillReceiptProps {
  grossCents: number;
  result: AllocationCalculationResult;
  makerLabel?: string;
  resolveUpstreamLabel?: (recipientUserId: string | null) => string;
  title?: string;
  note?: string;
  compact?: boolean;
}

const pct = (bps: number | null | undefined) =>
  typeof bps === 'number' ? `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%` : null;

export const DollarBillReceipt: React.FC<DollarBillReceiptProps> = ({
  grossCents,
  result,
  makerLabel = 'You',
  resolveUpstreamLabel,
  title = 'How this sale splits',
  note,
  compact = false
}) => {
  const ancestors = result.allocations.filter(a => a.role === 'ancestor');
  const platformBps = grossCents > 0 ? Math.round((result.platformCents / grossCents) * 10000) : null;
  const row = 'flex justify-between gap-3 items-baseline';
  const pad = compact ? 'p-2' : 'p-2.5';

  return (
    <div className="bg-white border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] font-mono text-black">
      <div className="bg-[#000080] text-white font-bold text-xs px-2.5 py-1 flex items-center justify-between">
        <span>{title}</span>
        <span className="opacity-80 font-normal">RECEIPT</span>
      </div>
      <div className={`${pad} space-y-1 text-xs`}>
        <div className={`${row} border-b border-dashed border-gray-400 pb-1 font-bold`}>
          <span>Sale price</span>
          <span className="tabular-nums">{formatCentsToUsd(grossCents)}</span>
        </div>

        <div className={`${row} text-gray-700`}>
          <span>&minus; Platform{platformBps !== null ? ` (${pct(platformBps)})` : ''}</span>
          <span className="tabular-nums">&minus;{formatCentsToUsd(result.platformCents)}</span>
        </div>

        {ancestors.map(a => (
          <div key={a.sequence} className={`${row} text-gray-700`}>
            <span>
              &minus; {resolveUpstreamLabel ? resolveUpstreamLabel(a.recipientUserId) : `Upstream maker`}
              {pct(a.basisPoints) ? ` (${pct(a.basisPoints)})` : ''}
            </span>
            <span className="tabular-nums">&minus;{formatCentsToUsd(a.amountCents)}</span>
          </div>
        ))}

        <div className={`${row} border-t-2 border-black pt-1 font-bold text-green-800 text-sm`}>
          <span>{makerLabel} keep</span>
          <span className="tabular-nums">{formatCentsToUsd(result.sellerCents)}</span>
        </div>
      </div>
      {note && (
        <div className="px-2.5 pb-2 text-[11px] text-gray-600 leading-snug">{note}</div>
      )}
    </div>
  );
};
