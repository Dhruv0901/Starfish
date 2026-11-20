// The demo-mode acceptance journey, driven through the real UI (no device needed).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import App from '../App';
import { STORAGE_KEY } from '../src/list';

let hardwareBack: (() => boolean) | null = null;
beforeEach(async () => {
  await AsyncStorage.clear();
  hardwareBack = null;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, handler) => {
    hardwareBack = handler as () => boolean;
    return { remove: () => (hardwareBack = null) };
  });
});

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));
const press = (el: any) => fireEvent.press(el);

async function searchFor(text: string) {
  await press(screen.getByLabelText('Add item'));
  await fireEvent.changeText(screen.getByPlaceholderText('What do you need?'), text);
  await fireEvent(screen.getByPlaceholderText('What do you need?'), 'submitEditing');
}

test('fresh install: empty list, search, add, no duplicate, pick, relaunch, remove, undo', async () => {
  await render(<App />);
  expect(await screen.findByText('Your list is empty')).toBeTruthy();
  expect(screen.getByText('Tap the + button to search for your first item.')).toBeTruthy();

  // Typing alone shows nothing new; the example chip runs its search.
  await press(screen.getByLabelText('Add item'));
  expect(screen.getByText('Demo search')).toBeTruthy();
  await press(screen.getByText('Milk for my coffee')); // loading state is asserted in the Back test
  expect(await screen.findByText(/^Demo search found 5 products for “Milk for my coffee”/)).toBeTruthy();

  const barista = screen.getByLabelText('Add Barista oat milk, 1 L · Dairy & eggs, to your list');
  await press(barista);
  await press(barista); // rapid second tap is ignored
  expect(screen.getByText('Added Barista oat milk')).toBeTruthy();
  expect(screen.getAllByText('Barista oat milk')).toHaveLength(1);
  expect(screen.getByText('1 L')).toBeTruthy();
  expect(screen.getByText('1 to get · 0 picked')).toBeTruthy();

  // Selecting it again shows "On list" and keeps one row.
  await searchFor('Milk for my coffee');
  expect(await screen.findByText('On list')).toBeTruthy();
  await press(screen.getByLabelText('Barista oat milk, already on your list'));
  expect(screen.getByText('Barista oat milk is already on your list')).toBeTruthy();
  expect(screen.getAllByText('Barista oat milk')).toHaveLength(1);

  await press(screen.getByLabelText('Picked: Barista oat milk'));
  expect(screen.getByText('All 1 item picked')).toBeTruthy();
  await wait(50);

  // Fully close and reopen.
  await screen.unmount();
  await render(<App />);
  expect(await screen.findByText('Barista oat milk')).toBeTruthy();
  expect(screen.getByLabelText('Picked: Barista oat milk').props.accessibilityState).toMatchObject({ checked: true });

  await press(screen.getByLabelText('Remove Barista oat milk'));
  expect(screen.getByText('Your list is empty')).toBeTruthy();
  await press(screen.getByText('Undo'));
  expect(screen.getByLabelText('Picked: Barista oat milk').props.accessibilityState).toMatchObject({ checked: true });
  await wait(50);
  expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY))!)).toEqual([
    expect.objectContaining({ name: 'Barista oat milk', detail: '1 L', picked: true }),
  ]);
});

test('relaunch restores the saved list before any empty state', async () => {
  const saved = [
    { id: 'a', name: 'Free-range eggs', detail: '12 pack', picked: false },
    { id: 'b', name: 'Sourdough loaf', detail: '750 g', picked: true },
  ];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  await render(<App />);
  expect(await screen.findByText('1 to get · 1 picked')).toBeTruthy();
  expect(screen.queryByText('Your list is empty')).toBeNull();
  expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY))!)).toEqual(saved);
});

test('remove + undo restores the middle position', async () => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([
    { id: 'a', name: 'A', detail: '1', picked: false },
    { id: 'b', name: 'B', detail: '2', picked: true },
    { id: 'c', name: 'C', detail: '3', picked: false },
  ]));
  await render(<App />);
  await press(await screen.findByLabelText('Remove B'));
  await press(screen.getByText('Undo'));
  expect(screen.getAllByLabelText(/^Picked: /).map((n) => n.props.accessibilityLabel)).toEqual(['Picked: A', 'Picked: B', 'Picked: C']);
});

test('gluten-free penne ranks ahead of ordinary pasta in the results', async () => {
  await render(<App />);
  await screen.findByText('Your list is empty');
  await press(screen.getByLabelText('Add item'));
  await press(screen.getByText('Gluten-free pasta'));
  await screen.findByText(/^Demo search found/);
  const rows = screen.getAllByLabelText(/^Add .*, to your list$/).map((n) => n.props.accessibilityLabel);
  expect(rows[0]).toMatch(/^Add Gluten-free penne/);
  expect(rows.findIndex((l) => l.startsWith('Add Gluten-free penne'))).toBeLessThan(rows.findIndex((l) => l.startsWith('Add Spaghetti')));
});

test('unmatched text can be added as written', async () => {
  await render(<App />);
  await screen.findByText('Your list is empty');
  await searchFor('  zzqx flurb  ');
  expect(await screen.findByText('No close matches for “zzqx flurb”')).toBeTruthy();
  await press(screen.getByText('Add “Zzqx flurb” as written'));
  expect(screen.getByText('Zzqx flurb')).toBeTruthy();
  expect(screen.getByText('Added as typed')).toBeTruthy();
});

test('empty input searches nothing; Android Back and top Back add nothing and drop late results', async () => {
  await render(<App />);
  await screen.findByText('Your list is empty');
  await press(screen.getByLabelText('Add item'));
  await fireEvent.changeText(screen.getByPlaceholderText('What do you need?'), '   ');
  await press(screen.getByLabelText('Search'));
  expect(screen.queryByText(/Finding products/)).toBeNull();

  await press(screen.getByText('Milk for my coffee'));
  expect(screen.getByText('Finding products for “Milk for my coffee”…')).toBeTruthy();
  expect(screen.getByDisplayValue('Milk for my coffee')).toBeTruthy(); // the chip fills the field
  expect(screen.queryByText('Gluten-free pasta')).toBeNull();
  await act(async () => {
    expect(hardwareBack!()).toBe(true);
  });
  expect(screen.getByText('Your list is empty')).toBeTruthy();
  await wait(700); // the demo result arrives after Back and is dropped
  expect(screen.getByText('Your list is empty')).toBeTruthy();

  await press(screen.getByLabelText('Add item'));
  await press(screen.getByLabelText('Back to list'));
  expect(screen.getByText('Your list is empty')).toBeTruthy();
});
