
export interface DropSubmission {
  id?: string;
  name: string;
  tagline: string;
  description: string;
  creator: string;
  version: string;
  license: string;
  price: string;
  storage?: string;
  tags: string[];
  screenshots: string[];
  binaries: Record<string, string>;
}

export function validateDropSubmission(drop: Partial<DropSubmission>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!drop.name || typeof drop.name !== 'string' || drop.name.trim().length < 3) {
    errors.push('App name must be at least 3 characters.');
  } else if (drop.name.length > 120) {
    errors.push('App name must be at most 120 characters.');
  }

  if (!drop.version || typeof drop.version !== 'string' || !drop.version.match(/^v?\d+\.\d+\.\d+$/)) {
    errors.push('Version must follow valid semver (e.g. v1.0.0 or 2.4.0).');
  }

  if (typeof (drop as any).tagline === 'string' && (drop as any).tagline.length > 280) {
    errors.push('Tagline must be at most 280 characters.');
  }
  if (typeof (drop as any).description === 'string' && (drop as any).description.length > 8000) {
    errors.push('Description must be at most 8000 characters.');
  }

  if (drop.tags !== undefined && !Array.isArray(drop.tags)) {
    errors.push('Tags must be an array of strings.');
  } else if (Array.isArray(drop.tags) && (drop.tags.length > 20 || drop.tags.some(t => typeof t === 'string' && t.length > 40))) {
    errors.push('Provide at most 20 tags, each at most 40 characters.');
  }

  if (drop.screenshots !== undefined && !Array.isArray(drop.screenshots)) {
    errors.push('Screenshots must be an array of image URLs.');
  } else if (Array.isArray(drop.screenshots) && (drop.screenshots.length > 12 || drop.screenshots.some(s => typeof s === 'string' && s.length > 2048))) {
    errors.push('Provide at most 12 screenshots, each URL at most 2048 characters.');
  }

  if (drop.id !== undefined && drop.id !== null && typeof drop.id === 'string' && drop.id.trim().length > 0) {
    const trimmedId = drop.id.trim();
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(trimmedId)) {
      errors.push('Drop ID must be 2-64 characters using alphanumeric, dashes, or underscores.');
    } else if (RESERVED_APP_IDS.has(trimmedId.toLowerCase())) {
      errors.push(`Drop ID '${trimmedId}' is reserved and cannot be used.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export const RESERVED_APP_IDS = new Set([
  'www', 'apex', 'api', 'admin', 'app', 'auth', 'login', 'account', 'mail', 'static', 'assets',
  'cdn', 'router', 'gateway', 'rig-provider', 'ops', 'status', 'help', 'support', 'docs',
  'chat', 'git', 'gitsmith', 'hotwire', 'inbox', 'slopshop', 'rig', 'dyno', 'profile',
]);

export function parseAndValidatePrice(priceInput: any): { valid: boolean; priceStr: string; priceCents: number; error?: string } {
  if (priceInput === undefined || priceInput === null || priceInput === '') {
    return { valid: true, priceStr: '$15.00', priceCents: 1500 };
  }

  let num: number;
  if (typeof priceInput === 'number') {
    num = priceInput;
  } else if (typeof priceInput === 'string') {
    const clean = priceInput.replace(/[^0-9.]/g, '').trim();
    if (!clean) {
      return { valid: false, priceStr: '', priceCents: 0, error: 'Invalid price format.' };
    }
    num = parseFloat(clean);
  } else {
    return { valid: false, priceStr: '', priceCents: 0, error: 'Price must be a number or formatted string.' };
  }

  if (isNaN(num) || !isFinite(num) || num < 1 || num > 10000) {
    return { valid: false, priceStr: '', priceCents: 0, error: 'Registered-copy price must be between $1.00 and $10,000.00.' };
  }

  const priceCents = Math.round(num * 100);
  const priceStr = `$${num.toFixed(2)}`;
  return { valid: true, priceStr, priceCents };
}

export function calculateStreak(lastDropDate: Date, currentDate: Date, currentStreak: number): number {
  const diffHours = (currentDate.getTime() - lastDropDate.getTime()) / (1000 * 60 * 60);
  if (diffHours <= 24) {
    return currentStreak + 1;
  } else if (diffHours <= 48) {
    return currentStreak;
  } else {
    return 1;
  }
}

export function calculateNextUtcDrop(): { countdown: string; totalSeconds: number } {
  const now = new Date();
  const nextDrop = new Date();
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
