// Serves the UI from app://devcockpit/ instead of file://. Hardened builds turn off
// file:// privileges (the GrantFileProtocolExtraPrivileges fuse), and a private
// protocol is stricter anyway: it can only ever return files from the UI folder.
import { protocol } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

export const APP_ORIGIN = 'app://devcockpit';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Must run before the app is ready. */
export function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

export function serveAppProtocol(rendererDir: string) {
  const root = path.resolve(rendererDir);
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'devcockpit') return new Response('Not found', { status: 404 });
    const file = path.resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    // Refuse anything outside the UI folder (../ tricks, absolute paths).
    if (file !== root && !file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const body = await fs.readFile(file);
      return new Response(body, { headers: { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
