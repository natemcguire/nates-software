import { describe, it, expect, beforeEach } from "vitest";
import {
  MicroDynoPortAllocator,
  RigMemoryGovernor,
  SqliteWalEngine,
  R2SnapshotEngine,
  RigRuntimeBackend,
  PORT_RANGE_START,
  PORT_RANGE_END,
  MEMORY_CAP_MB
} from "../src/lib/rigBackend.ts";
import { INITIAL_FLEET, validateRigContainer } from "../src/lib/rigDomain.ts";

describe("Micro-Dyno Port Allocator (3001..3010) with Collision Avoidance", () => {
  let allocator: MicroDynoPortAllocator;

  beforeEach(() => {
    allocator = new MicroDynoPortAllocator(PORT_RANGE_START, PORT_RANGE_END);
  });

  it("should have valid port boundary [3001..3010]", () => {
    expect(allocator.minPort).toBe(3001);
    expect(allocator.maxPort).toBe(3010);
    expect(allocator.getAvailablePorts().length).toBe(10);
  });

  it("should allocate ports sequentially starting from 3001", () => {
    const p1 = allocator.allocate("app-1");
    const p2 = allocator.allocate("app-2");
    const p3 = allocator.allocate("app-3");

    expect(p1).toBe(3001);
    expect(p2).toBe(3002);
    expect(p3).toBe(3003);
    expect(allocator.isAvailable(3001)).toBe(false);
    expect(allocator.isAvailable(3004)).toBe(true);
  });

  it("should respect preferred port if available", () => {
    const port = allocator.allocate("app-custom", 3007);
    expect(port).toBe(3007);
    expect(allocator.isAvailable(3007)).toBe(false);

    // Next automatic allocation should still pick lowest available (3001)
    const nextPort = allocator.allocate("app-next");
    expect(nextPort).toBe(3001);
  });

  it("should fallback to lowest available if preferred port is already occupied (collision avoidance)", () => {
    allocator.allocate("app-owner", 3005);
    const fallback = allocator.allocate("app-contender", 3005);
    expect(fallback).toBe(3001); // 3001 is lowest free
  });

  it("should release ports and make them available again", () => {
    allocator.allocate("app-1"); // 3001
    allocator.allocate("app-2"); // 3002
    allocator.release(3001);

    expect(allocator.isAvailable(3001)).toBe(true);
    const reused = allocator.allocate("app-3");
    expect(reused).toBe(3001);
  });

  it("should release ports by appId", () => {
    allocator.allocate("multi-app");
    allocator.allocate("multi-app");
    const released = allocator.releaseByApp("multi-app");
    expect(released).toEqual([3001, 3002]);
    expect(allocator.getAvailablePorts().length).toBe(10);
  });

  it("should throw PortExhaustionError when all 10 ports (3001..3010) are allocated", () => {
    for (let i = 1; i <= 10; i++) {
      allocator.allocate(`worker-\${i}`);
    }
    expect(allocator.getAvailablePorts().length).toBe(0);

    expect(() => allocator.allocate("overflow-worker")).toThrow(/Port pool exhausted/i);
  });

  it("should reject invalid appId for allocation", () => {
    expect(() => allocator.allocate("")).toThrow(/non-empty string/);
  });

  it("should reject out-of-range ports in isAvailable", () => {
    expect(allocator.isAvailable(80)).toBe(false);
    expect(allocator.isAvailable(3000)).toBe(false);
    expect(allocator.isAvailable(3011)).toBe(false);
  });
});

describe("RIG Memory Governor (256MB Cap Enforcement)", () => {
  let governor: RigMemoryGovernor;

  beforeEach(() => {
    governor = new RigMemoryGovernor();
  });

  it("should enforce strict 256MB cap constant", () => {
    expect(governor.memoryCapMb).toBe(256);
    expect(MEMORY_CAP_MB).toBe(256);
  });

  it("should allow memory allocations within 256MB limit", () => {
    const container = INITIAL_FLEET[0];
    const decision1 = governor.evaluate(container, 48);
    expect(decision1.allowed).toBe(true);
    expect(decision1.action).toBe("none");
    expect(decision1.memoryMb).toBe(48);

    const decision2 = governor.evaluate(container, 256);
    expect(decision2.allowed).toBe(true);
    expect(decision2.action).toBe("none");
    expect(decision2.memoryMb).toBe(256);
  });

  it("should trigger OOM recovery when requested memory exceeds 256MB cap", () => {
    const container = INITIAL_FLEET[0];
    const decision = governor.evaluate(container, 384);

    expect(decision.allowed).toBe(false);
    expect(decision.action).toBe("oom_recovered");
    expect(decision.status).toBe("oom_recovered");
    expect(decision.memoryMb).toBe(24); // Clamped to baseline
    expect(decision.message).toContain("exceeds strict 256MB cap");
  });

  it("should reject invalid memory requests (negative or non-finite)", () => {
    const container = INITIAL_FLEET[0];
    expect(governor.evaluate(container, -10).allowed).toBe(false);
    expect(governor.evaluate(container, NaN).allowed).toBe(false);
    expect(governor.evaluate(container, Infinity).allowed).toBe(false);
  });

  it("should compute fleet memory statistics accurately", () => {
    const stats = governor.getFleetStats(INITIAL_FLEET);
    expect(stats.totalCapMb).toBe(INITIAL_FLEET.length * 256);
    expect(stats.totalUsedMb).toBe(48 + 24 + 38);
    expect(stats.healthyCount).toBe(3);
    expect(stats.oomCount).toBe(0);
    expect(stats.usagePercent).toBeGreaterThan(0);
  });
});

describe("SQLite WAL Checkpoint Engine", () => {
  let walEngine: SqliteWalEngine;

  beforeEach(() => {
    walEngine = new SqliteWalEngine();
  });

  it("should trigger TRUNCATE checkpoint and flush journal bytes", () => {
    const report = walEngine.triggerCheckpoint("/data/app.sqlite", 65536, 1468006, "TRUNCATE");
    expect(report.success).toBe(true);
    expect(report.bytesFlushed).toBe(65536);
    expect(report.finalWalSizeBytes).toBe(0);
    expect(report.finalSqliteSizeBytes).toBe(1468006 + 65536);
    expect(report.mode).toBe("TRUNCATE");
    expect(report.log).toContain("PRAGMA wal_checkpoint(TRUNCATE)");
  });

  it("should support PASSIVE, FULL, and RESTART checkpoint modes", () => {
    const passiveReport = walEngine.triggerCheckpoint("/data/test.sqlite", 10000, 50000, "PASSIVE");
    expect(passiveReport.mode).toBe("PASSIVE");
    expect(passiveReport.success).toBe(true);

    const restartReport = walEngine.triggerCheckpoint("/data/test.sqlite", 10000, 50000, "RESTART");
    expect(restartReport.mode).toBe("RESTART");
    expect(restartReport.success).toBe(true);
  });

  it("should reject path traversal in SQLite volume path", () => {
    expect(() =>
      walEngine.triggerCheckpoint("/data/../etc/passwd.sqlite", 100, 100)
    ).toThrow(/path traversal/i);
  });

  it("should reject negative size values", () => {
    expect(() =>
      walEngine.triggerCheckpoint("/data/valid.sqlite", -5, 100)
    ).toThrow(/non-negative/i);
  });
});

describe("Cloudflare R2 Snapshot Backup Engine", () => {
  let r2: R2SnapshotEngine;

  beforeEach(() => {
    r2 = new R2SnapshotEngine("rig-test-bucket");
  });

  it("should create and store R2 snapshot metadata with SHA-256", () => {
    const snap = r2.createSnapshot("wallart", "/data/wallart.sqlite", 15518920);
    expect(snap.id).toContain("snap-wallart-");
    expect(snap.r2Bucket).toBe("rig-test-bucket");
    expect(snap.sizeBytes).toBe(15518920);
    expect(snap.checksumSha256.length).toBe(64);
    expect(snap.walCheckpointed).toBe(true);
    expect(snap.status).toBe("stored");
  });

  it("should verify snapshot integrity", () => {
    const snap = r2.createSnapshot("retro-calc", "/data/app.sqlite", 1468006);
    const verification = r2.verifySnapshot(snap.id);
    expect(verification.valid).toBe(true);
    expect(verification.checksumMatches).toBe(true);
    expect(verification.snapshot?.status).toBe("verified");
  });

  it("should list snapshots sorted newest first", () => {
    r2.createSnapshot("app-a", "/data/app-a.sqlite", 1000);
    r2.createSnapshot("app-b", "/data/app-b.sqlite", 2000);
    const list = r2.listSnapshots();
    expect(list.length).toBe(2);

    const filtered = r2.listSnapshots("app-a");
    expect(filtered.length).toBe(1);
    expect(filtered[0].appId).toBe("app-a");
  });

  it("should restore snapshot with zero lock contention", () => {
    const snap = r2.createSnapshot("sailtrack", "/data/telemetry.sqlite", 4404019);
    const restore = r2.restoreSnapshot(snap.id);
    expect(restore.success).toBe(true);
    expect(restore.restoredPath).toBe("/data/telemetry.sqlite");
    expect(restore.message).toContain("zero locks");
  });

  it("should delete snapshot", () => {
    const snap = r2.createSnapshot("temp-app", "/data/temp.sqlite", 500);
    expect(r2.getSnapshot(snap.id)).toBeDefined();
    expect(r2.deleteSnapshot(snap.id)).toBe(true);
    expect(r2.getSnapshot(snap.id)).toBeUndefined();
  });
});

describe("RigRuntimeBackend (Unified Fleet & Volume Manager)", () => {
  let backend: RigRuntimeBackend;

  beforeEach(() => {
    backend = new RigRuntimeBackend(INITIAL_FLEET);
  });

  it("should initialize with initial fleet and reserve their ports", () => {
    const summary = backend.getStatusSummary();
    expect(summary.totalContainers).toBe(INITIAL_FLEET.length);
    expect(summary.activePorts).toEqual([3001, 3002, 3003]);
    expect(summary.availablePorts.length).toBe(7);
  });

  it("should spawn new micro-container and allocate next available port (3004)", () => {
    const container = backend.spawnContainer({
      appId: "dronehunter",
      name: "nate/dronehunter",
      initialMemoryMb: 32
    });

    expect(container.port).toBe(3004);
    expect(container.memoryCapMb).toBe(256);
    expect(container.sqlitePath).toBe("/data/dronehunter.sqlite");
    expect(container.status).toBe("online");

    const validCheck = validateRigContainer(container);
    expect(validCheck.valid).toBe(true);
  });

  it("should reject container spawn if initial memory exceeds 256MB cap", () => {
    expect(() =>
      backend.spawnContainer({
        appId: "heavy-app",
        name: "heavy/app",
        initialMemoryMb: 512
      })
    ).toThrow(/exceeds 256MB/i);
  });

  it("should update container memory and trigger OOM recovery if cap exceeded", () => {
    const containerId = INITIAL_FLEET[0].id;
    const result = backend.updateMemory(containerId, 500);

    expect(result.decision.action).toBe("oom_recovered");
    expect(result.container.status).toBe("oom_recovered");
    expect(result.container.memoryMb).toBe(24);
    expect(result.container.walJournalSizeBytes).toBe(0); // Checkpointed
  });

  it("should trigger WAL checkpoint on a specific container", () => {
    const containerId = INITIAL_FLEET[0].id;
    const { container, report } = backend.checkpointContainerWal(containerId);
    expect(report.success).toBe(true);
    expect(container.walJournalSizeBytes).toBe(0);
  });

  it("should trigger R2 snapshot backup for container", () => {
    const containerId = INITIAL_FLEET[0].id;
    const { container, snapshot, checkpointReport } = backend.backupContainerToR2(containerId);
    expect(checkpointReport.success).toBe(true);
    expect(snapshot.appId).toBe(container.appId);
    expect(snapshot.walCheckpointed).toBe(true);
  });

  it("should terminate container and release port", () => {
    const initialPortCount = backend.getStatusSummary().availablePorts.length;
    const c = backend.spawnContainer({ appId: "disposable", name: "disp" });
    expect(backend.getStatusSummary().availablePorts.length).toBe(initialPortCount - 1);

    const terminated = backend.terminateContainer(c.id);
    expect(terminated).toBe(true);
    expect(backend.getStatusSummary().availablePorts.length).toBe(initialPortCount);
  });
});
