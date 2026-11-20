// The live build through the real UI, with fetch faked: errors, Retry, a late response after Back, adding a backend product.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import { join } from 'path';

import App from '../App';
import { STORAGE_KEY } from '../src/list';
import { saveTesterCode, TESTER_CODE_KEY } from '../src/search';

const MOCK_EXAMPLE = JSON.parse(readFileSync(join(__dirname, '..', '..', 'examples', 'public-response.json'), 'utf8'));
const PUBLIC_EXAMPLE = { ...MOCK_EXAMPLE, data: { ...MOCK_EXAMPLE.data, provider_mode: 'live' } };
const mockFetch = jest.fn();

jest.mock('../src/search', () => {
  const actual = jest.requireActual('../src/search');
  return {
    ...actual,
    SEARCH_MODE: 'live',
    search: actual.createSearch({ mode: 'live', apiBaseUrl: 'https://api.example.test', fetchImpl: (...a: unknown[]) => mockFetch(...a) }),
  };
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const reply = (body: unknown, status = 200) => () => Promise.resolve(json(body, status));

beforeEach(async () => {
  await AsyncStorage.clear();
  await saveTesterCode('tester-123');
  mockFetch.mockReset();
});

async function openAndSubmit(text: string) {
  await render(<App />);
  await screen.findByText('Your list is empty');
  await fireEvent.press(screen.getByLabelText('Add item'));
  expect(screen.getByText('Ask Starfish AI')).toBeTruthy();
  const field = screen.getByPlaceholderText('What do you need?');
  await fireEvent.changeText(field, text);
  expect(mockFetch).not.toHaveBeenCalled(); // typing alone makes no request
  await fireEvent(field, 'submitEditing');
}

test('adds a product returned by the backend, in backend wording', async () => {
  mockFetch.mockImplementation(reply(PUBLIC_EXAMPLE));
  await openAndSubmit('  Something creamy for breakfast, not too sweet ');
  expect(await screen.findByText('Starfish suggests 3 products for “Something creamy for breakfast, not too sweet”')).toBeTruthy();
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ prompt: 'Something creamy for breakfast, not too sweet', top_n: 6 });
  expect(screen.getByText('A creamy oat milk made for coffee and cereal.')).toBeTruthy();

  await fireEvent.press(screen.getByLabelText(/^Add Oatly Oat Milk Barista Edition/));
  expect(screen.getByText('Added Oatly Oat Milk Barista Edition')).toBeTruthy();
  expect(screen.getByText('A creamy oat milk made for coffee and cereal.')).toBeTruthy();
});

test('an empty success is "No close matches", not an error', async () => {
  mockFetch.mockImplementation(reply({ ...PUBLIC_EXAMPLE, data: { ...PUBLIC_EXAMPLE.data, products: [], returned_n: 0 } }));
  await openAndSubmit('zzqx');
  expect(await screen.findByText('No close matches for “zzqx”')).toBeTruthy();
  expect(screen.queryByText('Search didn’t work')).toBeNull();
  expect(screen.getByText('Add “Zzqx” as written')).toBeTruthy();
});

test('a retryable error envelope keeps the query and offers Retry; no demo results appear', async () => {
  mockFetch.mockResolvedValueOnce(json({
    schema_version: '1.0', request_id: PUBLIC_EXAMPLE.request_id, status: 'error', data: null,
    error: { code: 'UPSTREAM_ERROR', message: 'Could not connect to the Claude API.', retryable: true },
  }, 502));
  await openAndSubmit('Milk for my coffee');
  expect(await screen.findByText('Search didn’t work')).toBeTruthy();
  expect(screen.getByText('Could not connect to the Claude API.')).toBeTruthy();
  expect(screen.getByDisplayValue('Milk for my coffee')).toBeTruthy();
  expect(screen.queryByText('Barista oat milk')).toBeNull();

  mockFetch.mockResolvedValueOnce(json(PUBLIC_EXAMPLE));
  await fireEvent.press(screen.getByText('Retry'));
  expect(await screen.findByText(/^Starfish suggests 3 products/)).toBeTruthy();
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

test('a non-retryable error has no Retry', async () => {
  mockFetch.mockResolvedValue(json({
    schema_version: '1.0', request_id: PUBLIC_EXAMPLE.request_id, status: 'error', data: null,
    error: { code: 'INVALID_INPUT', message: 'prompt must be text of 1 to 2000 characters after trimming.', retryable: false },
  }, 400));
  await openAndSubmit('x');
  expect(await screen.findByText('prompt must be text of 1 to 2000 characters after trimming.')).toBeTruthy();
  expect(screen.queryByText('Retry')).toBeNull();
});

test('a late response after Back is dropped and its request aborted', async () => {
  let resolve!: (r: Response) => void;
  let signal!: AbortSignal;
  mockFetch.mockImplementation((_url: string, init: RequestInit) => {
    signal = init.signal!;
    return new Promise<Response>((r) => (resolve = r));
  });
  await openAndSubmit('Milk for my coffee');
  expect(screen.getByText('Finding products for “Milk for my coffee”…')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Search')); // arrow while the same query is in flight
  expect(mockFetch).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByLabelText('Back to list'));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(json(PUBLIC_EXAMPLE)));
  expect(screen.getByText('Your list is empty')).toBeTruthy();
  expect(screen.queryByText(/Starfish suggests/)).toBeNull();
});

test('first live search asks for the tester code, then searches with it', async () => {
  await AsyncStorage.removeItem(TESTER_CODE_KEY);
  mockFetch.mockImplementation(reply(PUBLIC_EXAMPLE));
  await openAndSubmit('Milk for my coffee');
  expect(await screen.findByText('Enter the tester code you were given to use live search.')).toBeTruthy();
  expect(mockFetch).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByLabelText('Tester code'), 'tester-123');
  await fireEvent.press(screen.getByText('Save code and search'));
  expect(await screen.findByText(/^Starfish suggests 3 products/)).toBeTruthy();
  expect(mockFetch.mock.calls[0][1].headers['X-Starfish-Tester-Code']).toBe('tester-123');
  expect(await AsyncStorage.getItem(TESTER_CODE_KEY)).toBe('tester-123');
});

test.each([
  ['offline', () => Promise.reject(new TypeError('Network request failed')), 'Couldn’t reach Starfish. Check your connection.'],
  ['mock server', reply(MOCK_EXAMPLE), 'Starfish answered from a test server, not live search.'],
  ['provider error', reply({ schema_version: '1.0', request_id: MOCK_EXAMPLE.request_id, status: 'error', data: null,
    error: { code: 'UPSTREAM_ERROR', message: 'The Claude API returned HTTP 529.', retryable: true } }, 502), 'The Claude API returned HTTP 529.'],
])('%s: clear error, Add as written still works, saved list intact', async (_name, respond, message) => {
  const saved = [{ id: 'k1', name: 'Bananas', detail: 'About 1 kg', picked: false }];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  mockFetch.mockImplementation(respond);
  await render(<App />);
  await screen.findByText('Bananas');
  await fireEvent.press(screen.getByLabelText('Add item'));
  const field = screen.getByPlaceholderText('What do you need?');
  await fireEvent.changeText(field, 'chocolate biscuits');
  await fireEvent(field, 'submitEditing');
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.queryByText(/Starfish suggests/)).toBeNull();

  await fireEvent.press(screen.getByText('Add “Chocolate biscuits” as written'));
  expect(screen.getByText('Bananas')).toBeTruthy();
  expect(screen.getByText('Chocolate biscuits')).toBeTruthy();
  const stored = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY))!);
  expect(stored.map((i: { name: string }) => i.name)).toEqual(['Bananas', 'Chocolate biscuits']);
});
