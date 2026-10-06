import { LocalPlatform, PlatformAdapter } from './PlatformAdapter';

export type { PlatformAdapter } from './PlatformAdapter';

/**
 * Choose a platform adapter. Explicit `?platform=` wins; otherwise sniff the
 * host / referrer. Adapters are code-split so the core bundle stays clean.
 */
export async function createPlatform(): Promise<PlatformAdapter> {
  let name = '';
  try {
    const q = new URLSearchParams(window.location.search).get('platform');
    const host = `${window.location.hostname} ${document.referrer}`;
    name = q ?? (/crazygames/i.test(host) ? 'crazygames' : /playgama/i.test(host) ? 'playgama' : (import.meta.env.VITE_PLATFORM as string | undefined) ?? '');
  } catch {
    name = '';
  }
  let adapter: PlatformAdapter = new LocalPlatform();
  try {
    if (name === 'crazygames') adapter = new (await import('./crazygames')).CrazyGamesPlatform();
    else if (name === 'playgama') adapter = new (await import('./playgama')).PlaygamaPlatform();
    await adapter.init();
  } catch (e) {
    console.warn('[platform] init failed, falling back to local', e);
    adapter = new LocalPlatform();
  }
  return adapter;
}
