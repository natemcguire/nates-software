import { describe, it, expect } from 'vitest';
import {
  getCurrentBatchWindow,
  getTimeToNextDrop,
  isBatchRollover,
  getDropBatchNumber,
  calculateHotwireScore,
  rankDrops,
  getMakerBadgeInfo,
  calculateStreakMultiplier,
  calculateMakerStreak,
  calculateMakerStreakFromHistory,
  sha256Hex,
  anonymizeIp,
  hashVoterKey,
  validateAndHashVote,
  IdempotentVoteStore,
  generateRssFeed,
  generateJsonFeed,
  generateFeedResponse,
  getYesterdayBatchWindow,
  getBatchWindowById,
  resolveBatchFilter,
  filterDropsByBatch,
  buildMakerLeaderboard,
  MAKER_BADGE_TIERS,
  DropRankingInput
} from '../src/lib/hotwireBackend';
import { validateDropSubmission, parseAndValidatePrice } from '../src/lib/hotwireDomain';

describe('1. Daily 12:01 AM UTC Batch Rollover & Time-To-Next-Drop Logic', () => {
  it('should assign timestamps before 00:01:00 UTC to previous day batch', () => {
    // 2026-08-26 00:00:30 UTC -> Batch belongs to 2026-08-25
    const testDate = new Date('2026-08-26T00:00:30.000Z');
    const batch = getCurrentBatchWindow(testDate);

    expect(batch.batchId).toBe('drop-2026-08-25');
    expect(batch.windowStart.toISOString()).toBe('2026-08-25T00:01:00.000Z');
    expect(batch.windowEnd.toISOString()).toBe('2026-08-26T00:01:00.000Z');
    expect(batch.isCurrent).toBe(true);
  });

  it('should assign timestamps at or after 00:01:00 UTC to current day batch', () => {
    // 2026-08-26 00:01:00 UTC -> Batch belongs to 2026-08-26
    const exactRollover = new Date('2026-08-26T00:01:00.000Z');
    const batchExact = getCurrentBatchWindow(exactRollover);
    expect(batchExact.batchId).toBe('drop-2026-08-26');
    expect(batchExact.windowStart.toISOString()).toBe('2026-08-26T00:01:00.000Z');
    expect(batchExact.windowEnd.toISOString()).toBe('2026-08-27T00:01:00.000Z');

    // 2026-08-26 14:30:00 UTC -> Batch belongs to 2026-08-26
    const midDay = new Date('2026-08-26T14:30:00.000Z');
    const batchMidDay = getCurrentBatchWindow(midDay);
    expect(batchMidDay.batchId).toBe('drop-2026-08-26');
  });

  it('should calculate accurate time to next drop and countdown string', () => {
    // 2 hours before 00:01:00 UTC cutoff on 2026-08-26
    const twoHoursBefore = new Date('2026-08-25T22:01:00.000Z');
    const countdown = getTimeToNextDrop(twoHoursBefore);

    expect(countdown.hours).toBe(2);
    expect(countdown.minutes).toBe(0);
    expect(countdown.seconds).toBe(0);
    expect(countdown.totalSeconds).toBe(7200);
    expect(countdown.countdown).toBe('02h 00m 00s');
    expect(countdown.nextDropUtc.toISOString()).toBe('2026-08-26T00:01:00.000Z');
    expect(countdown.percentElapsed).toBeCloseTo(91.67, 1);
  });

  it('should detect batch rollover when crossing the 12:01 AM UTC boundary', () => {
    const beforeCutoff = new Date('2026-08-26T00:00:50.000Z');
    const afterCutoff = new Date('2026-08-26T00:01:10.000Z');

    expect(isBatchRollover(beforeCutoff, afterCutoff)).toBe(true);

    const sameWindow1 = new Date('2026-08-26T02:00:00.000Z');
    const sameWindow2 = new Date('2026-08-26T04:00:00.000Z');
    expect(isBatchRollover(sameWindow1, sameWindow2)).toBe(false);

    // Negative time / reverse order should return false
    expect(isBatchRollover(afterCutoff, beforeCutoff)).toBe(false);
  });

  it('should calculate continuous batch number from genesis epoch', () => {
    const genesisDate = new Date('2026-01-01T00:01:00.000Z');
    expect(getDropBatchNumber(genesisDate)).toBe(1);

    const day10Date = new Date('2026-01-10T12:00:00.000Z');
    expect(getDropBatchNumber(day10Date)).toBe(10);
  });
});

describe('2. Hotwire Drop Ranking Algorithm', () => {
  const baseDrop: DropRankingInput = {
    id: 'wallart-pro',
    name: 'WallArt Pro',
    upvotes: 100,
    forks: 20,
    forkDepth: 3,
    creatorStreak: 7,
    velocity: 5,
    createdAt: new Date('2026-08-26T00:01:00.000Z')
  };

  it('should compute composite score with upvotes, forks, lineage depth, and velocity', () => {
    const now = new Date('2026-08-26T06:01:00.000Z'); // 6 hours later
    const result = calculateHotwireScore(baseDrop, { now });

    expect(result.score).toBeGreaterThan(0);
    expect(result.metrics.baseScore).toBe(100 * 1.0 + 20 * 2.5); // 150
    expect(result.metrics.streakMultiplier).toBeGreaterThan(1.0); // Hot Streak tier
    expect(result.metrics.lineageBonus).toBeGreaterThan(1.0); // Forks + Depth
    expect(result.metrics.velocityMultiplier).toBeGreaterThan(1.0); // Velocity bonus
    expect(result.metrics.ageInHours).toBe(6);
    expect(result.metrics.timeDecay).toBeLessThan(1.0);
  });

  it('should reward deeper fork lineage trees with higher lineage bonus', () => {
    const shallowDrop: DropRankingInput = { ...baseDrop, id: 'shallow', forkDepth: 0, forks: 0 };
    const deepDrop: DropRankingInput = { ...baseDrop, id: 'deep', forkDepth: 5, forks: 50 };

    const scoreShallow = calculateHotwireScore(shallowDrop);
    const scoreDeep = calculateHotwireScore(deepDrop);

    expect(scoreDeep.metrics.lineageBonus).toBeGreaterThan(scoreShallow.metrics.lineageBonus);
  });

  it('should decay older drops gracefully according to gravity exponent', () => {
    const freshDrop: DropRankingInput = { ...baseDrop, id: 'fresh', createdAt: '2026-08-26T00:00:00Z' };
    const oldDrop: DropRankingInput = { ...baseDrop, id: 'old', createdAt: '2026-08-20T00:00:00Z' };
    const evalNow = new Date('2026-08-26T12:00:00Z');

    const freshResult = calculateHotwireScore(freshDrop, { now: evalNow });
    const oldResult = calculateHotwireScore(oldDrop, { now: evalNow });

    expect(freshResult.score).toBeGreaterThan(oldResult.score);
    expect(freshResult.metrics.timeDecay).toBeGreaterThan(oldResult.metrics.timeDecay);
  });

  it('should deterministically rank drops and assign 1-indexed ranks', () => {
    const now = new Date('2026-08-26T12:00:00Z');
    const drops: DropRankingInput[] = [
      { id: 'app-low', name: 'Low App', upvotes: 5, forks: 1, createdAt: now },
      { id: 'app-high', name: 'High App', upvotes: 500, forks: 80, creatorStreak: 14, createdAt: now },
      { id: 'app-mid', name: 'Mid App', upvotes: 50, forks: 10, createdAt: now }
    ];

    const ranked = rankDrops(drops, { now });

    expect(ranked).toHaveLength(3);
    expect(ranked[0].id).toBe('app-high');
    expect(ranked[0].rankingMetrics.rank).toBe(1);
    expect(ranked[1].id).toBe('app-mid');
    expect(ranked[1].rankingMetrics.rank).toBe(2);
    expect(ranked[2].id).toBe('app-low');
    expect(ranked[2].rankingMetrics.rank).toBe(3);
  });

  it('should break ties deterministically using upvotes, forks, date, and ID', () => {
    const now = new Date('2026-08-26T12:00:00Z');
    const tieDrops: DropRankingInput[] = [
      { id: 'b-app', name: 'B App', upvotes: 10, forks: 2, createdAt: now },
      { id: 'a-app', name: 'A App', upvotes: 10, forks: 2, createdAt: now }
    ];

    const ranked = rankDrops(tieDrops, { now });
    expect(ranked[0].id).toBe('a-app');
    expect(ranked[1].id).toBe('b-app');
  });

  it('should safely handle empty drop list and edge case parameters', () => {
    expect(rankDrops([])).toEqual([]);
    const zeroDropResult = calculateHotwireScore({
      id: 'zero',
      name: 'Zero',
      upvotes: 0,
      forks: 0,
      createdAt: new Date()
    });
    expect(zeroDropResult.score).toBeGreaterThan(0);
  });
});

describe('3. Maker Streak Calculator & Badge Tiering', () => {
  it('should map streak numbers to correct badge tiers and perks', () => {
    expect(getMakerBadgeInfo(0).tier).toBe('Rookie');
    expect(getMakerBadgeInfo(2).tier).toBe('Rookie');
    expect(getMakerBadgeInfo(3).tier).toBe('Iron Maker');
    expect(getMakerBadgeInfo(6).tier).toBe('Iron Maker');
    expect(getMakerBadgeInfo(7).tier).toBe('Hot Streak');
    expect(getMakerBadgeInfo(13).tier).toBe('Hot Streak');
    expect(getMakerBadgeInfo(14).tier).toBe('Legend');
    expect(getMakerBadgeInfo(100).tier).toBe('Legend');

    // Legend badge perk check
    const legendInfo = MAKER_BADGE_TIERS['Legend'];
    expect(legendInfo.multiplier).toBe(1.6);
    expect(legendInfo.feeWaiverPercent).toBe(100);
  });

  it('should calculate streak multiplier with incremental boost', () => {
    expect(calculateStreakMultiplier(0)).toBe(1.0);
    expect(calculateStreakMultiplier(3)).toBeCloseTo(1.18, 2);
    expect(calculateStreakMultiplier(7)).toBeCloseTo(1.42, 2);
    expect(calculateStreakMultiplier(14)).toBeCloseTo(1.74, 2);
  });

  it('should maintain streak when dropping in the same 12:01 AM batch window', () => {
    const drop1 = new Date('2026-08-26T02:00:00Z');
    const drop2 = new Date('2026-08-26T08:00:00Z');

    const result = calculateMakerStreak(drop1, drop2, 5);
    expect(result.newStreak).toBe(5);
    expect(result.isMaintained).toBe(true);
    expect(result.isReset).toBe(false);
  });

  it('should increment streak for consecutive daily releases within 24 hours', () => {
    const yesterday = new Date('2026-08-25T12:00:00Z');
    const today = new Date('2026-08-26T11:00:00Z');

    const result = calculateMakerStreak(yesterday, today, 4);
    expect(result.newStreak).toBe(5);
    expect(result.badge.tier).toBe('Iron Maker');
    expect(result.isReset).toBe(false);
  });

  it('should handle grace window (24h - 48h) without resetting streak', () => {
    const drop1 = new Date('2026-08-24T12:00:00Z');
    const drop2 = new Date('2026-08-25T23:00:00Z'); // 35 hours later

    const result = calculateMakerStreak(drop1, drop2, 6);
    expect(result.newStreak).toBe(7);
    expect(result.isGraceWindow).toBe(true);
    expect(result.badge.tier).toBe('Hot Streak');
  });

  it('should reset streak to 1 after > 48 hours of inactivity', () => {
    const oldDrop = new Date('2026-08-20T12:00:00Z');
    const newDrop = new Date('2026-08-26T12:00:00Z'); // 6 days later

    const result = calculateMakerStreak(oldDrop, newDrop, 12);
    expect(result.newStreak).toBe(1);
    expect(result.isReset).toBe(true);
    expect(result.badge.tier).toBe('Rookie');
  });

  it('should compute maker streak history and lifetime max streak from chronological dates', () => {
    const dropHistory = [
      '2026-08-01T12:00:00Z',
      '2026-08-02T12:00:00Z',
      '2026-08-03T12:00:00Z',
      '2026-08-04T12:00:00Z', // 4 streak
      '2026-08-10T12:00:00Z', // Reset
      '2026-08-11T12:00:00Z',
      '2026-08-12T12:00:00Z',
      '2026-08-13T12:00:00Z',
      '2026-08-14T12:00:00Z',
      '2026-08-15T12:00:00Z',
      '2026-08-16T12:00:00Z',
      '2026-08-17T12:00:00Z'  // 8 streak
    ];

    const stats = calculateMakerStreakFromHistory(dropHistory);
    expect(stats.totalDrops).toBe(12);
    expect(stats.longestStreak).toBe(8);
    expect(stats.lastDropDate).toBeInstanceOf(Date);
  });
});

describe('4. Idempotent Upvoting & Cryptographic Hashing', () => {
  it('should generate valid SHA-256 64-character hex digests', async () => {
    const hash = await sha256Hex('hello hotwire 2026');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should anonymize IPv4 and IPv6 addresses correctly', () => {
    expect(anonymizeIp('192.168.1.150')).toBe('192.168.1.0');
    expect(anonymizeIp('104.28.19.42')).toBe('104.28.19.0');
    expect(anonymizeIp('2606:4700:4700::1111')).toBe('2606:4700:4700::');
    expect(anonymizeIp('')).toBe('0.0.0.0');
  });

  it('should produce deterministic, salted voter hashes for duplicate prevention', async () => {
    const hash1 = await hashVoterKey('192.168.1.0', 'wallart', 'salt_secret');
    const hash2 = await hashVoterKey('192.168.1.0', 'wallart', 'salt_secret');
    const diffApp = await hashVoterKey('192.168.1.0', 'retro-calc', 'salt_secret');
    const diffSalt = await hashVoterKey('192.168.1.0', 'wallart', 'different_salt');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(diffApp);
    expect(hash1).not.toBe(diffSalt);
  });

  it('should validate and hash incoming upvote requests', async () => {
    const valid = await validateAndHashVote('wallart', '203.0.113.195', 'client-token-123');
    expect(valid.valid).toBe(true);
    expect(valid.voterHash).toMatch(/^[a-f0-9]{64}$/);

    const invalid = await validateAndHashVote('');
    expect(invalid.valid).toBe(false);
    expect(invalid.error).toContain('App ID is required');
  });

  it('should enforce idempotency in IdempotentVoteStore', async () => {
    const store = new IdempotentVoteStore();

    const firstVote = await store.castVote('voter_1', 'app_wallart');
    expect(firstVote.isNewVote).toBe(true);
    expect(store.hasVoted(firstVote.voterHash, 'app_wallart')).toBe(true);

    // Duplicate vote on same app
    const secondVote = await store.castVote('voter_1', 'app_wallart');
    expect(secondVote.isNewVote).toBe(false);
    expect(secondVote.voterHash).toBe(firstVote.voterHash);

    // Vote on different app by same voter is accepted
    const otherAppVote = await store.castVote('voter_1', 'app_retro_calc');
    expect(otherAppVote.isNewVote).toBe(true);

    expect(store.size()).toBe(2);
    store.clear();
    expect(store.size()).toBe(0);
  });
});

describe('5. RSS 2.0 & JSON Feed Syndication Generator', () => {
  const sampleDrops: DropRankingInput[] = [
    {
      id: 'wallart',
      name: 'WallArt Canvas Pro',
      tagline: 'AI photo-to-canvas rendering engine and multi-panel previewer.',
      description: 'WallArt Canvas Pro transforms high-resolution photography into gallery-grade displays.',
      creator: 'nate',
      creatorAvatar: '⚡',
      version: 'v2.4.0',
      license: 'MIT',
      price: '$25 Registered Copy',
      storage: 'Single-file SQLite WAL (/data/wallart.sqlite)',
      moddabilityScore: 96,
      upvotes: 384,
      forks: 112,
      tags: ['Photo Studio', 'SQLite WAL', 'Next.js 16'],
      binaries: {
        mac: 'WallArt-2.4.0-Universal.dmg (24.8MB)',
        win: 'WallArt-Setup-2.4.0.exe (28.2MB)'
      },
      screenshots: ['https://images.unsplash.com/photo-1513519245088-0e12902e5a38'],
      createdAt: new Date('2026-08-26T00:01:00Z')
    }
  ];

  it('should generate valid RSS 2.0 XML with items and metadata', () => {
    const rss = generateRssFeed(sampleDrops, {
      title: "Nate's Software RSS",
      homePageUrl: 'https://nates.software'
    });

    expect(rss).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(rss).toContain('<rss version="2.0"');
    expect(rss).toContain('<title>Nate&apos;s Software RSS</title>');
    expect(rss).toContain('<title>WallArt Canvas Pro (v2.4.0)</title>');
    expect(rss).toContain('<dc:creator>nate</dc:creator>');
    expect(rss).toContain('<category>Photo Studio</category>');
    expect(rss).toContain('Single-file SQLite WAL');
    expect(rss).toContain('WallArt-2.4.0-Universal.dmg');
  });

  it('should generate valid JSON Feed 1.1 document with attachments and custom metadata', () => {
    const jsonFeed = generateJsonFeed(sampleDrops, {
      title: "Nate's Software JSON Feed",
      homePageUrl: 'https://nates.software'
    });

    expect(jsonFeed.version).toBe('https://jsonfeed.org/version/1.1');
    expect(jsonFeed.title).toBe("Nate's Software JSON Feed");
    expect(jsonFeed.items).toHaveLength(1);

    const item = jsonFeed.items[0];
    expect(item.id).toBe('drop-wallart-v2.4.0');
    expect(item.title).toBe('WallArt Canvas Pro (v2.4.0)');
    expect(item.authors?.[0]?.name).toBe('nate');
    expect(item.tags).toContain('Photo Studio');
    expect(item.attachments?.[0]?.title).toContain('MAC Binary');
    expect(item._hotwire?.moddabilityScore).toBe(96);
    expect(item._hotwire?.upvotes).toBe(384);
  });

  it('should generate proper HTTP responses for rss and json formats', () => {
    const rssRes = generateFeedResponse(sampleDrops, 'rss', 'https://nates.software/api/feed?format=rss');
    expect(rssRes.contentType).toContain('application/rss+xml');
    expect(rssRes.body).toContain('<rss version="2.0"');

    const jsonRes = generateFeedResponse(sampleDrops, 'json', 'https://nates.software/api/feed?format=json');
    expect(jsonRes.contentType).toContain('application/feed+json');
    const parsed = JSON.parse(jsonRes.body);
    expect(parsed.version).toBe('https://jsonfeed.org/version/1.1');
  });
});

describe('6. Batch Window Querying, Resolution & Maker Leaderboard', () => {
  it('should calculate yesterday batch window accurately', () => {
    const testDate = new Date('2026-08-29T12:00:00.000Z');
    const yesterdayBatch = getYesterdayBatchWindow(testDate);
    expect(yesterdayBatch.batchId).toBe('drop-2026-08-28');
    expect(yesterdayBatch.windowStart.toISOString()).toBe('2026-08-28T00:01:00.000Z');
    expect(yesterdayBatch.windowEnd.toISOString()).toBe('2026-08-29T00:01:00.000Z');
  });

  it('should parse batch ID into full BatchWindow', () => {
    const parsed = getBatchWindowById('drop-2026-08-20');
    expect(parsed).not.toBeNull();
    expect(parsed!.batchId).toBe('drop-2026-08-20');
    expect(parsed!.windowStart.toISOString()).toBe('2026-08-20T00:01:00.000Z');
    expect(parsed!.windowEnd.toISOString()).toBe('2026-08-21T00:01:00.000Z');

    expect(getBatchWindowById('invalid')).toBeNull();
  });

  it('should resolve batch filter parameters correctly', () => {
    const now = new Date('2026-08-29T12:00:00.000Z');
    expect(resolveBatchFilter('all', now).type).toBe('all');
    expect(resolveBatchFilter(null, now).type).toBe('all');

    const todayFilter = resolveBatchFilter('today', now);
    expect(todayFilter.type).toBe('today');
    expect(todayFilter.batchId).toBe('drop-2026-08-29');

    const yesterdayFilter = resolveBatchFilter('yesterday', now);
    expect(yesterdayFilter.type).toBe('yesterday');
    expect(yesterdayFilter.batchId).toBe('drop-2026-08-28');

    const archiveFilter = resolveBatchFilter('archive', now);
    expect(archiveFilter.type).toBe('archive');
    expect(archiveFilter.isArchive).toBe(true);

    const customFilter = resolveBatchFilter('drop-2026-08-15', now);
    expect(customFilter.type).toBe('custom');
    expect(customFilter.batchId).toBe('drop-2026-08-15');
  });

  it('should filter in-memory drops by batch window', () => {
    const now = new Date('2026-08-29T12:00:00.000Z');
    const drops: DropRankingInput[] = [
      { id: 'today', name: 'Today Drop', upvotes: 10, createdAt: new Date('2026-08-29T06:00:00Z') },
      { id: 'yesterday', name: 'Yesterday Drop', upvotes: 20, createdAt: new Date('2026-08-28T18:00:00Z') },
      { id: 'old', name: 'Old Drop', upvotes: 5, createdAt: new Date('2026-08-20T12:00:00Z') }
    ];

    expect(filterDropsByBatch(drops, 'all', now)).toHaveLength(3);
    expect(filterDropsByBatch(drops, 'today', now).map(d => d.id)).toEqual(['today']);
    expect(filterDropsByBatch(drops, 'yesterday', now).map(d => d.id)).toEqual(['yesterday']);
    expect(filterDropsByBatch(drops, 'archive', now).map(d => d.id)).toEqual(['yesterday', 'old']);
  });

  it('should build maker streak leaderboard sorted by streak and drops', () => {
    const makers = [
      {
        id: 'usr_1',
        username: 'alice',
        displayName: 'Alice',
        dropDates: ['2026-08-26T12:00:00Z', '2026-08-27T12:00:00Z', '2026-08-28T12:00:00Z'] // 3 streak
      },
      {
        id: 'usr_2',
        username: 'bob',
        displayName: 'Bob',
        dropDates: [
          '2026-08-22T12:00:00Z', '2026-08-23T12:00:00Z', '2026-08-24T12:00:00Z',
          '2026-08-25T12:00:00Z', '2026-08-26T12:00:00Z', '2026-08-27T12:00:00Z',
          '2026-08-28T12:00:00Z' // 7 streak (Hot Streak)
        ]
      }
    ];

    const leaderboard = buildMakerLeaderboard(makers, new Date('2026-08-28T12:00:00Z'));
    expect(leaderboard).toHaveLength(2);
    expect(leaderboard[0].username).toBe('bob');
    expect(leaderboard[0].badgeInfo.tier).toBe('Hot Streak');
    expect(leaderboard[1].username).toBe('alice');
    expect(leaderboard[1].badgeInfo.tier).toBe('Iron Maker');
  });
});

describe('7. Domain Drop Validation & Price Parsing Robustness', () => {
  it('should parse and format valid price strings and numbers', () => {
    expect(parseAndValidatePrice('$15.00')).toEqual({ valid: true, priceStr: '$15.00', priceCents: 1500 });
    expect(parseAndValidatePrice('20.50')).toEqual({ valid: true, priceStr: '$20.50', priceCents: 2050 });
    expect(parseAndValidatePrice(25)).toEqual({ valid: true, priceStr: '$25.00', priceCents: 2500 });
    expect(parseAndValidatePrice('$1')).toEqual({ valid: true, priceStr: '$1.00', priceCents: 100 });
    expect(parseAndValidatePrice(undefined)).toEqual({ valid: true, priceStr: '$15.00', priceCents: 1500 });
  });

  it('should reject invalid or out-of-bounds prices', () => {
    expect(parseAndValidatePrice('invalid_price').valid).toBe(false);
    expect(parseAndValidatePrice('$0').valid).toBe(false);
    expect(parseAndValidatePrice(-10).valid).toBe(false);
    expect(parseAndValidatePrice(999999).valid).toBe(false);
  });

  it('should validate drop ID slug format', () => {
    const valid = validateDropSubmission({ name: 'Valid Name', version: 'v1.0.0', id: 'valid-drop_123' });
    expect(valid.valid).toBe(true);

    const invalid = validateDropSubmission({ name: 'Valid Name', version: 'v1.0.0', id: 'bad drop ID with spaces!' });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors[0]).toContain('Drop ID must be 2-64 characters');
  });
});
