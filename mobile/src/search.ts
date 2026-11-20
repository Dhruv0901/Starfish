// One search function for the UI; the data source is fixed per build by EXPO_PUBLIC_SEARCH_MODE.
import { demoSearch, findCatalogEntry } from './catalog';

export type Product = {
  name: string;
  meta: string; // second line of the result row
  detail: string; // stored on the list row
  category?: string; // only when the local catalogue knows this product
};

export type SearchResult = { ok: true; products: Product[] } | { ok: false; message: string; retryable: boolean };

export type SearchMode = 'demo' | 'live';

type Config = {
  mode: SearchMode;
  apiBaseUrl?: string;
  demoDelayMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  allowHttp?: boolean;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createSearch({ mode, apiBaseUrl = '', demoDelayMs = 450, timeoutMs = 20000, fetchImpl, allowHttp = false }: Config) {
  if (mode === 'demo') {
    return async (query: string, _signal?: AbortSignal): Promise<SearchResult> => {
      await wait(demoDelayMs); // shows the same loading state a network search would
      return {
        ok: true,
        products: demoSearch(query).map((p) => ({ name: p.name, meta: `${p.detail} · ${p.category}`, detail: p.detail, category: p.category })),
      };
    };
  }

  const base = apiBaseUrl.trim().replace(/\/+$/, '');
  const configured = /^https:\/\/\S+$/.test(base) || (allowHttp && /^http:\/\/\S+$/.test(base));

  return async (query: string, signal?: AbortSignal): Promise<SearchResult> => {
    if (!configured) return { ok: false, message: 'Live search has no HTTPS server set for this build.', retryable: false };
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);

    let response: Response;
    let body: any;
    try {
      response = await (fetchImpl ?? fetch)(`${base}/recommendations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ prompt: query, top_n: 6 }),
        signal: controller.signal,
      });
      body = await response.json().catch(() => null);
    } catch {
      return {
        ok: false,
        message: timedOut ? 'Starfish took too long to answer.' : 'Couldn’t reach Starfish. Check your connection.',
        retryable: true,
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    if (body?.status === 'ok' && Array.isArray(body.data?.products)) {
      const products = body.data.products
        .filter((p: any) => typeof p?.name === 'string' && p.name.trim() && typeof p.description === 'string')
        .map((p: any): Product => {
          const known = findCatalogEntry(p.name);
          // Backend wording is shown as is; pack size and category come only from the local catalogue.
          return { name: p.name, meta: p.description, detail: known?.detail ?? p.description, category: known?.category };
        });
      return { ok: true, products };
    }
    if (body?.status === 'error' && typeof body.error?.message === 'string') {
      return { ok: false, message: body.error.message, retryable: body.error.retryable === true };
    }
    return { ok: false, message: `Starfish sent an unexpected response (HTTP ${response.status}).`, retryable: response.status >= 500 };
  };
}

export const SEARCH_MODE: SearchMode = process.env.EXPO_PUBLIC_SEARCH_MODE === 'live' ? 'live' : 'demo';

export const search = createSearch({
  mode: SEARCH_MODE,
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  allowHttp: typeof __DEV__ !== 'undefined' && __DEV__, // local dev servers only; release builds need HTTPS
});
