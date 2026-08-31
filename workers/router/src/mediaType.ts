export function getMediaType(filePath: string): string {
  const dotIndex = filePath.lastIndexOf('.');
  const ext = dotIndex !== -1 ? filePath.slice(dotIndex).toLowerCase() : '';
  switch (ext) {
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.ico':
      return 'image/x-icon';
    case '.wasm':
      return 'application/wasm';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.map':
      return 'application/json';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.ttf':
      return 'font/ttf';
    case '.webp':
      return 'image/webp';
    case '.xml':
      return 'application/xml';
    case '.avif':
      return 'image/avif';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    default:
      return 'application/octet-stream';
  }
}
