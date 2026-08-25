// Production Domain Logic for INBOX 3-Pane Client

export interface InboxThread {
  readonly id: string;
  readonly category: 'proposals' | 'agent_logs' | 'royalties' | 'feedback';
  readonly from: string;
  readonly fromAvatar: string;
  readonly subject: string;
  readonly time: string;
  readonly body: string;
  readonly unread: boolean;
  readonly featureRef: string;
  readonly casOldSha?: string;
  readonly casNewSha?: string;
  readonly testsPassed?: number;
  readonly isMerged?: boolean;
}

export const INITIAL_THREADS: readonly [InboxThread, ...InboxThread[]] = [
  {
    id: 'msg-01',
    category: 'proposals',
    from: 'Sam Altman (@sam)',
    fromAvatar: '👨‍💻',
    subject: 'PR #14: Spliced OCR Receipt Scanner into RetroCalc',
    time: '12 mins ago',
    body: 'Hey Nate, I completed the optical character recognition feature on refs/features/receipt-ocr/v1.2.0. Parsed 22 AST nodes and applied 004_receipts.sql. All 4 automated test assertions passed in 0.04s.',
    unread: true,
    featureRef: 'refs/features/receipt-ocr/v1.2.0',
    casOldSha: '5c030af',
    casNewSha: '4e10bc9',
    testsPassed: 4,
    isMerged: false
  },
  {
    id: 'msg-02',
    category: 'royalties',
    from: 'Lineage Protocol (@gitsmith)',
    fromAvatar: '💎',
    subject: 'Royalty Settled: +$920.00 from WallArt Canvas Pro Forks',
    time: '2 hours ago',
    body: 'Daily 12:01 AM batch royalty settlement complete. 112 downstream forks active across 48 registered users. $920.00 transferred directly to your connected Stripe account.',
    unread: false,
    featureRef: 'n/a',
    isMerged: true
  },
  {
    id: 'msg-03',
    category: 'agent_logs',
    from: 'Claude 3.7 Agent (@mechanic)',
    fromAvatar: '🤖',
    subject: 'Refactor Report: 300 DPI TIFF Export Pipeline Optimized',
    time: '5 hours ago',
    body: 'Autonomous task completed for nate/wallart. Reduced memory footprint from 68MB to 48MB during multi-panel triptych rendering. SQLite WAL checkpointed cleanly.',
    unread: false,
    featureRef: 'refs/features/wallart-triptych/v2.4.0',
    casOldSha: '1109a2b',
    casNewSha: '8f4a21e',
    testsPassed: 6,
    isMerged: true
  },
  {
    id: 'msg-04',
    category: 'proposals',
    from: 'Josh McGuire (@josh)',
    fromAvatar: '⛵',
    subject: 'PR #09: NMEA Polar Chart Telemetry Lock for SailTrack',
    time: 'Yesterday',
    body: 'Added live polar performance curves against true wind angle. Zero database locks on telemetry.sqlite.',
    unread: false,
    featureRef: 'refs/features/nmea-polar/v2.1.0',
    casOldSha: '9812f0a',
    casNewSha: '3341b8c',
    testsPassed: 8,
    isMerged: false
  }
];

export function filterThreadsByCategory(threads: readonly InboxThread[], category: string): readonly InboxThread[] {
  if (category === 'all') return threads;
  return threads.filter(t => t.category === category);
}
