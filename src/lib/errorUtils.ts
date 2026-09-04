export function humanizeCatalogError(err: unknown): string {
  const msg = typeof err === 'string' ? err : (err as any)?.message || '';
  if (!msg) {
    return "Couldn't reach the live library. Retry, or you may be offline.";
  }
  if (
    msg.includes('Unexpected token') ||
    msg.includes('is not valid JSON') ||
    msg.includes('<!DOCTYPE') ||
    msg.includes('<html') ||
    msg.includes('SyntaxError')
  ) {
    return "Couldn't reach the live library — the index server returned a webpage instead of data. Retry, or you may be offline.";
  }
  if (
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('Load failed')
  ) {
    return "Couldn't reach the live library — network connection failed. Retry, or you may be offline.";
  }
  if (msg.includes('404') || msg.includes('not found')) {
    return "The live library index was not found on the server. Retry shortly.";
  }
  return msg;
}

export function humanizeGenericError(err: unknown, fallback: string): string {
  const msg = typeof err === 'string' ? err : (err as any)?.message || '';
  if (!msg) {
    return fallback;
  }
  if (
    msg.includes('Unexpected token') ||
    msg.includes('is not valid JSON') ||
    msg.includes('<!DOCTYPE') ||
    msg.includes('<html') ||
    msg.includes('SyntaxError')
  ) {
    return `${fallback} — the server returned an invalid response.`;
  }
  if (
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('Load failed')
  ) {
    return `${fallback} — network connection failed.`;
  }
  return msg;
}
