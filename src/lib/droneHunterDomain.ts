/**
 * Drone Hunter — Pure Domain Logic, Game Rules & State Machine
 * Local-First Arcade Engine with zero network dependencies.
 */

export const LOGICAL_WIDTH = 800;
export const LOGICAL_HEIGHT = 600;
export const MAX_DRONES_PASSED = 3;
export const DEFAULT_AMMO = 5;
export const DRONE_BASE_WIDTH = 260;
export const DRONE_BASE_HEIGHT = 208;
export const POINTS_PER_HIT = 100;
export const POINTS_LOST_PER_MISS = 50;
export const PERFECT_ROUND_BONUS = 500;

export const STORAGE_KEYS = {
  HIGH_SCORE: 'dronehunter_high_score',
  LEGACY_HIGH_SCORE: 'droneHunter_highScore',
  MUTED: 'dronehunter_is_muted',
  LEGACY_MUTED: 'droneHunter_isMuted',
  ONBOARDING_SEEN: 'dronehunter_onboarding_seen'
} as const;

export type GameState =
  | 'onboarding'
  | 'title'
  | 'roundIntro'
  | 'playing'
  | 'roundClear'
  | 'paused'
  | 'gameOver';

export interface DroneBounds {
  screenX: number;
  screenY: number;
  width: number;
  height: number;
  scale: number;
}

export function getDronesPerRound(round: number): number {
  const r = Math.max(1, Math.floor(round));
  return 10 + (r - 1) * 2;
}

export function getDroneSpeed(round: number, baseSpeed: number = 0.22): number {
  const r = Math.max(1, Math.floor(round));
  return baseSpeed + (r - 1) * 0.045;
}

export function getSpawnInterval(round: number): number {
  const r = Math.max(1, Math.floor(round));
  return Math.max(0.65, 1.6 - (r - 1) * 0.12);
}

export function getMultiSpawnProbability(round: number): number {
  const r = Math.max(1, Math.floor(round));
  return Math.min(0.45, (r - 1) * 0.08);
}

export function calculateDroneBounds(
  x: number,
  depth: number,
  _logicalWidth: number = LOGICAL_WIDTH,
  logicalHeight: number = LOGICAL_HEIGHT
): DroneBounds {
  const clampedDepth = Math.max(0, Math.min(1.2, depth));
  const scale = 0.2 + clampedDepth * 0.8;
  const width = DRONE_BASE_WIDTH * scale;
  const height = DRONE_BASE_HEIGHT * scale;
  const screenX = x - width / 2;
  const screenY = logicalHeight * clampedDepth - height;

  return {
    screenX,
    screenY,
    width,
    height,
    scale
  };
}

export function checkDroneHit(
  clickX: number,
  clickY: number,
  bounds: DroneBounds,
  padding: number = 20
): boolean {
  return (
    clickX >= bounds.screenX - padding &&
    clickX <= bounds.screenX + bounds.width + padding &&
    clickY >= bounds.screenY - padding &&
    clickY <= bounds.screenY + bounds.height + padding
  );
}

export interface MinimalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function safeGetStorage(storage: MinimalStorage | undefined | null, key: string, fallback: string = ''): string {
  if (!storage) return fallback;
  try {
    const val = storage.getItem(key);
    return val !== null ? val : fallback;
  } catch {
    return fallback;
  }
}

export function safeSetStorage(storage: MinimalStorage | undefined | null, key: string, value: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function loadStoredHighScore(storage?: MinimalStorage | null): number {
  const modern = safeGetStorage(storage, STORAGE_KEYS.HIGH_SCORE);
  if (modern) {
    const num = parseInt(modern, 10);
    if (!Number.isNaN(num) && num >= 0) return num;
  }
  const legacy = safeGetStorage(storage, STORAGE_KEYS.LEGACY_HIGH_SCORE);
  if (legacy) {
    const num = parseInt(legacy, 10);
    if (!Number.isNaN(num) && num >= 0) return num;
  }
  return 0;
}

export function saveStoredHighScore(score: number, storage?: MinimalStorage | null): boolean {
  const cleanScore = Math.max(0, Math.floor(score));
  const s1 = safeSetStorage(storage, STORAGE_KEYS.HIGH_SCORE, cleanScore.toString());
  const s2 = safeSetStorage(storage, STORAGE_KEYS.LEGACY_HIGH_SCORE, cleanScore.toString());
  return s1 || s2;
}

export function loadStoredMutePreference(storage?: MinimalStorage | null): boolean {
  const modern = safeGetStorage(storage, STORAGE_KEYS.MUTED);
  if (modern !== '') return modern === 'true';
  const legacy = safeGetStorage(storage, STORAGE_KEYS.LEGACY_MUTED);
  if (legacy !== '') return legacy === 'true';
  return false;
}

export function saveStoredMutePreference(isMuted: boolean, storage?: MinimalStorage | null): boolean {
  const val = isMuted ? 'true' : 'false';
  const s1 = safeSetStorage(storage, STORAGE_KEYS.MUTED, val);
  const s2 = safeSetStorage(storage, STORAGE_KEYS.LEGACY_MUTED, val);
  return s1 || s2;
}

export function loadStoredOnboardingSeen(storage?: MinimalStorage | null): boolean {
  const val = safeGetStorage(storage, STORAGE_KEYS.ONBOARDING_SEEN);
  return val === 'true';
}

export function saveStoredOnboardingSeen(storage?: MinimalStorage | null): boolean {
  return safeSetStorage(storage, STORAGE_KEYS.ONBOARDING_SEEN, 'true');
}

export interface DroneInstanceOptions {
  readonly id: string;
  readonly x: number;
  readonly speed: number;
  readonly depth?: number;
}

export class DroneInstance {
  public readonly id: string;
  public x: number;
  public depth: number;
  public speed: number;
  public destroyed: boolean = false;

  constructor(opts: DroneInstanceOptions) {
    this.id = opts.id;
    this.x = opts.x;
    this.depth = opts.depth ?? 0;
    this.speed = opts.speed;
  }

  public update(dtSeconds: number): void {
    if (this.destroyed) return;
    this.depth += this.speed * dtSeconds;
  }

  public getBounds(logicalWidth: number = LOGICAL_WIDTH, logicalHeight: number = LOGICAL_HEIGHT): DroneBounds {
    return calculateDroneBounds(this.x, this.depth, logicalWidth, logicalHeight);
  }

  public isOffScreen(): boolean {
    return this.depth >= 1.0;
  }
}

export interface ShotResult {
  readonly fired: boolean;
  readonly ammoRemaining: number;
  readonly hitDroneIds: string[];
  readonly scoreDelta: number;
  readonly empty: boolean;
}

export interface EscapedDroneResult {
  readonly droneId: string;
  readonly dronesPassedTotal: number;
  readonly isGameOver: boolean;
  readonly scoreDelta: number;
}

export interface RoundAdvanceResult {
  readonly nextRound: number;
  readonly perfectBonusAwarded: boolean;
  readonly bonusPoints: number;
  readonly dronesInNextRound: number;
}

export class DroneHunterEngine {
  public state: GameState = 'onboarding';
  public score: number = 0;
  public highScore: number = 0;
  public round: number = 1;
  public ammo: number = DEFAULT_AMMO;
  public dronesPassedTotal: number = 0;
  public dronesDestroyedTotal: number = 0;
  public dronesDestroyedThisRound: number = 0;
  public dronesSpawnedThisRound: number = 0;
  public dronesPassedThisRound: number = 0;
  public isMuted: boolean = false;
  public isPaused: boolean = false;
  public reducedMotion: boolean = false;

  public drones: DroneInstance[] = [];
  public storage?: MinimalStorage | null;

  private nextDroneId: number = 1;

  constructor(options?: { storage?: MinimalStorage | null; skipOnboarding?: boolean; reducedMotion?: boolean }) {
    this.storage = options?.storage;
    this.reducedMotion = !!options?.reducedMotion;
    this.highScore = loadStoredHighScore(this.storage);
    this.isMuted = loadStoredMutePreference(this.storage);

    const hasSeenOnboarding = loadStoredOnboardingSeen(this.storage);
    if (options?.skipOnboarding || hasSeenOnboarding) {
      this.state = 'title';
    } else {
      this.state = 'onboarding';
    }
  }

  public completeOnboarding(): void {
    saveStoredOnboardingSeen(this.storage);
    this.state = 'title';
  }

  public startNewGame(): void {
    this.score = 0;
    this.round = 1;
    this.ammo = DEFAULT_AMMO;
    this.dronesPassedTotal = 0;
    this.dronesDestroyedTotal = 0;
    this.dronesDestroyedThisRound = 0;
    this.dronesSpawnedThisRound = 0;
    this.dronesPassedThisRound = 0;
    this.drones = [];
    this.isPaused = false;
    this.state = 'roundIntro';
  }

  public startRound(): void {
    if (this.state !== 'roundIntro') return;
    this.state = 'playing';
  }

  public spawnDrone(explicitX?: number): DroneInstance | null {
    const maxDrones = getDronesPerRound(this.round);
    if (this.dronesSpawnedThisRound >= maxDrones) {
      return null;
    }

    const minX = 120;
    const maxX = LOGICAL_WIDTH - 120;
    const x = explicitX !== undefined ? explicitX : minX + Math.random() * (maxX - minX);
    const speed = getDroneSpeed(this.round);
    const drone = new DroneInstance({
      id: `drone-${this.nextDroneId++}`,
      x,
      speed
    });

    this.drones.push(drone);
    this.dronesSpawnedThisRound++;
    return drone;
  }

  public shoot(clickX: number, clickY: number): ShotResult {
    if (this.state !== 'playing' || this.isPaused) {
      return {
        fired: false,
        ammoRemaining: this.ammo,
        hitDroneIds: [],
        scoreDelta: 0,
        empty: false
      };
    }

    if (this.ammo <= 0) {
      return {
        fired: false,
        ammoRemaining: 0,
        hitDroneIds: [],
        scoreDelta: 0,
        empty: true
      };
    }

    this.ammo--;
    const hitDroneIds: string[] = [];

    // Check hit against active drones, prioritizing closer drones (higher depth)
    const sortedDrones = [...this.drones]
      .filter(d => !d.destroyed)
      .sort((a, b) => b.depth - a.depth);

    for (const drone of sortedDrones) {
      const bounds = drone.getBounds();
      if (checkDroneHit(clickX, clickY, bounds)) {
        drone.destroyed = true;
        hitDroneIds.push(drone.id);
        this.dronesDestroyedTotal++;
        this.dronesDestroyedThisRound++;
        this.score += POINTS_PER_HIT;
        // Duck Hunt shotgun pellet spread hits 1 drone per primary blast
        break;
      }
    }

    if (this.score > this.highScore) {
      this.highScore = this.score;
      saveStoredHighScore(this.highScore, this.storage);
    }

    return {
      fired: true,
      ammoRemaining: this.ammo,
      hitDroneIds,
      scoreDelta: hitDroneIds.length * POINTS_PER_HIT,
      empty: false
    };
  }

  public reload(): boolean {
    if (this.state !== 'playing' || this.isPaused) return false;
    if (this.ammo === DEFAULT_AMMO) return false;
    this.ammo = DEFAULT_AMMO;
    return true;
  }

  public togglePause(): boolean {
    if (this.state !== 'playing' && this.state !== 'paused') return false;
    this.isPaused = !this.isPaused;
    this.state = this.isPaused ? 'paused' : 'playing';
    return true;
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    saveStoredMutePreference(this.isMuted, this.storage);
    return this.isMuted;
  }

  public handleDroneEscaped(droneId: string): EscapedDroneResult {
    const droneIndex = this.drones.findIndex(d => d.id === droneId);
    if (droneIndex !== -1) {
      this.drones.splice(droneIndex, 1);
    }

    this.dronesPassedTotal++;
    this.dronesPassedThisRound++;
    this.score = Math.max(0, this.score - POINTS_LOST_PER_MISS);

    const isGameOver = this.dronesPassedTotal >= MAX_DRONES_PASSED;
    if (isGameOver) {
      this.state = 'gameOver';
      if (this.score > this.highScore) {
        this.highScore = this.score;
        saveStoredHighScore(this.highScore, this.storage);
      }
    }

    return {
      droneId,
      dronesPassedTotal: this.dronesPassedTotal,
      isGameOver,
      scoreDelta: -POINTS_LOST_PER_MISS
    };
  }

  public isRoundFinished(): boolean {
    const totalForRound = getDronesPerRound(this.round);
    const allSpawned = this.dronesSpawnedThisRound >= totalForRound;
    const activeRemaining = this.drones.filter(d => !d.destroyed).length;
    return allSpawned && activeRemaining === 0 && this.state === 'playing';
  }

  public advanceRound(): RoundAdvanceResult {
    const totalForRound = getDronesPerRound(this.round);
    const perfectRound = this.dronesPassedThisRound === 0 && this.dronesDestroyedThisRound === totalForRound;
    const bonus = perfectRound ? PERFECT_ROUND_BONUS : 0;

    if (bonus > 0) {
      this.score += bonus;
      if (this.score > this.highScore) {
        this.highScore = this.score;
        saveStoredHighScore(this.highScore, this.storage);
      }
    }

    this.round++;
    this.dronesSpawnedThisRound = 0;
    this.dronesDestroyedThisRound = 0;
    this.dronesPassedThisRound = 0;
    this.drones = [];
    this.ammo = DEFAULT_AMMO;
    this.state = 'roundIntro';

    return {
      nextRound: this.round,
      perfectBonusAwarded: perfectRound,
      bonusPoints: bonus,
      dronesInNextRound: getDronesPerRound(this.round)
    };
  }

  public updateDrones(dtSeconds: number): { escapedIds: string[] } {
    if (this.state !== 'playing' || this.isPaused) return { escapedIds: [] };

    const escapedIds: string[] = [];
    for (let i = this.drones.length - 1; i >= 0; i--) {
      const drone = this.drones[i];
      if (drone.destroyed) {
        this.drones.splice(i, 1);
        continue;
      }

      drone.update(dtSeconds);
      if (drone.isOffScreen()) {
        escapedIds.push(drone.id);
        this.handleDroneEscaped(drone.id);
      }
    }

    return { escapedIds };
  }
}
