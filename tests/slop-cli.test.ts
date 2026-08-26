import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import {
  handleFork,
  handlePush,
  handleMod,
  handleDyno,
  handleTest,
  handleStatus,
  handleList,
  handleShelf,
  handleLogin,
  printHelp,
  runSlopCli,
  SHELF_TITLES
} from "../bin/slop.ts";

describe("SLOP CLI Core Command Handlers", () => {
  describe("slop fork <slug>", () => {
    it("should fork default slug (nate/wallart) into isolated worktree with SQLite volume", () => {
      const res = handleFork();
      expect(res.success).toBe(true);
      expect(res.command).toBe("fork");
      expect(res.data.slug).toBe("nate/wallart");
      expect(res.data.worktreePath).toContain("/tmp/slop-wallart-");
      expect(res.data.sqlitePath).toBe("/data/wallart.sqlite");
      expect(res.data.walMode).toBe(true);
      expect(res.data.memoryCapMb).toBe(256);
      expect(res.data.port).toBeGreaterThanOrEqual(3001);
      expect(res.data.port).toBeLessThanOrEqual(3010);
    });

    it("should fork custom app slug into isolated worktree", () => {
      const res = handleFork("sam/retro-calc");
      expect(res.success).toBe(true);
      expect(res.data.slug).toBe("sam/retro-calc");
      expect(res.data.appId).toBe("retro-calc");
      expect(res.data.sqlitePath).toBe("/data/retro-calc.sqlite");
    });
  });

  describe("slop push", () => {
    it("should run test proofs, verify single-file SQLite WAL, and push CAS ref", () => {
      const res = handlePush();
      expect(res.success).toBe(true);
      expect(res.command).toBe("push");
      expect(res.data.testsPassed).toBe(true);
      expect(res.data.walVerified).toBe(true);
      expect(res.data.casRef).toBe("refs/heads/main");
      expect(res.data.sha).toBe("5c030af");
      expect(res.data.portalUrl).toContain("rig.nates.software");
    });
  });

  describe("slop mod <feature>", () => {
    it("should splice known preset feature (feat_triptych)", () => {
      const res = handleMod("feat_triptych");
      expect(res.success).toBe(true);
      expect(res.command).toBe("mod");
      expect(res.data.feature.id).toBe("feat_triptych");
      expect(res.data.astNodesAdded).toBe(14);
      expect(res.data.tablesCreated).toContain("triptych_splits");
      expect(res.data.cleanlinessScore).toBeGreaterThanOrEqual(99);
      expect(res.data.walMode).toBe(true);
    });

    it("should splice feature using short alias (ocr -> feat_ocr)", () => {
      const res = handleMod("ocr");
      expect(res.success).toBe(true);
      expect(res.data.feature.id).toBe("feat_ocr");
      expect(res.data.tablesCreated).toContain("receipt_scans");
    });

    it("should splice polar feature (polar -> feat_polar)", () => {
      const res = handleMod("polar");
      expect(res.success).toBe(true);
      expect(res.data.feature.id).toBe("feat_polar");
      expect(res.data.tablesCreated).toContain("polar_curves");
    });

    it("should dynamically create and weld valid custom feature mod", () => {
      const res = handleMod("darkmode");
      expect(res.success).toBe(true);
      expect(res.data.feature.id).toBe("feat_darkmode");
      expect(res.data.walMode).toBe(true);
    });

    it("should fail gracefully when feature identifier is missing", () => {
      const res = handleMod("");
      expect(res.success).toBe(false);
      expect(res.message).toContain("Feature identifier required");
    });
  });

  describe("slop dyno [--bench]", () => {
    it("should measure local AI hardware velocity", () => {
      const res = handleDyno(false);
      expect(res.success).toBe(true);
      expect(res.command).toBe("dyno");
      expect(res.data.chip).toContain("Apple M4 Max");
      expect(res.data.tokensPerSec).toBeGreaterThan(150);
      expect(res.data.cacheHitRate).toBeGreaterThan(0.9);
      expect(res.data.grade).toContain("Grade A+");
      expect(res.data.isBench).toBe(false);
    });

    it("should run extended benchmark passes when benchFlag is true", () => {
      const res = handleDyno(true);
      expect(res.success).toBe(true);
      expect(res.data.isBench).toBe(true);
      expect(res.data.tokensPerSec).toBeGreaterThan(160);
    });
  });

  describe("slop test", () => {
    it("should run and pass all sovereign verification proofs", () => {
      const res = handleTest();
      expect(res.success).toBe(true);
      expect(res.command).toBe("test");
      expect(res.data.totalProofs).toBe(5);
      expect(res.data.passedProofs).toBe(5);
      expect(res.data.failedProofs).toBe(0);
      expect(res.data.allGreen).toBe(true);
    });
  });

  describe("slop status", () => {
    it("should inspect micro-containers, memory limits, and active ports", () => {
      const res = handleStatus();
      expect(res.success).toBe(true);
      expect(res.command).toBe("status");
      expect(res.data.containers.length).toBeGreaterThanOrEqual(3);
      expect(res.data.activePorts).toEqual([3001, 3002, 3003]);
      expect(res.data.fleetMemory.totalCapMb).toBeGreaterThan(0);
    });
  });

  describe("slop list", () => {
    it("should query 12:01 AM daily drops board", () => {
      const res = handleList();
      expect(res.success).toBe(true);
      expect(res.command).toBe("list");
      expect(res.data.batch).toBe(84);
      expect(res.data.drops.length).toBeGreaterThanOrEqual(3);
      expect(res.data.drops[0].storage).toBe("SQLite WAL");
    });
  });

  describe("slop shelf", () => {
    it("should display owned software titles and cryptographic license keys", () => {
      const res = handleShelf();
      expect(res.success).toBe(true);
      expect(res.command).toBe("shelf");
      expect(res.data.titles.length).toBe(SHELF_TITLES.length);
      expect(res.data.titles[0].licenseKey).toMatch(/^SOV-[A-Z0-9-]+$/);
    });
  });

  describe("slop login", () => {
    it("should authenticate maker handle and SSH public key", () => {
      const res = handleLogin();
      expect(res.success).toBe(true);
      expect(res.command).toBe("login");
      expect(res.data.handle).toBe("@nate");
      expect(res.data.displayName).toBe("Nate McGuire");
      expect(res.data.sshKey).toMatch(/^ssh-ed25519 /);
      expect(res.data.title).toContain("Verified Maker");
      expect(res.data.isVerified).toBe(true);
    });
  });

  describe("slop help", () => {
    it("should output help manual and command index", () => {
      const res = printHelp();
      expect(res.success).toBe(true);
      expect(res.command).toBe("help");
      expect(res.message).toContain("Official SLOP CLI");
      expect(res.message).toContain("slop fork <slug>");
      expect(res.message).toContain("slop push");
      expect(res.message).toContain("slop mod <feature>");
      expect(res.message).toContain("slop dyno");
      expect(res.message).toContain("slop test");
      expect(res.message).toContain("slop status");
      expect(res.message).toContain("slop list");
      expect(res.message).toContain("slop shelf");
      expect(res.message).toContain("slop login");
    });
  });

  describe("runSlopCli router", () => {
    it("should route all commands cleanly", () => {
      expect(runSlopCli(["fork", "nate/wallart"]).success).toBe(true);
      expect(runSlopCli(["push"]).success).toBe(true);
      expect(runSlopCli(["mod", "feat_triptych"]).success).toBe(true);
      expect(runSlopCli(["dyno", "--bench"]).success).toBe(true);
      expect(runSlopCli(["test"]).success).toBe(true);
      expect(runSlopCli(["status"]).success).toBe(true);
      expect(runSlopCli(["list"]).success).toBe(true);
      expect(runSlopCli(["shelf"]).success).toBe(true);
      expect(runSlopCli(["login"]).success).toBe(true);
      expect(runSlopCli(["help"]).success).toBe(true);
    });

    it("should handle unknown command with error", () => {
      const res = runSlopCli(["invalid-unknown-cmd"]);
      expect(res.success).toBe(false);
      expect(res.message).toContain("Unknown command");
    });
  });
});

describe("Executable ./bin/slop Shell Execution", () => {
  const repoRoot = path.resolve(__dirname, "..");

  it("should execute ./bin/slop help successfully", () => {
    const stdout = execSync("./bin/slop help", { cwd: repoRoot, encoding: "utf8" });
    expect(stdout).toContain("Official SLOP CLI");
    expect(stdout).toContain("slop fork");
    expect(stdout).toContain("slop push");
    expect(stdout).toContain("slop mod");
  });

  it("should execute ./bin/slop dyno --bench successfully", () => {
    const stdout = execSync("./bin/slop dyno --bench", { cwd: repoRoot, encoding: "utf8" });
    expect(stdout).toContain("[DYNO]");
    expect(stdout).toContain("Apple M4 Max");
    expect(stdout).toContain("Grade A+");
  });

  it("should execute ./bin/slop test successfully", () => {
    const stdout = execSync("./bin/slop test", { cwd: repoRoot, encoding: "utf8" });
    expect(stdout).toContain("[TEST]");
    expect(stdout).toContain("100% green");
  });

  it("should execute ./bin/slop status successfully", () => {
    const stdout = execSync("./bin/slop status", { cwd: repoRoot, encoding: "utf8" });
    expect(stdout).toContain("[RIG.EXE]");
    expect(stdout).toContain("Port 3001");
    expect(stdout).toContain("Port 3002");
    expect(stdout).toContain("Port 3003");
  });

  it("should execute ./bin/slop shelf successfully", () => {
    const stdout = execSync("./bin/slop shelf", { cwd: repoRoot, encoding: "utf8" });
    expect(stdout).toContain("[SHELF]");
    expect(stdout).toContain("WallArt Canvas Pro");
    expect(stdout).toContain("SOV-WALLART-9812-77F2");
  });

  it("should execute ./bin/slop login successfully", () => {
    const stdout = execSync("./bin/slop login", { cwd: repoRoot, encoding: "utf8" });
    expect(stdout).toContain("[AUTH]");
    expect(stdout).toContain("Nate McGuire");
    expect(stdout).toContain("ssh-ed25519");
  });
});
