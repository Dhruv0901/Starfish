// The live build through the real UI, with fetch faked: errors, Retry, a late response after Back, adding a backend product.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import { join } from 'path';

import App from '../App';

const PUBLIC_EXAMPLE = JSON.parse(readFileSync(join(__dirname, '..', '..', 'examples', 'public-response.json'), 'utf8'));
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
