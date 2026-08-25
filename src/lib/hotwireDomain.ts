// Production Domain Rules & Invariants for HOTWIRE

export interface DropSubmission {
  id?: string;
  name: string;
  tagline: string;
  description: string;
  creator: string;
  version: string;
  license: string;
  price: string;
  storage: string;
  tags: string[];
  screenshots: string[];
  binaries: Record<string, string>;
}

export function validateDropSubmission(drop: Partial<DropSubmission>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!drop.name || drop.name.trim().length < 3) {
    errors.push('App name must be at least 3 characters.');
  }

  if (!drop.version || !drop.version.match(/^v?\d+\.\d+\.\d+$/)) {
    errors.push('Version must follow valid semver (e.g. v1.0.0 or 2.4.0).');
  }

  if (!drop.storage || !drop.storage.includes('.sqlite')) {
    errors.push('App must declare a sovereign single-file SQLite database volume (/data/*.sqlite).');
  }

  if (drop.tags !== undefined && !Array.isArray(drop.tags)) {
    errors.push('Tags must be an array of strings.');
  }

  if (drop.screenshots !== undefined && !Array.isArray(drop.screenshots)) {
    errors.push('Screenshots must be an array of image URLs.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function calculateStreak(lastDropDate: Date, currentDate: Date, currentStreak: number): number {
  const diffHours = (currentDate.getTime() - lastDropDate.getTime()) / (1000 * 60 * 60);
  if (diffHours <= 24) {
    return currentStreak + 1;
  } else if (diffHours <= 48) {
    return currentStreak; // Grace window within 48h
  } else {
    return 1; // Streak reset
  }
}

export function calculateNextUtcDrop(): { countdown: string; totalSeconds: number } {
  const now = new Date();
  const nextDrop = new Date();
  // 12:01 AM UTC next day
  nextDrop.setUTCHours(24, 1, 0, 0);
  const diff = Math.max(0, nextDrop.getTime() - now.getTime());

  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const mins = Math.floor((diff / 1000 / 60) % 60);
  const secs = Math.floor((diff / 1000) % 60);

  return {
    countdown: `${hours.toString().padStart(2, '0')}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`,
    totalSeconds: Math.floor(diff / 1000)
  };
}
