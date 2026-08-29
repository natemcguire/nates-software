import { describe, it, expect, beforeEach } from 'vitest';
import {
  DroneHunterEngine,
  DEFAULT_AMMO,
  POINTS_PER_HIT,
  PERFECT_ROUND_BONUS,
  STORAGE_KEYS,
  getDronesPerRound,
  getDroneSpeed,
  getSpawnInterval,
  getMultiSpawnProbability,
  calculateDroneBounds,
  checkDroneHit,
  safeGetStorage,
  safeSetStorage,
  loadStoredHighScore,
  saveStoredHighScore,
  loadStoredMutePreference,
  saveStoredMutePreference,
  loadStoredOnboardingSeen,
  saveStoredOnboardingSeen
} from '../src/lib/droneHunterDomain';

class MemoryStorage {
  private store = new Map<string, string>();
  public shouldThrow = false;

  getItem(key: string): string | null {
    if (this.shouldThrow) throw new Error('DOMException: The document is sandboxed');
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    if (this.shouldThrow) throw new Error('DOMException: QuotaExceededError');
    this.store.set(key, value);
  }

  clear(): void {
    this.store.clear();
  }
}

describe('Drone Hunter — Arcade Game Domain & Engine Verification', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  describe('1. Storage Safety & Sandbox Failure Tolerance', () => {
    it('should gracefully handle normal storage get and set', () => {
      expect(safeSetStorage(storage, 'test_key', 'hello')).toBe(true);
      expect(safeGetStorage(storage, 'test_key', 'default')).toBe('hello');
    });

    it('should return fallback without throwing when storage is null or undefined', () => {
      expect(safeGetStorage(null, 'key', 'fallback_val')).toBe('fallback_val');
      expect(safeSetStorage(undefined, 'key', 'val')).toBe(false);
    });

    it('should survive sandboxed iframe / SecurityError without crashing', () => {
      storage.shouldThrow = true;
      expect(() => safeGetStorage(storage, 'key', 'safe')).not.toThrow();
      expect(safeGetStorage(storage, 'key', 'safe')).toBe('safe');
      expect(() => safeSetStorage(storage, 'key', 'val')).not.toThrow();
      expect(safeSetStorage(storage, 'key', 'val')).toBe(false);
    });

    it('should load and save high scores with legacy key fallback and NaN sanitization', () => {
      expect(loadStoredHighScore(storage)).toBe(0);

      // Save modern high score
      saveStoredHighScore(1200, storage);
      expect(loadStoredHighScore(storage)).toBe(1200);

      // Verify legacy key compatibility
      storage.clear();
      storage.setItem(STORAGE_KEYS.LEGACY_HIGH_SCORE, '850');
      expect(loadStoredHighScore(storage)).toBe(850);

      // Corrupted data
      storage.setItem(STORAGE_KEYS.HIGH_SCORE, 'corrupted_score');
      storage.setItem(STORAGE_KEYS.LEGACY_HIGH_SCORE, '-50');
      expect(loadStoredHighScore(storage)).toBe(0);
    });

    it('should load and save mute preferences and onboarding flags', () => {
      expect(loadStoredMutePreference(storage)).toBe(false);
      saveStoredMutePreference(true, storage);
      expect(loadStoredMutePreference(storage)).toBe(true);

      expect(loadStoredOnboardingSeen(storage)).toBe(false);
      saveStoredOnboardingSeen(storage);
      expect(loadStoredOnboardingSeen(storage)).toBe(true);
    });
  });

  describe('2. Deterministic Round & Progression Formulas', () => {
    it('should scale drone counts per round predictably (10, 12, 14, 16...)', () => {
      expect(getDronesPerRound(1)).toBe(10);
      expect(getDronesPerRound(2)).toBe(12);
      expect(getDronesPerRound(3)).toBe(14);
      expect(getDronesPerRound(5)).toBe(18);
      expect(getDronesPerRound(0)).toBe(10); // clamped minimum
    });

    it('should scale drone speed with round progression', () => {
      const speedR1 = getDroneSpeed(1);
      const speedR2 = getDroneSpeed(2);
      const speedR5 = getDroneSpeed(5);

      expect(speedR1).toBeGreaterThan(0);
      expect(speedR2).toBeGreaterThan(speedR1);
      expect(speedR5).toBeGreaterThan(speedR2);
    });

    it('should adjust spawn intervals within safe clamping bounds', () => {
      const int1 = getSpawnInterval(1);
      const int5 = getSpawnInterval(5);
      const int50 = getSpawnInterval(50);

      expect(int1).toBe(1.6);
      expect(int5).toBeLessThan(int1);
      expect(int50).toBe(0.65); // clamped minimum
    });

    it('should scale multi-spawn probability up to capped limit', () => {
      expect(getMultiSpawnProbability(1)).toBe(0);
      expect(getMultiSpawnProbability(3)).toBeCloseTo(0.16);
      expect(getMultiSpawnProbability(20)).toBe(0.45); // clamped maximum
    });
  });

  describe('3. Perspective Hit Detection & Coordinate Geometry', () => {
    it('should scale drone bounds accurately with depth', () => {
      const horizonBounds = calculateDroneBounds(400, 0);
      expect(horizonBounds.scale).toBe(0.2);
      expect(horizonBounds.width).toBe(52); // 260 * 0.2
      expect(horizonBounds.screenX).toBe(400 - 52 / 2);

      const foregroundBounds = calculateDroneBounds(400, 1.0);
      expect(foregroundBounds.scale).toBe(1.0);
      expect(foregroundBounds.width).toBe(260);
      expect(foregroundBounds.screenX).toBe(400 - 260 / 2);
      expect(foregroundBounds.screenY).toBe(600 - 208);
    });

    it('should register hits within hitbox + padding and reject misses', () => {
      const bounds = calculateDroneBounds(400, 0.5); // scale = 0.6, width = 156, height = 124.8
      // Center of drone
      const centerX = bounds.screenX + bounds.width / 2;
      const centerY = bounds.screenY + bounds.height / 2;

      // Direct center hit
      expect(checkDroneHit(centerX, centerY, bounds, 20)).toBe(true);

      // Hit near edge within 20px padding
      expect(checkDroneHit(bounds.screenX - 15, centerY, bounds, 20)).toBe(true);
      expect(checkDroneHit(bounds.screenX + bounds.width + 15, centerY, bounds, 20)).toBe(true);

      // Miss far outside
      expect(checkDroneHit(bounds.screenX - 50, centerY, bounds, 20)).toBe(false);
      expect(checkDroneHit(centerX, bounds.screenY - 80, bounds, 20)).toBe(false);
    });
  });

  describe('4. Complete Game Loop, Shooting, Reloading & State Machine', () => {
    it('should start in onboarding on first run and title screen on subsequent runs', () => {
      const engine1 = new DroneHunterEngine({ storage });
      expect(engine1.state).toBe('onboarding');

      engine1.completeOnboarding();
      expect(engine1.state).toBe('title');

      const engine2 = new DroneHunterEngine({ storage });
      expect(engine2.state).toBe('title');
    });

    it('should initialize a fresh game session and progress through states', () => {
      const engine = new DroneHunterEngine({ storage, skipOnboarding: true });
      expect(engine.state).toBe('title');

      engine.startNewGame();
      expect(engine.state).toBe('roundIntro');
      expect(engine.round).toBe(1);
      expect(engine.ammo).toBe(DEFAULT_AMMO);
      expect(engine.score).toBe(0);
      expect(engine.dronesPassedTotal).toBe(0);

      engine.startRound();
      expect(engine.state).toBe('playing');
    });

    it('should handle shooting mechanics, ammunition deduction, and empty dry-fire', () => {
      const engine = new DroneHunterEngine({ storage, skipOnboarding: true });
      engine.startNewGame();
      engine.startRound();

      // Spawn 1 drone at x = 400
      const drone = engine.spawnDrone(400);
      expect(drone).not.toBeNull();
      drone!.depth = 0.5;

      const bounds = drone!.getBounds();
      const clickX = bounds.screenX + bounds.width / 2;
      const clickY = bounds.screenY + bounds.height / 2;

      // Successful hit
      const hitRes = engine.shoot(clickX, clickY);
      expect(hitRes.fired).toBe(true);
      expect(hitRes.ammoRemaining).toBe(4);
      expect(hitRes.hitDroneIds).toEqual([drone!.id]);
      expect(hitRes.scoreDelta).toBe(POINTS_PER_HIT);
      expect(engine.score).toBe(POINTS_PER_HIT);
      expect(engine.highScore).toBe(POINTS_PER_HIT);
      expect(drone!.destroyed).toBe(true);

      // Spend remaining ammo
      engine.shoot(10, 10); // ammo: 3
      engine.shoot(10, 10); // ammo: 2
      engine.shoot(10, 10); // ammo: 1
      engine.shoot(10, 10); // ammo: 0
      expect(engine.ammo).toBe(0);

      // Dry fire when empty
      const emptyRes = engine.shoot(clickX, clickY);
      expect(emptyRes.fired).toBe(false);
      expect(emptyRes.empty).toBe(true);
      expect(emptyRes.ammoRemaining).toBe(0);

      // Reload
      expect(engine.reload()).toBe(true);
      expect(engine.ammo).toBe(DEFAULT_AMMO);

      // Reloading when full returns false
      expect(engine.reload()).toBe(false);
    });

    it('should handle pause and unpause cleanly without losing state', () => {
      const engine = new DroneHunterEngine({ storage, skipOnboarding: true });
      engine.startNewGame();
      engine.startRound();

      expect(engine.togglePause()).toBe(true);
      expect(engine.state).toBe('paused');
      expect(engine.isPaused).toBe(true);

      // Shooting during pause should be blocked
      const shootRes = engine.shoot(400, 300);
      expect(shootRes.fired).toBe(false);

      // Unpause
      expect(engine.togglePause()).toBe(true);
      expect(engine.state).toBe('playing');
      expect(engine.isPaused).toBe(false);
    });

    it('should handle delta-time drone updates and off-screen escape penalties', () => {
      const engine = new DroneHunterEngine({ storage, skipOnboarding: true });
      engine.startNewGame();
      engine.startRound();
      engine.score = 200;

      const drone = engine.spawnDrone(400)!;
      drone.depth = 0.95;
      drone.speed = 0.5;

      // Update by 0.2 seconds -> depth reaches 1.05 (off-screen)
      const updateRes = engine.updateDrones(0.2);
      expect(updateRes.escapedIds).toContain(drone.id);
      expect(engine.dronesPassedTotal).toBe(1);
      expect(engine.score).toBe(150); // 200 - 50 points
    });

    it('should trigger Game Over deterministically after 3 escaped drones', () => {
      const engine = new DroneHunterEngine({ storage, skipOnboarding: true });
      engine.startNewGame();
      engine.startRound();

      const d1 = engine.spawnDrone(200)!;
      const d2 = engine.spawnDrone(300)!;
      const d3 = engine.spawnDrone(400)!;

      engine.handleDroneEscaped(d1.id);
      expect(engine.dronesPassedTotal).toBe(1);
      expect(engine.state).toBe('playing');

      engine.handleDroneEscaped(d2.id);
      expect(engine.dronesPassedTotal).toBe(2);
      expect(engine.state).toBe('playing');

      const escape3 = engine.handleDroneEscaped(d3.id);
      expect(escape3.isGameOver).toBe(true);
      expect(engine.dronesPassedTotal).toBe(3);
      expect(engine.state).toBe('gameOver');

      // Shooting should be rejected when game over
      const shootAfterGameOver = engine.shoot(400, 300);
      expect(shootAfterGameOver.fired).toBe(false);
    });

    it('should detect round completion and advance round with perfect bonus when applicable', () => {
      const engine = new DroneHunterEngine({ storage, skipOnboarding: true });
      engine.startNewGame();
      engine.startRound();

      const dronesInR1 = getDronesPerRound(1); // 10
      for (let i = 0; i < dronesInR1; i++) {
        const d = engine.spawnDrone(300 + i * 20)!;
        d.depth = 0.5;
        const b = d.getBounds();
        engine.shoot(b.screenX + b.width / 2, b.screenY + b.height / 2);
        engine.reload();
      }

      expect(engine.isRoundFinished()).toBe(true);

      const advanceRes = engine.advanceRound();
      expect(advanceRes.nextRound).toBe(2);
      expect(advanceRes.perfectBonusAwarded).toBe(true);
      expect(advanceRes.bonusPoints).toBe(PERFECT_ROUND_BONUS);
      expect(engine.score).toBe(10 * POINTS_PER_HIT + PERFECT_ROUND_BONUS);
      expect(engine.state).toBe('roundIntro');
    });
  });
});
