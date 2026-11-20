import { readFileSync } from 'fs';
import { join } from 'path';

import { demoSearch } from '../src/catalog';
import { createSearch } from '../src/search';

const ROOT = join(__dirname, '..', '..');
const PUBLIC_EXAMPLE = JSON.parse(readFileSync(join(ROOT, 'examples', 'public-response.json'), 'utf8'));
const ERROR_EXAMPLE = JSON.parse(readFileSync(join(ROOT, 'examples', 'error-response.json'), 'utf8'));

const names = (q: string) => demoSearch(q).map((p) => p.name);

describe('demo search', () => {
  test.each(['Milk for my coffee', 'Gluten-free pasta', 'Snacks for school lunchboxes', 'Something to clean the dishes'])(
    'example "%s" has results',
    (q) => expect(names(q).length).toBeGreaterThan(0),
  );

  test('milk for coffee includes Barista oat milk at 1 L', () => {
    expect(demoSearch('Milk for my coffee').find((p) => p.name === 'Barista oat milk')?.detail).toBe('1 L');
  });

  test('gluten-free penne ranks first and ahead of ordinary pasta', () => {
    const r = names('Gluten-free pasta');
    expect(r[0]).toBe('Gluten-free penne');
    expect(r.indexOf('Gluten-free penne')).toBeLessThan(r.indexOf('Spaghetti'));
  });

  test('ordinary typed queries, plurals and case', () => {
    expect(names('bananas')[0]).toBe('Bananas');
    expect(names('EGGS')[0]).toBe('Free-range eggs');
    expect(names('dishwasher')).toContain('Dishwasher tablets');
  });

  test('deterministic, at most six, nothing for stop words or gibberish', () => {
    expect(names('milk')).toEqual(names('milk'));
    expect(names('milk dairy cheese butter eggs bread').length).toBe(6);
    expect(names('something for me')).toEqual([]);
    expect(names('zzqx flurb')).toEqual([]);
  });
});

function fakeFetch(respond: () => Promise<Response> | Response) {
  return jest.fn((_url: string, _init?: RequestInit) => Promise.resolve(respond())) as unknown as jest.Mock & typeof fetch;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const live = (fetchImpl: typeof fetch, extra = {}) => createSearch({ mode: 'live', apiBaseUrl: 'https://api.example.test/', fetchImpl, ...extra });

describe('live search', () => {
  test('sends the agreed request and keeps backend order and wording', async () => {
    const f = fakeFetch(() => json(PUBLIC_EXAMPLE));
    const result = await live(f)('Milk for my coffee');

    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.example.test/recommendations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ prompt: 'Milk for my coffee', top_n: 6 });
    expect(result).toEqual({
      ok: true,
      products: PUBLIC_EXAMPLE.data.products.map((p: any) => ({ name: p.name, meta: p.description, detail: p.description, category: undefined })),
    });
  });

  test('pack size and category come from the local catalogue when it knows the product', async () => {
    const envelope = { ...PUBLIC_EXAMPLE, data: { ...PUBLIC_EXAMPLE.data, products: [{ rank: 1, name: 'Barista oat milk', description: 'Froths well.', reason: 'x' }] } };
    const result = await live(fakeFetch(() => json(envelope)))('oat milk');
    expect(result).toEqual({ ok: true, products: [{ name: 'Barista oat milk', meta: 'Froths well.', detail: '1 L', category: 'Dairy & eggs' }] });
  });

  test('a successful empty response is ok with no products', async () => {
    const envelope = { ...PUBLIC_EXAMPLE, data: { ...PUBLIC_EXAMPLE.data, returned_n: 0, products: [], shortfall_reason: 'None.' } };
    expect(await live(fakeFetch(() => json(envelope)))('x')).toEqual({ ok: true, products: [] });
  });

  test('error envelopes keep the server message and retryable flag', async () => {
    expect(await live(fakeFetch(() => json(ERROR_EXAMPLE, 400)))('x')).toEqual({
      ok: false, message: ERROR_EXAMPLE.error.message, retryable: false,
    });
    const upstream = { ...ERROR_EXAMPLE, error: { code: 'UPSTREAM_ERROR', message: 'The Claude API request timed out.', retryable: true } };
    expect(await live(fakeFetch(() => json(upstream, 502)))('x')).toEqual({ ok: false, message: 'The Claude API request timed out.', retryable: true });
  });

  test('connection failures and odd bodies are retryable errors, never demo results', async () => {
    const down = await live(fakeFetch(() => Promise.reject(new TypeError('Network request failed'))))('Milk for my coffee');
    expect(down).toEqual({ ok: false, message: 'Couldn’t reach Starfish. Check your connection.', retryable: true });
    const html = await live(fakeFetch(() => new Response('<html>bad gateway</html>', { status: 502 })))('x');
    expect(html).toMatchObject({ ok: false, retryable: true });
  });

  test('a slow server times out', async () => {
    const hang = jest.fn((_u: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
    expect(await live(hang, { timeoutMs: 20 })('x')).toEqual({ ok: false, message: 'Starfish took too long to answer.', retryable: true });
  });

  test('without an HTTPS base URL nothing is sent', async () => {
    const f = fakeFetch(() => json(PUBLIC_EXAMPLE));
    for (const apiBaseUrl of ['', 'http://192.168.1.5:8000']) {
      const r = await createSearch({ mode: 'live', apiBaseUrl, fetchImpl: f })('x');
      expect(r).toMatchObject({ ok: false, retryable: false });
    }
    expect(f).not.toHaveBeenCalled();
  });
});
