// Shopping list rules and on-device persistence. Pure functions; App.tsx owns the state.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeName } from './catalog';

export type Item = { id: string; name: string; detail: string; picked: boolean };
export type Removed = { item: Item; index: number };

export const STORAGE_KEY = 'starfish.list.v1';

// The mockup's rows. Test data only: a fresh install starts empty.
export const SAMPLE_ITEMS: Item[] = [
  { id: 's1', name: 'Bananas', detail: 'About 1 kg', picked: true },
  { id: 's2', name: 'Free-range eggs', detail: '12 pack', picked: false },
  { id: 's3', name: 'Sourdough loaf', detail: '750 g', picked: false },
  { id: 's4', name: 'Baby spinach', detail: '120 g bag', picked: false },
];

/** The unpicked row with this name, if any. Picked rows don't count, so a product can be bought again. */
export const findOpen = (items: Item[], name: string) =>
  items.find((i) => !i.picked && normalizeName(i.name) === normalizeName(name));

export function addItem(items: Item[], product: { name: string; detail: string }, id: string) {
  const existing = findOpen(items, product.name);
  if (existing) return { items, id: existing.id, existed: true };
  return { items: [...items, { id, name: product.name.trim(), detail: product.detail, picked: false }], id, existed: false };
}

export const toggleItem = (items: Item[], id: string) => items.map((i) => (i.id === id ? { ...i, picked: !i.picked } : i));

export function removeItem(items: Item[], id: string): { items: Item[]; removed?: Removed } {
  const index = items.findIndex((i) => i.id === id);
  if (index < 0) return { items };
  return { items: items.filter((i) => i.id !== id), removed: { item: items[index], index } };
}

export function restoreItem(items: Item[], { item, index }: Removed) {
  const next = items.slice();
  next.splice(Math.min(index, next.length), 0, item);
  return next;
}

const isItem = (v: any): v is Item =>
  v && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.detail === 'string' && typeof v.picked === 'boolean';

export async function loadItems(): Promise<Item[]> {
  try {
    const parsed = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isItem) : [];
  } catch {
    return [];
  }
}

export const saveItems = (items: Item[]) => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items)).catch(() => {});
