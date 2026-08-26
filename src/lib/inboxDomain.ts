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
    from: 'Sam (@sam)',
    fromAvatar: '🤖',
    subject: 'PR #14: Added High-Score SQLite Telemetry to DroneHunter',
    time: '12 mins ago',
    body: 'Hey Nate, I completed the high score telemetry feature on refs/features/dronehunter-scores/v1.0.0. Added SQLite WAL tables and sound synthesizer. All 4 automated test assertions passed in 0.04s.',
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
    subject: 'Royalty Settled: +$340.00 from DroneHunter & Certified Mailer Forks',
    time: '2 hours ago',
    body: 'Daily 12:01 AM batch royalty settlement complete. Downstream forks active on GITSMITH. $340.00 transferred directly to your connected Stripe account.',
    unread: false,
    featureRef: 'n/a',
    isMerged: true
  },
  {
    id: 'msg-03',
    category: 'agent_logs',
    from: 'Sam (@sam)',
    fromAvatar: '🤖',
    subject: 'Refactor Report: 300 DPI Rasterization for Certified Mailer',
    time: '5 hours ago',
    body: 'Autonomous task completed for nate/certified-mailer. Optimized PDF rasterizer to prevent printer layout substitutions. SQLite WAL checkpointed cleanly.',
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
    subject: 'PR #09: Duck Hunt Sprite & Shotgun Audio Reload for DroneHunter',
    time: 'Yesterday',
    body: 'Added double-barrel shotgun reload and duck hunt sprite canvas renderer. Zero database locks on dronehunter.sqlite.',
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
