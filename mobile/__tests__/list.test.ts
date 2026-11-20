import AsyncStorage from '@react-native-async-storage/async-storage';

import { addItem, loadItems, removeItem, restoreItem, SAMPLE_ITEMS, saveItems, STORAGE_KEY, toggleItem } from '../src/list';

beforeEach(() => AsyncStorage.clear());

test('adds to the bottom; an unpicked match by normalised name is not added twice', () => {
  const first = addItem(SAMPLE_ITEMS, { name: 'Barista oat milk', detail: '1 L' }, 'n1');
  expect(first.existed).toBe(false);
  expect(first.items.at(-1)).toEqual({ id: 'n1', name: 'Barista oat milk', detail: '1 L', picked: false });

  const again = addItem(first.items, { name: '  barista   OAT milk ', detail: '1 L' }, 'n2');
  expect(again).toEqual({ items: first.items, id: 'n1', existed: true });
});

test('a picked product can be added again for a new purchase', () => {
  // Bananas is picked in the sample data.
  const r = addItem(SAMPLE_ITEMS, { name: 'Bananas', detail: 'About 1 kg' }, 'n1');
  expect(r.existed).toBe(false);
  expect(r.items.filter((i) => i.name === 'Bananas')).toHaveLength(2);
});

test('remove then restore keeps position and picked state', () => {
  const items = toggleItem(SAMPLE_ITEMS, 's3');
  const { items: without, removed } = removeItem(items, 's3');
  expect(without.map((i) => i.id)).toEqual(['s1', 's2', 's4']);
  expect(restoreItem(without, removed!)).toEqual(items);
  expect(removeItem(items, 'missing').removed).toBeUndefined();
});

test('persists items, order and picked state', async () => {
  const items = toggleItem(SAMPLE_ITEMS, 's2');
  await saveItems(items);
  expect(await loadItems()).toEqual(items);
});

test('a fresh install or unreadable storage loads as an empty list', async () => {
  expect(await loadItems()).toEqual([]);
  await AsyncStorage.setItem(STORAGE_KEY, '{not json');
  expect(await loadItems()).toEqual([]);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: 1 }, SAMPLE_ITEMS[0]]));
  expect(await loadItems()).toEqual([SAMPLE_ITEMS[0]]);
});
