// HOTWIRE & Daily Drops Engine - Production Backend Logic
// Shareware Marketplace & Daily 12:01 AM UTC Release Protocol

export type MakerBadgeTier = 'Rookie' | 'Iron Maker' | 'Hot Streak' | 'Legend';

export interface MakerBadgeInfo {
  tier: MakerBadgeTier;
  title: string;
  icon: string;
  minStreak: number;
  multiplier: number;
  feeWaiverPercent: number;
  perkDescription: string;
}

export const MAKER_BADGE_TIERS: Record<MakerBadgeTier, MakerBadgeInfo> = {
  'Rookie': {
    tier: 'Rookie',
    title: 'Rookie Maker',
    icon: '🌱',
    minStreak: 0,
    multiplier: 1.0,
    feeWaiverPercent: 0,
    perkDescription: 'Base distribution rank and the standard platform fee.'
  },
  'Iron Maker': {
    tier: 'Iron Maker',
    title: 'Iron Maker',
    icon: '🛠️',
    minStreak: 3,
    multiplier: 1.15,
    feeWaiverPercent: 25,
    perkDescription: '15% Hotwire rank boost, 25% protocol fee discount, and Iron badge.'
  },
  'Hot Streak': {
    tier: 'Hot Streak',
    title: 'Hot Streak Master',
    icon: '🔥',
    minStreak: 7,
    multiplier: 1.35,
    feeWaiverPercent: 50,
    perkDescription: '35% Hotwire rank boost, 50% protocol fee discount, and priority daily drop placement.'
  },
  'Legend': {
    tier: 'Legend',
    title: 'Local-First Legend',
    icon: '👑',
    minStreak: 14,
    multiplier: 1.6,
    feeWaiverPercent: 100,
    perkDescription: '60% Hotwire rank boost, 100% protocol fee waiver (keep 100% net), and front-page spotlight.'
  }
};

export interface BatchWindow {
  batchId: string;
  batchNumber: number;
  windowStart: Date;
  windowEnd: Date;
  isCurrent: boolean;
}

export interface DropCountdown {
  countdown: string;
  totalSeconds: number;
  totalMs: number;
  hours: number;
  minutes: number;
  seconds: number;
  percentElapsed: number;
  nextDropUtc: Date;
  prevDropUtc: Date;
}

export interface DropRankingInput {
  id: string;
  name: string;
  tagline?: string;
  description?: string;
  creator?: string;
  creatorAvatar?: string;
  upvotes: number;
  forks?: number;
  forkDepth?: number;
  version?: string;
  license?: string;
  price?: string;
  moddabilityScore?: number;
  mergeCleanliness?: string;
  storage?: string;
  tags?: string[];
  screenshots?: string[];
  binaries?: Record<string, string>;
  grantable_bps?: number;
  grantableBps?: number;
  createdAt: Date | string | number;
  creatorStreak?: number;
  velocity?: number; // Upvotes per hour or recent velocity
  isVerifiedMaker?: boolean;
  [key: string]: any;
}

export interface RankingOptions {
  gravity?: number;
  upvoteWeight?: number;
  forkWeight?: number;
  forkDepthWeight?: number;
  now?: Date | string | number;
}

export interface RankedDropResult extends DropRankingInput {
  hotwireScore: number;
  rankingMetrics: {
    baseScore: number;
    velocityMultiplier: number;
    streakMultiplier: number;
    lineageBonus: number;
    timeDecay: number;
    ageInHours: number;
    rank: number;
  };
}

export interface FeedOptions {
  title?: string;
  description?: string;
  homePageUrl?: string;
  feedUrl?: string;
  authorName?: string;
  authorEmail?: string;
  authorUrl?: string;
  language?: string;
}

export interface JsonFeedAuthor {
  name: string;
  url?: string;
  avatar?: string;
}

export interface JsonFeedItem {
  id: string;
  url: string;
  title: string;
  content_html: string;
  summary?: string;
  image?: string;
  date_published: string;
  date_modified?: string;
  authors?: JsonFeedAuthor[];
  tags?: string[];
  attachments?: Array<{
    url: string;
    mime_type: string;
    title?: string;
    size_in_bytes?: number;
  }>;
  _hotwire?: {
    upvotes: number;
    forks: number;
    version: string;
    license: string;
    price: string;
    storage: string;
    moddabilityScore?: number;
  };
}

export interface JsonFeedDocument {
  version: string;
  title: string;
  home_page_url: string;
  feed_url: string;
  description: string;
  language?: string;
  icon?: string;
  favicon?: string;
  authors?: JsonFeedAuthor[];
  items: JsonFeedItem[];
}

// -----------------------------------------------------------------------------
// 1. Daily 12:01 AM UTC Batch Rollover & Time-To-Next-Drop Logic
// -----------------------------------------------------------------------------

export const ROLLOVER_HOUR_UTC = 0; // 00:xx
export const ROLLOVER_MINUTE_UTC = 1; // 00:01
export const GENESIS_EPOCH_UTC = new Date('2026-01-01T00:01:00.000Z').getTime();

/**
 * Parses any valid Date input (Date, ISO string, timestamp) into a Date instance.
 */
export function normalizeDate(input?: Date | string | number | null): Date {
  if (!input) return new Date();
  if (input instanceof Date) return new Date(input.getTime());
  const parsed = new Date(input);
  if (isNaN(parsed.getTime())) return new Date();
  return parsed;
}

/**
 * Calculates the current active 12:01 AM UTC batch window for a given moment in time.
 * If 'now' is at 00:00:30 UTC, it belongs to the previous day's batch (ending at 00:01:00 UTC).
 * If 'now' is at 00:01:00 UTC or later, it belongs to the current day's batch.
 */
export function getCurrentBatchWindow(nowInput?: Date | string | number): BatchWindow {
  const now = normalizeDate(nowInput);

  // Determine current day 00:01:00.000 UTC
  const todayRollover = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    ROLLOVER_HOUR_UTC,
    ROLLOVER_MINUTE_UTC,
    0,
    0
  ));

  let windowStart: Date;
  let windowEnd: Date;

  if (now.getTime() < todayRollover.getTime()) {
    // Current time is before 00:01 UTC today, so active batch started yesterday at 00:01 UTC
    windowEnd = todayRollover;
    windowStart = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - 1,
      ROLLOVER_HOUR_UTC,
      ROLLOVER_MINUTE_UTC,
      0,
      0
    ));
  } else {
    // Current time is at or after 00:01 UTC today, so active batch started today at 00:01 UTC
    windowStart = todayRollover;
    windowEnd = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      ROLLOVER_HOUR_UTC,
      ROLLOVER_MINUTE_UTC,
      0,
      0
    ));
  }

  // Format batch ID: drop-YYYY-MM-DD
  const y = windowStart.getUTCFullYear();
  const m = String(windowStart.getUTCMonth() + 1).padStart(2, '0');
  const d = String(windowStart.getUTCDate()).padStart(2, '0');
  const batchId = `drop-${y}-${m}-${d}`;

  // Batch index continuous count from genesis epoch
  const dayMs = 24 * 60 * 60 * 1000;
  const batchNumber = Math.max(1, Math.floor((windowStart.getTime() - GENESIS_EPOCH_UTC) / dayMs) + 1);

  return {
    batchId,
    batchNumber,
    windowStart,
    windowEnd,
    isCurrent: now.getTime() >= windowStart.getTime() && now.getTime() < windowEnd.getTime()
  };
}

/**
 * Calculates accurate countdown and statistics to the next 12:01 AM UTC drop cutoff.
 */
export function getTimeToNextDrop(nowInput?: Date | string | number): DropCountdown {
  const now = normalizeDate(nowInput);
  const { windowStart, windowEnd } = getCurrentBatchWindow(now);

  const totalCycleMs = windowEnd.getTime() - windowStart.getTime();
  const elapsedMs = Math.max(0, now.getTime() - windowStart.getTime());
  const diffMs = Math.max(0, windowEnd.getTime() - now.getTime());

  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const countdown = `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  const percentElapsed = Number(Math.min(100, Math.max(0, (elapsedMs / totalCycleMs) * 100)).toFixed(2));

  return {
    countdown,
    totalSeconds,
    totalMs: diffMs,
    hours,
    minutes,
    seconds,
    percentElapsed,
    nextDropUtc: windowEnd,
    prevDropUtc: windowStart
  };
}

/**
 * Checks if a daily 12:01 AM UTC batch rollover occurred between two timestamps.
 */
export function isBatchRollover(
  previousCheckInput: Date | string | number,
  currentCheckInput: Date | string | number
): boolean {
  const prev = normalizeDate(previousCheckInput);
  const curr = normalizeDate(currentCheckInput);

  if (curr.getTime() <= prev.getTime()) return false;

  const prevBatch = getCurrentBatchWindow(prev);
  const currBatch = getCurrentBatchWindow(curr);

  return prevBatch.batchId !== currBatch.batchId || curr.getTime() >= prevBatch.windowEnd.getTime();
}

/**
 * Calculates continuous batch index number from genesis or custom baseline.
 */
export function getDropBatchNumber(dateInput?: Date | string | number, epochDate?: Date): number {
  const date = normalizeDate(dateInput);
  const { windowStart } = getCurrentBatchWindow(date);
  const epoch = epochDate ? epochDate.getTime() : GENESIS_EPOCH_UTC;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.floor((windowStart.getTime() - epoch) / dayMs) + 1);
}
/**
 * Calculates the previous day's (yesterday's) 12:01 AM UTC batch window.
 */
export function getYesterdayBatchWindow(nowInput?: Date | string | number): BatchWindow {
  const current = getCurrentBatchWindow(nowInput);
  const yesterdayDate = new Date(current.windowStart.getTime() - (12 * 60 * 60 * 1000));
  return getCurrentBatchWindow(yesterdayDate);
}

/**
 * Parses a batch ID (e.g. 'drop-2026-08-29') into a full BatchWindow.
 */
export function getBatchWindowById(batchId: string): BatchWindow | null {
  if (!batchId || !batchId.startsWith('drop-')) return null;
  const parts = batchId.replace(/^drop-/, '').split('-');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map(p => parseInt(p, 10));
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;

  const windowStart = new Date(Date.UTC(y, m - 1, d, ROLLOVER_HOUR_UTC, ROLLOVER_MINUTE_UTC, 0, 0));
  const windowEnd = new Date(Date.UTC(y, m - 1, d + 1, ROLLOVER_HOUR_UTC, ROLLOVER_MINUTE_UTC, 0, 0));
  const dayMs = 24 * 60 * 60 * 1000;
  const batchNumber = Math.max(1, Math.floor((windowStart.getTime() - GENESIS_EPOCH_UTC) / dayMs) + 1);

  const now = new Date();
  return {
    batchId,
    batchNumber,
    windowStart,
    windowEnd,
    isCurrent: now.getTime() >= windowStart.getTime() && now.getTime() < windowEnd.getTime()
  };
}

export interface BatchFilterResolution {
  type: 'all' | 'today' | 'yesterday' | 'archive' | 'custom';
  windowStart?: Date;
  windowEnd?: Date;
  batchId?: string;
  isArchive?: boolean;
}

/**
 * Resolves a batch query parameter into authoritative timestamp bounds.
 */
export function resolveBatchFilter(
  batchParam?: string | null,
  nowInput?: Date | string | number
): BatchFilterResolution {
  if (!batchParam || batchParam === 'all') {
    return { type: 'all' };
  }

  const now = normalizeDate(nowInput);
  const currentBatch = getCurrentBatchWindow(now);

  if (batchParam === 'today') {
    return {
      type: 'today',
      windowStart: currentBatch.windowStart,
      windowEnd: currentBatch.windowEnd,
      batchId: currentBatch.batchId
    };
  }

  if (batchParam === 'yesterday') {
    const yesterdayBatch = getYesterdayBatchWindow(now);
    return {
      type: 'yesterday',
      windowStart: yesterdayBatch.windowStart,
      windowEnd: yesterdayBatch.windowEnd,
      batchId: yesterdayBatch.batchId
    };
  }

  if (batchParam === 'archive') {
    return {
      type: 'archive',
      windowEnd: currentBatch.windowStart,
      isArchive: true
    };
  }

  const customBatch = getBatchWindowById(batchParam);
  if (customBatch) {
    return {
      type: 'custom',
      windowStart: customBatch.windowStart,
      windowEnd: customBatch.windowEnd,
      batchId: customBatch.batchId
    };
  }

  return { type: 'all' };
}

/**
 * In-memory batch filtering helper for drops arrays.
 */
export function filterDropsByBatch(
  drops: DropRankingInput[],
  batchParam?: string | null,
  nowInput?: Date | string | number
): DropRankingInput[] {
  if (!drops || drops.length === 0) return [];
  const filter = resolveBatchFilter(batchParam, nowInput);
  if (filter.type === 'all') return drops;

  return drops.filter(d => {
    const createdAt = normalizeDate(d.createdAt).getTime();
    if (filter.type === 'archive') {
      return createdAt < filter.windowEnd!.getTime();
    }
    if (filter.windowStart && filter.windowEnd) {
      return createdAt >= filter.windowStart.getTime() && createdAt < filter.windowEnd.getTime();
    }
    return true;
  });
}

export interface MakerLeaderboardEntry {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio?: string;
  currentStreak: number;
  longestStreak: number;
  totalDrops: number;
  activeTier: MakerBadgeTier;
  badgeInfo: MakerBadgeInfo;
  lastDropDate?: string | null;
}

/**
 * Computes deterministic maker streak leaderboard from maker drops history.
 */
export function buildMakerLeaderboard(
  makers: Array<{
    id: string;
    username: string;
    displayName: string;
    avatar?: string;
    bio?: string;
    dropDates: (Date | string | number)[];
  }>,
  nowInput?: Date | string | number
): MakerLeaderboardEntry[] {
  if (!makers || makers.length === 0) return [];

  const leaderboard: MakerLeaderboardEntry[] = makers.map(m => {
    const streakData = calculateMakerStreakFromHistory(m.dropDates || [], nowInput);
    return {
      id: m.id,
      username: m.username,
      displayName: m.displayName || m.username,
      avatar: m.avatar || '⚡',
      bio: m.bio || '',
      currentStreak: streakData.currentStreak,
      longestStreak: streakData.longestStreak,
      totalDrops: streakData.totalDrops,
      activeTier: streakData.activeTier,
      badgeInfo: streakData.badgeInfo,
      lastDropDate: streakData.lastDropDate ? streakData.lastDropDate.toISOString() : null
    };
  });

  // Sort descending: current streak DESC, longest streak DESC, total drops DESC, username ASC
  leaderboard.sort((a, b) => {
    if (b.currentStreak !== a.currentStreak) return b.currentStreak - a.currentStreak;
    if (b.longestStreak !== a.longestStreak) return b.longestStreak - a.longestStreak;
    if (b.totalDrops !== a.totalDrops) return b.totalDrops - a.totalDrops;
    return a.username.localeCompare(b.username);
  });

  return leaderboard;
}

// -----------------------------------------------------------------------------
// 2. Maker Streak Calculator & Badge Tiering
// -----------------------------------------------------------------------------

/**
 * Resolves badge info and perks based on streak count or tier name.
 */
export function getMakerBadgeInfo(tierOrStreak: MakerBadgeTier | number): MakerBadgeInfo {
  if (typeof tierOrStreak === 'number') {
    if (tierOrStreak >= 14) return MAKER_BADGE_TIERS['Legend'];
    if (tierOrStreak >= 7) return MAKER_BADGE_TIERS['Hot Streak'];
    if (tierOrStreak >= 3) return MAKER_BADGE_TIERS['Iron Maker'];
    return MAKER_BADGE_TIERS['Rookie'];
  }
  return MAKER_BADGE_TIERS[tierOrStreak] || MAKER_BADGE_TIERS['Rookie'];
}

/**
 * Calculates maker streak multiplier for ranking and royalties.
 */
export function calculateStreakMultiplier(streak: number = 0): number {
  if (streak <= 0) return 1.0;
  const badge = getMakerBadgeInfo(streak);
  // Base tier multiplier plus small incremental boost per day capped at 1.75
  const incremental = Math.min(0.15, streak * 0.01);
  return Number((badge.multiplier + incremental).toFixed(3));
}

/**
 * Updates a maker's streak when a new drop is submitted.
 * - Same-day drop (<= 24h from last or same batch window): streak increments if new batch window, or maintains if duplicate within same day.
 * - Grace window (24h < diff <= 48h): streak increments or maintains without reset.
 * - Inactivity (> 48h): streak resets to 1.
 */
export function calculateMakerStreak(
  lastDropDateInput: Date | string | number | null,
  currentDateInput: Date | string | number = new Date(),
  currentStreak: number = 0
): {
  newStreak: number;
  isMaintained: boolean;
  isGraceWindow: boolean;
  isReset: boolean;
  badge: MakerBadgeInfo;
} {
  const current = normalizeDate(currentDateInput);

  if (!lastDropDateInput) {
    const newStreak = 1;
    return {
      newStreak,
      isMaintained: true,
      isGraceWindow: false,
      isReset: false,
      badge: getMakerBadgeInfo(newStreak)
    };
  }

  const last = normalizeDate(lastDropDateInput);
  const diffHours = (current.getTime() - last.getTime()) / (1000 * 60 * 60);

  if (diffHours < 0) {
    // Current time is behind last drop time (clock skew or historical data)
    return {
      newStreak: Math.max(1, currentStreak),
      isMaintained: true,
      isGraceWindow: false,
      isReset: false,
      badge: getMakerBadgeInfo(Math.max(1, currentStreak))
    };
  }

  const lastBatch = getCurrentBatchWindow(last);
  const currBatch = getCurrentBatchWindow(current);

  if (lastBatch.batchId === currBatch.batchId) {
    // Multiple drops in the same 12:01 AM batch window - preserve active streak
    const streak = Math.max(1, currentStreak);
    return {
      newStreak: streak,
      isMaintained: true,
      isGraceWindow: false,
      isReset: false,
      badge: getMakerBadgeInfo(streak)
    };
  }

  if (diffHours <= 24) {
    const newStreak = (currentStreak || 0) + 1;
    return {
      newStreak,
      isMaintained: true,
      isGraceWindow: false,
      isReset: false,
      badge: getMakerBadgeInfo(newStreak)
    };
  } else if (diffHours <= 48) {
    // Grace window: streak preserved or incremented
    const newStreak = Math.max(1, (currentStreak || 0) + 1);
    return {
      newStreak,
      isMaintained: true,
      isGraceWindow: true,
      isReset: false,
      badge: getMakerBadgeInfo(newStreak)
    };
  } else {
    // Streak expired beyond 48 hours
    const newStreak = 1;
    return {
      newStreak,
      isMaintained: false,
      isGraceWindow: false,
      isReset: true,
      badge: getMakerBadgeInfo(newStreak)
    };
  }
}

/**
 * Processes a full chronological history of drop timestamps for a maker to compute
 * current active streak, longest lifetime streak, and current badge tier.
 */
export function calculateMakerStreakFromHistory(
  dropDates: (Date | string | number)[],
  nowInput?: Date | string | number
): {
  currentStreak: number;
  longestStreak: number;
  totalDrops: number;
  activeTier: MakerBadgeTier;
  badgeInfo: MakerBadgeInfo;
  lastDropDate: Date | null;
} {
  if (!dropDates || dropDates.length === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      totalDrops: 0,
      activeTier: 'Rookie',
      badgeInfo: MAKER_BADGE_TIERS['Rookie'],
      lastDropDate: null
    };
  }

  // Sort timestamps chronologically ascending
  const sorted = dropDates
    .map(d => normalizeDate(d))
    .filter(d => !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  if (sorted.length === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      totalDrops: 0,
      activeTier: 'Rookie',
      badgeInfo: MAKER_BADGE_TIERS['Rookie'],
      lastDropDate: null
    };
  }

  let currentStreak = 0;
  let longestStreak = 0;
  let lastEvaluatedDate: Date | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const currentDate = sorted[i];
    if (!lastEvaluatedDate) {
      currentStreak = 1;
      longestStreak = 1;
      lastEvaluatedDate = currentDate;
      continue;
    }

    const { newStreak } = calculateMakerStreak(lastEvaluatedDate, currentDate, currentStreak);
    currentStreak = newStreak;
    if (currentStreak > longestStreak) {
      longestStreak = currentStreak;
    }
    lastEvaluatedDate = currentDate;
  }

  // Check if current streak has decayed relative to Date.now() / nowInput
  const now = nowInput ? normalizeDate(nowInput) : new Date();
  if (lastEvaluatedDate) {
    const diffHoursFromNow = (now.getTime() - lastEvaluatedDate.getTime()) / (1000 * 60 * 60);
    if (diffHoursFromNow > 48) {
      currentStreak = 0; // Inactive today
    }
  }

  const badgeInfo = getMakerBadgeInfo(currentStreak);

  return {
    currentStreak,
    longestStreak,
    totalDrops: sorted.length,
    activeTier: badgeInfo.tier,
    badgeInfo,
    lastDropDate: lastEvaluatedDate
  };
}

// -----------------------------------------------------------------------------
// 3. Hotwire Drop Ranking Algorithm
// -----------------------------------------------------------------------------

/**
 * Calculates the composite Hotwire ranking score for a drop.
 * Formula balances:
 * - Upvotes & Forks (weighted by fork lineage value)
 * - Lineage Depth multiplier (Local-First open-core tree depth)
 * - Maker Streak Multiplier (boost for consistent daily creators)
 * - Velocity Multiplier (rate of incoming upvotes / interest)
 * - Hacker News style Time-decay gravity curve based on drop release age
 */
export function calculateHotwireScore(
  drop: DropRankingInput,
  options: RankingOptions = {}
): {
  score: number;
  metrics: RankedDropResult['rankingMetrics'];
} {
  const {
    gravity = 1.45,
    upvoteWeight = 1.0,
    forkWeight = 2.5,
    forkDepthWeight = 0.15,
    now: nowInput = new Date()
  } = options;

  const now = normalizeDate(nowInput);
  const createdAt = normalizeDate(drop.createdAt || now);

  const upvotes = Math.max(0, drop.upvotes || 0);
  const forks = Math.max(0, drop.forks || 0);
  const forkDepth = Math.max(0, drop.forkDepth || 0);
  const streak = Math.max(0, drop.creatorStreak || 0);

  // 1. Base Score: Weighted combination of direct upvotes and downstream forks
  const baseScore = (upvotes * upvoteWeight) + (forks * forkWeight);

  // 2. Lineage Bonus: Multiplier rewarded for deep Git/AST lineage trees
  // Logarithmic scaling on forks + linear bonus for verified depth
  const forkLog = forks > 0 ? Math.log10(forks + 1) : 0;
  const lineageBonus = Number((1.0 + (forkLog * 0.25) + (forkDepth * forkDepthWeight)).toFixed(4));

  // 3. Streak Multiplier
  const streakMultiplier = calculateStreakMultiplier(streak);

  // 4. Velocity Multiplier: Bonus for drops gaining traction quickly
  const velocity = typeof drop.velocity === 'number' ? Math.max(0, drop.velocity) : 0;
  const velocityMultiplier = velocity > 0 ? Number(Math.min(2.5, 1.0 + (velocity * 0.15)).toFixed(3)) : 1.0;

  // 5. Time Decay: Age in hours with gravity exponent
  const ageMs = Math.max(0, now.getTime() - createdAt.getTime());
  const ageInHours = Number((ageMs / (1000 * 60 * 60)).toFixed(2));
  // (age + 2)^gravity damping prevents extreme division by zero or runaway scores in first few minutes
  const timeDecay = Number((1.0 / Math.pow(ageInHours + 2.0, gravity)).toFixed(5));

  // Composite Score
  const rawScore = (baseScore + 1.0) * lineageBonus * streakMultiplier * velocityMultiplier * (timeDecay * 10.0);
  const score = Number(Math.max(0.001, rawScore).toFixed(4));

  return {
    score,
    metrics: {
      baseScore,
      velocityMultiplier,
      streakMultiplier,
      lineageBonus,
      timeDecay,
      ageInHours,
      rank: 0
    }
  };
}

/**
 * Ranks an array of drops deterministically by Hotwire score, breaking ties by upvotes,
 * forks, creation date, and alphanumeric ID.
 */
export function rankDrops(
  drops: DropRankingInput[],
  options: RankingOptions = {}
): RankedDropResult[] {
  if (!drops || !Array.isArray(drops) || drops.length === 0) {
    return [];
  }

  const evaluated: RankedDropResult[] = drops.map(d => {
    const { score, metrics } = calculateHotwireScore(d, options);
    return {
      ...d,
      hotwireScore: score,
      rankingMetrics: metrics
    };
  });

  // Sort descending by score, tiebreakers: upvotes DESC, forks DESC, createdAt DESC, id ASC
  evaluated.sort((a, b) => {
    if (b.hotwireScore !== a.hotwireScore) {
      return b.hotwireScore - a.hotwireScore;
    }
    const upvotesA = a.upvotes || 0;
    const upvotesB = b.upvotes || 0;
    if (upvotesB !== upvotesA) {
      return upvotesB - upvotesA;
    }
    const forksA = a.forks || 0;
    const forksB = b.forks || 0;
    if (forksB !== forksA) {
      return forksB - forksA;
    }
    const timeA = normalizeDate(a.createdAt).getTime();
    const timeB = normalizeDate(b.createdAt).getTime();
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    return String(a.id).localeCompare(String(b.id));
  });

  // Assign 1-indexed rank
  evaluated.forEach((item, index) => {
    item.rankingMetrics.rank = index + 1;
  });

  return evaluated;
}

// -----------------------------------------------------------------------------
// 4. Idempotent Upvoting & Cryptographic Hashing
// -----------------------------------------------------------------------------

/**
 * Fast SHA-256 hex digest generator compatible with Cloudflare Workers (crypto.subtle),
 * Node.js (globalThis.crypto.subtle), and standard modern browsers.
 */
export async function sha256Hex(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);

  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback for Node.js environments
  try {
    const nodeCrypto = await import('node:crypto');
    return nodeCrypto.createHash('sha256').update(message).digest('hex');
  } catch {
    let h1 = 0x811c9dc5;
    let h2 = 0x811c9dc5;
    for (let i = 0; i < message.length; i++) {
      const c = message.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193);
      h2 = Math.imul(h2 ^ (c + i), 0x01000193);
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }
}

/**
 * Anonymizes client IP address to protect voter privacy while preserving network uniqueness.
 * Masks last octet of IPv4 or last 64 bits of IPv6.
 */
export function anonymizeIp(ip: string): string {
  if (!ip || ip.trim().length === 0) return '0.0.0.0';
  const cleanIp = ip.trim();

  // IPv4
  if (cleanIp.includes('.')) {
    const parts = cleanIp.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
  }

  // IPv6
  if (cleanIp.includes(':')) {
    const parts = cleanIp.split(':');
    return parts.slice(0, 3).join(':') + '::';
  }

  return cleanIp;
}

/**
 * Generates an anonymous, deterministic voter token hash using SHA-256.
 * Salt combines voter identification (masked IP / user token), drop ID, and optional batch ID / secret.
 */
export async function hashVoterKey(
  voterIdentifier: string,
  appId: string,
  secretSalt: string = 'nsw_hotwire_voter_salt_2026',
  batchId?: string
): Promise<string> {
  const normalizedVoter = voterIdentifier.trim().toLowerCase();
  const normalizedApp = appId.trim();
  const batchSegment = batchId ? `::${batchId}` : '';
  const payload = `${secretSalt}::${normalizedVoter}::${normalizedApp}${batchSegment}`;
  return sha256Hex(payload);
}

export interface VoteValidationResult {
  valid: boolean;
  voterHash?: string;
  error?: string;
}

/**
 * Validates an incoming upvote request and produces an idempotent voter hash.
 */
export async function validateAndHashVote(
  appId: string,
  clientIp?: string,
  voterToken?: string,
  secretSalt?: string
): Promise<VoteValidationResult> {
  if (!appId || appId.trim().length === 0) {
    return { valid: false, error: 'App ID is required for upvoting' };
  }

  const ip = clientIp ? anonymizeIp(clientIp) : 'anonymous_client';
  const token = voterToken && voterToken.trim().length > 0 ? voterToken.trim() : ip;

  const voterHash = await hashVoterKey(token, appId, secretSalt);
  return {
    valid: true,
    voterHash
  };
}

/**
 * In-memory or cache-backed store for tracking idempotent upvotes and preventing duplicate voting.
 */
export class IdempotentVoteStore {
  private votes = new Set<string>();

  /**
   * Hashes key and registers vote. Returns true if vote is NEW, false if already voted.
   */
  async castVote(voterIdentifier: string, appId: string, secretSalt?: string): Promise<{
    isNewVote: boolean;
    voterHash: string;
  }> {
    const voterHash = await hashVoterKey(voterIdentifier, appId, secretSalt);
    const voteKey = `${appId}:${voterHash}`;

    if (this.votes.has(voteKey)) {
      return { isNewVote: false, voterHash };
    }

    this.votes.add(voteKey);
    return { isNewVote: true, voterHash };
  }

  hasVoted(voterHash: string, appId: string): boolean {
    return this.votes.has(`${appId}:${voterHash}`);
  }

  clear(): void {
    this.votes.clear();
  }

  size(): number {
    return this.votes.size;
  }
}

// -----------------------------------------------------------------------------
// 5. RSS 2.0 & JSON Feed Syndication Generator
// -----------------------------------------------------------------------------

function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates valid RSS 2.0 XML syndication feed for daily Hotwire drops.
 */
export function generateRssFeed(
  drops: DropRankingInput[],
  options: FeedOptions = {}
): string {
  const {
    title = "Nate's Software — 12:01 AM Daily Drops & Hotwire",
    description = "Curated, ownable shareware and independent software releases dropped daily at 12:01 AM UTC.",
    homePageUrl = "https://nates.software",
    feedUrl = "https://nates.software/api/feed?format=rss",
    language = "en-us"
  } = options;

  const buildDate = new Date().toUTCString();

  const itemsXml = (drops || []).map(drop => {
    const dropUrl = `${homePageUrl}/#drop-${drop.id}`;
    const pubDate = normalizeDate(drop.createdAt || new Date()).toUTCString();
    const creator = drop.creator || 'anonymous';
    const version = drop.version || 'v1.0.0';
    const price = drop.price || 'Free ($0) or Registered Copy';
    const storage = drop.storage || 'App-managed storage';
    const moddability = drop.moddabilityScore !== undefined ? `${drop.moddabilityScore}/100` : 'Not measured';
    const upvotes = drop.upvotes || 0;
    const forks = drop.forks || 0;

    let binariesHtml = '';
    if (drop.binaries && typeof drop.binaries === 'object') {
      const entries = Object.entries(drop.binaries)
        .map(([platform, name]) => `<li><b>${escapeXml(platform.toUpperCase())}:</b> ${escapeXml(String(name))}</li>`)
        .join('');
      if (entries) {
        binariesHtml = `<h4>Available Binaries:</h4><ul>${entries}</ul>`;
      }
    }

    let tagsXml = '';
    if (Array.isArray(drop.tags)) {
      tagsXml = drop.tags.map(t => `<category>${escapeXml(t)}</category>`).join('\n      ');
    }

    const contentHtml = `
      <p><strong>${escapeXml(drop.tagline || '')}</strong></p>
      <p>${escapeXml(drop.description || '')}</p>
      <hr/>
      <ul>
        <li><b>Author:</b> @${escapeXml(creator)}</li>
        <li><b>Version:</b> ${escapeXml(version)}</li>
        <li><b>License:</b> ${escapeXml(drop.license || 'MIT')}</li>
        <li><b>Price:</b> ${escapeXml(price)}</li>
        <li><b>Storage:</b> ${escapeXml(storage)}</li>
        <li><b>Moddability Score:</b> ${moddability}</li>
        <li><b>Upvotes:</b> ${upvotes} | <b>Forks:</b> ${forks}</li>
      </ul>
      ${binariesHtml}
    `.trim();

    return `
    <item>
      <title>${escapeXml(`${drop.name} (${version})`)}</title>
      <link>${escapeXml(dropUrl)}</link>
      <guid isPermaLink="false">${escapeXml(`drop-${drop.id}-${version}`)}</guid>
      <pubDate>${pubDate}</pubDate>
      <dc:creator>${escapeXml(creator)}</dc:creator>
      <description><![CDATA[${contentHtml}]]></description>
      ${tagsXml}
    </item>`.trim();
  }).join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(homePageUrl)}</link>
    <description>${escapeXml(description)}</description>
    <language>${escapeXml(language)}</language>
    <lastBuildDate>${buildDate}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
    ${itemsXml}
  </channel>
</rss>`.trim();
}

/**
 * Generates JSON Feed v1.1 syndication document for daily Hotwire drops.
 */
export function generateJsonFeed(
  drops: DropRankingInput[],
  options: FeedOptions = {}
): JsonFeedDocument {
  const {
    title = "Nate's Software — 12:01 AM Daily Drops & Hotwire",
    description = "Curated, ownable shareware and independent software releases dropped daily at 12:01 AM UTC.",
    homePageUrl = "https://nates.software",
    feedUrl = "https://nates.software/api/feed?format=json",
    language = "en"
  } = options;

  const items: JsonFeedItem[] = (drops || []).map(drop => {
    const dropUrl = `${homePageUrl}/#drop-${drop.id}`;
    const pubDate = normalizeDate(drop.createdAt || new Date()).toISOString();
    const creator = drop.creator || 'anonymous';
    const version = drop.version || 'v1.0.0';
    const price = drop.price || 'Free ($0) or Registered Copy';
    const storage = drop.storage || 'App-managed storage';
    const moddabilityFormatted = drop.moddabilityScore !== undefined ? `${drop.moddabilityScore}/100` : 'Not measured';

    let binariesHtml = '';
    const attachments: JsonFeedItem['attachments'] = [];

    if (drop.binaries && typeof drop.binaries === 'object') {
      const entries = Object.entries(drop.binaries)
        .map(([platform, name]) => {
          attachments.push({
            url: `${homePageUrl}/downloads/${encodeURIComponent(String(name))}`,
            mime_type: 'application/octet-stream',
            title: `${platform.toUpperCase()} Binary: ${name}`
          });
          return `<li><b>${escapeXml(platform.toUpperCase())}:</b> ${escapeXml(String(name))}</li>`;
        })
        .join('');
      if (entries) {
        binariesHtml = `<h4>Available Binaries:</h4><ul>${entries}</ul>`;
      }
    }

    const contentHtml = `
      <p><strong>${escapeXml(drop.tagline || '')}</strong></p>
      <p>${escapeXml(drop.description || '')}</p>
      <hr/>
      <ul>
        <li><b>Author:</b> @${escapeXml(creator)}</li>
        <li><b>Version:</b> ${escapeXml(version)}</li>
        <li><b>License:</b> ${escapeXml(drop.license || 'MIT')}</li>
        <li><b>Price:</b> ${escapeXml(price)}</li>
        <li><b>Storage:</b> ${escapeXml(storage)}</li>
        <li><b>Moddability Score:</b> ${moddabilityFormatted}</li>
        <li><b>Upvotes:</b> ${drop.upvotes || 0} | <b>Forks:</b> ${drop.forks || 0}</li>
      </ul>
      ${binariesHtml}
    `.trim();

    const image = Array.isArray(drop.screenshots) && drop.screenshots.length > 0 ? drop.screenshots[0] : undefined;

    return {
      id: `drop-${drop.id}-${version}`,
      url: dropUrl,
      title: `${drop.name} (${version})`,
      summary: drop.tagline || drop.description,
      content_html: contentHtml,
      image,
      date_published: pubDate,
      authors: [
        {
          name: creator,
          avatar: drop.creatorAvatar
        }
      ],
      tags: Array.isArray(drop.tags) ? drop.tags : [],
      attachments: attachments.length > 0 ? attachments : undefined,
      _hotwire: {
        upvotes: drop.upvotes || 0,
        forks: drop.forks || 0,
        version,
        license: drop.license || 'MIT',
        price,
        storage,
        moddabilityScore: drop.moddabilityScore
      }
    };
  });

  return {
    version: "https://jsonfeed.org/version/1.1",
    title,
    home_page_url: homePageUrl,
    feed_url: feedUrl,
    description,
    language,
    icon: `${homePageUrl}/favicon.ico`,
    favicon: `${homePageUrl}/favicon.ico`,
    items
  };
}

/**
 * Syndication feed content resolver based on query format or request Accept header.
 */
export function generateFeedResponse(
  drops: DropRankingInput[],
  format: 'rss' | 'json' | 'auto' = 'auto',
  requestUrl?: string,
  acceptHeader?: string
): {
  body: string;
  contentType: string;
} {
  const isJson = format === 'json' ||
    (format === 'auto' && acceptHeader && acceptHeader.includes('application/feed+json') && !acceptHeader.includes('application/rss+xml'));

  const homePageUrl = requestUrl ? new URL(requestUrl).origin : 'https://nates.software';
  const feedUrl = requestUrl || `${homePageUrl}/api/feed`;

  if (isJson) {
    const jsonDoc = generateJsonFeed(drops, { homePageUrl, feedUrl });
    return {
      body: JSON.stringify(jsonDoc, null, 2),
      contentType: 'application/feed+json; charset=utf-8'
    };
  }

  const rssXml = generateRssFeed(drops, { homePageUrl, feedUrl });
  return {
    body: rssXml,
    contentType: 'application/rss+xml; charset=utf-8'
  };
}
