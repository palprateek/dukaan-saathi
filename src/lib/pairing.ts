export type AppLink = { type: 'pair'; server: string } | { type: 'listen' } | null;

/** Handles `dukaansaathi://pair?server=…` and `dukaansaathi://listen`. */
export function parseAppLink(raw: string): AppLink {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'dukaansaathi:') return null;
    // Android WebView leaves `host` empty for custom schemes and keeps the
    // authority in `pathname` (`//pair`). Browser and Node put it in `host`.
    const host = (
      url.host || url.pathname.replace(/^\/+/, '').split('/')[0]
    ).toLowerCase();
    if (host === 'pair') {
      const server = url.searchParams.get('server')?.trim() ?? '';
      return server ? { type: 'pair', server } : null;
    }
    if (host === 'listen') return { type: 'listen' };
  } catch {
    return null;
  }
  return null;
}
