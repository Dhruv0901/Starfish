// Per-weight imports so only these five font files ship in the app.
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk/600SemiBold';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk/700Bold';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { ComponentRef, useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { tint } from './src/catalog';
import { addItem, findOpen, Item, loadItems, removeItem, Removed, restoreItem, saveItems, toggleItem } from './src/list';
import { Product, saveTesterCode, search, SEARCH_MODE, SearchResult } from './src/search';

const C = {
  bg: '#F4F6F8',
  ink: '#0F1B2D',
  body: '#3A4352',
  muted: '#5B6472',
  faint: '#6B7280',
  line: '#E3E7EC',
  hair: '#EEF1F4',
  chipLine: '#D5DBE2',
  accent: '#C2410C',
  flash: 'rgba(194, 65, 12, 0.14)',
};
const F = {
  body: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semi: 'Inter_600SemiBold',
  head: 'SpaceGrotesk_600SemiBold',
  brand: 'SpaceGrotesk_700Bold',
};
const EXAMPLES = ['Milk for my coffee', 'Gluten-free pasta', 'Snacks for school lunchboxes', 'Something to clean the dishes'];
const STAR = 'M12 3 L14.35 9.26 L21.04 9.56 L15.8 13.74 L17.58 20.19 L12 16.5 L6.42 20.19 L8.2 13.74 L2.96 9.56 L9.65 9.26 Z';
const SPARK = 'M11 2.5l1.9 5.6 5.6 1.9-5.6 1.9L11 17.5l-1.9-5.6L3.5 10l5.6-1.9zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z';
const PLUS = 'M12 5v14M5 12h14';

let seq = 0;
const newId = () => `${Date.now().toString(36)}-${++seq}`;

function Icon({ d, size = 24, color = C.ink, width = 2, fill }: { d: string; size?: number; color?: string; width?: number; fill?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? color : 'none'} stroke={fill ? 'none' : color}
      strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      <Path d={d} />
    </Svg>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold,
  });
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {fontsLoaded || fontError ? <Main /> : <View style={styles.fill} />}
    </SafeAreaProvider>
  );
}

type Toast = { text: string; undo?: Removed };

function Main() {
  const [items, setItems] = useState<Item[] | null>(null); // null until storage has been read
  const [screen, setScreen] = useState<'list' | 'search'>('list');
  const [toast, setToast] = useState<Toast | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const timers = useRef<{ toast?: ReturnType<typeof setTimeout>; flash?: ReturnType<typeof setTimeout> }>({});
  const closeSearch = useCallback(() => setScreen('list'), []); // stable, so a re-render never cancels a search

  useEffect(() => {
    loadItems().then(setItems);
    const t = timers.current;
    return () => {
      clearTimeout(t.toast);
      clearTimeout(t.flash);
    };
  }, []);

  useEffect(() => {
    if (items) saveItems(items); // never before the saved list has been restored
  }, [items]);

  const showToast = (next: Toast, ms: number) => {
    clearTimeout(timers.current.toast);
    setToast(next);
    timers.current.toast = setTimeout(() => setToast(null), ms);
    AccessibilityInfo.announceForAccessibility?.(next.text);
  };

  const pick = (product: { name: string; detail: string }) => {
    if (!items) return;
    const result = addItem(items, product, newId());
    setItems(result.items);
    setScreen('list');
    setFlashId(result.id);
    clearTimeout(timers.current.flash);
    timers.current.flash = setTimeout(() => setFlashId(null), 1600);
    showToast({ text: result.existed ? `${findOpen(items, product.name)!.name} is already on your list` : `Added ${product.name.trim()}` }, 2600);
  };

  const remove = (id: string) => {
    if (!items) return;
    const { items: next, removed } = removeItem(items, id);
    if (!removed) return;
    setItems(next);
    showToast({ text: `Removed ${removed.item.name}`, undo: removed }, 4000);
  };

  const undo = () => {
    if (!items || !toast?.undo) return;
    setItems(restoreItem(items, toast.undo));
    clearTimeout(timers.current.toast);
    setToast(null);
  };

  if (screen === 'search') {
    return <SearchScreen items={items ?? []} onPick={pick} onBack={closeSearch} />;
  }
  return (
    <ListScreen
      items={items}
      flashId={flashId}
      toast={toast}
      onToggle={(id) => items && setItems(toggleItem(items, id))}
      onRemove={remove}
      onUndo={undo}
      onAdd={() => {
        clearTimeout(timers.current.toast);
        setToast(null);
        setScreen('search');
      }}
    />
  );
}

function summaryText(items: Item[]) {
  const picked = items.filter((i) => i.picked).length;
  const toGet = items.length - picked;
  if (!items.length) return 'Nothing on your list yet';
  if (!toGet) return `All ${items.length} ${items.length === 1 ? 'item' : 'items'} picked`;
  return `${toGet} to get · ${picked} picked`;
}

function ListScreen(props: {
  items: Item[] | null;
  flashId: string | null;
  toast: Toast | null;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onUndo: () => void;
  onAdd: () => void;
}) {
  const { items, flashId, toast } = props;
  const insets = useSafeAreaInsets();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  // The list remounts after search, so the highlighted row reports its layout and is scrolled into view.
  const onRowLayout = (id: string, y: number) => {
    if (id === flashId) scroll.current?.scrollTo({ y: Math.max(0, y - 120), animated: true });
  };

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.brandRow} accessibilityRole="header" accessibilityLabel="Starfish">
          <Svg width={26} height={26} viewBox="0 0 24 24">
            <Path d={STAR} fill={C.accent} stroke={C.accent} strokeWidth={2.2} strokeLinejoin="round" />
          </Svg>
          <Text style={styles.brand}>Starfish</Text>
        </View>
        <View style={{ gap: 6 }}>
          <Text style={styles.h1} accessibilityRole="header">Shopping list</Text>
          {items && <Text style={styles.summary}>{summaryText(items)}</Text>}
        </View>
      </View>

      <ScrollView ref={scroll} style={styles.fill} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 124 + insets.bottom }}>
        {items && items.length > 0 && (
          <View style={styles.card} accessibilityLabel="Shopping list items">
            {items.map((item, i) => (
              <View
                key={item.id}
                onLayout={(e) => onRowLayout(item.id, e.nativeEvent.layout.y)}
                style={[styles.row, i > 0 && styles.rowDivider, item.id === flashId && { backgroundColor: C.flash }]}
              >
                <Pressable
                  onPress={() => props.onToggle(item.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: item.picked }}
                  accessibilityLabel={`Picked: ${item.name}`}
                  style={styles.iconBtn}
                >
                  {item.picked ? (
                    <View style={styles.checkOn}>
                      <Icon d="M5 12.5l4.5 4.5L19 7.5" size={16} color="#FFFFFF" width={3} />
                    </View>
                  ) : (
                    <View style={styles.checkOff} />
                  )}
                </Pressable>
                <View style={styles.rowText}>
                  <Text style={[styles.itemName, item.picked && styles.itemPicked]}>{item.name}</Text>
                  <Text style={styles.itemDetail}>{item.detail}</Text>
                </View>
                <Pressable onPress={() => props.onRemove(item.id)} accessibilityRole="button" accessibilityLabel={`Remove ${item.name}`} style={styles.iconBtn}>
                  <Icon d="M6 6l12 12M18 6L6 18" size={20} color={C.muted} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        {items && items.length === 0 && (
          <View style={styles.empty}>
            <View style={styles.emptyBadge}>
              <Icon d={STAR} size={34} color="#7B8594" width={1.6} />
            </View>
            <Text style={styles.h2}>Your list is empty</Text>
            <Text style={styles.emptyText}>Tap the + button to search for your first item.</Text>
          </View>
        )}
      </ScrollView>

      <Pressable onPress={props.onAdd} accessibilityRole="button" accessibilityLabel="Add item" style={[styles.fab, { bottom: 24 + insets.bottom }]}>
        <Icon d={PLUS} size={28} color="#FFFFFF" width={2.2} />
      </Pressable>

      {toast && (
        <View style={[styles.toast, { bottom: 28 + insets.bottom }]} accessibilityLiveRegion="polite">
          <Text style={styles.toastText}>{toast.text}</Text>
          {toast.undo && (
            <Pressable onPress={props.onUndo} accessibilityRole="button" accessibilityLabel={`Undo removing ${toast.undo.item.name}`} style={styles.undoBtn}>
              <Text style={styles.undoText}>Undo</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

type Phase = { kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; result: SearchResult };

function SearchScreen({ items, onPick, onBack }: { items: Item[]; onPick: (p: { name: string; detail: string }) => void; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const run = useRef({ seq: 0, controller: null as AbortController | null, inFlight: null as string | null, picked: false });

  const cancel = useCallback(() => {
    run.current.seq++; // any response still on its way is now stale
    run.current.controller?.abort();
    run.current.controller = null;
    run.current.inFlight = null;
  }, []);

  const back = useCallback(() => {
    cancel();
    Keyboard.dismiss();
    onBack();
  }, [cancel, onBack]);

  useEffect(() => {
    const focus = setTimeout(() => input.current?.focus(), 80); // Android ignores autoFocus during the first frame
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => {
      clearTimeout(focus);
      sub.remove();
      cancel();
    };
  }, [back, cancel]);

  const submit = async (text: string) => {
    const q = text.trim();
    if (!q || run.current.inFlight === q) return; // empty input, or the same search is already running
    cancel();
    const mine = run.current.seq;
    const controller = new AbortController();
    run.current.controller = controller;
    run.current.inFlight = q;
    setQuery(q);
    setSubmitted(q);
    setPhase({ kind: 'loading' });
    const result = await search(q, controller.signal);
    if (mine !== run.current.seq) return;
    run.current.controller = null;
    run.current.inFlight = null;
    setPhase({ kind: 'done', result });
  };

  const onChange = (text: string) => {
    setQuery(text);
    if (!text.trim()) {
      cancel();
      setPhase({ kind: 'idle' });
    }
  };

  const choose = (product: { name: string; detail: string }) => {
    if (run.current.picked) return; // a second tap before the list appears
    run.current.picked = true;
    Keyboard.dismiss();
    cancel();
    onPick(product);
  };

  const customName = submitted ? submitted.charAt(0).toUpperCase() + submitted.slice(1) : '';
  const live = SEARCH_MODE === 'live';

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.fill, styles.searchBg]}>
      <View style={[styles.searchBar, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Back to list" style={styles.iconBtn}>
          <Icon d="M19 12H5M12 19l-7-7 7-7" />
        </Pressable>
        <View style={styles.field}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth={2} strokeLinecap="round">
            <Circle cx={11} cy={11} r={7} />
            <Path d="M20 20l-3.5-3.5" />
          </Svg>
          <TextInput
            ref={input}
            value={query}
            onChangeText={onChange}
            onSubmitEditing={() => void submit(query)}
            placeholder="What do you need?"
            placeholderTextColor={C.faint}
            accessibilityLabel="Search for a product"
            returnKeyType="search"
            submitBehavior="blurAndSubmit"
            autoFocus
            autoCorrect={false}
            maxLength={200}
            style={styles.input}
          />
          <Pressable onPress={() => void submit(query)} accessibilityRole="button" accessibilityLabel="Search" style={styles.submit}>
            <Icon d="M12 19V5M5 12l7-7 7 7" size={20} color="#FFFFFF" width={2.2} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.fill}
        contentContainerStyle={{ padding: 16, paddingTop: 24, paddingBottom: 32 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {phase.kind === 'idle' && (
          <View style={{ gap: 28, paddingHorizontal: 8 }}>
            <View style={{ gap: 8 }}>
              <View style={styles.eyebrowRow}>
                <Icon d={SPARK} size={18} color={C.accent} fill />
                <Text style={styles.eyebrow}>{live ? 'Ask Starfish AI' : 'Demo search'}</Text>
              </View>
              <Text style={styles.intro}>
                {live
                  ? 'Type a product, or describe what you’re after. Starfish turns it into matching products you can add in one tap.'
                  : 'Type a product, or describe what you’re after. This demo matches a small built-in catalogue and works offline.'}
              </Text>
            </View>
            <View style={{ gap: 12 }}>
              <Text style={styles.tryLabel}>Try</Text>
              <View style={styles.chips}>
                {EXAMPLES.map((text) => (
                  <Pressable key={text} onPress={() => void submit(text)} accessibilityRole="button" style={styles.chip}>
                    <Text style={styles.chipText}>{text}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        )}

        {phase.kind === 'loading' && (
          <View style={{ gap: 16 }}>
            <Status text={`Finding products for “${submitted}”…`} />
            <Skeletons />
          </View>
        )}

        {phase.kind === 'done' && phase.result.ok && (
          <View style={{ gap: 12 }}>
            <Status
              text={
                phase.result.products.length
                  ? `${live ? 'Starfish suggests' : 'Demo search found'} ${phase.result.products.length} ${phase.result.products.length === 1 ? 'product' : 'products'} for “${submitted}”`
                  : `No close matches for “${submitted}”`
              }
            />
            {phase.result.products.map((p) => (
              <ResultRow key={p.name} product={p} onList={!!findOpen(items, p.name)} onPress={() => choose(p)} />
            ))}
            <AddAsTyped
              hint={phase.result.products.length ? 'Not quite right?' : 'You can still add it to your list:'}
              name={customName}
              onPress={() => choose({ name: customName, detail: 'Added as typed' })}
            />
          </View>
        )}

        {phase.kind === 'done' && !phase.result.ok && (
          <View style={{ gap: 12, paddingHorizontal: 8 }} accessibilityLiveRegion="polite">
            <Text style={styles.h2}>Search didn’t work</Text>
            <Text style={styles.intro}>{phase.result.message}</Text>
            {phase.result.needsCode && (
              <TesterCode
                onSave={async (code) => {
                  await saveTesterCode(code);
                  void submit(submitted);
                }}
              />
            )}
            {phase.result.retryable && (
              <Pressable onPress={() => void submit(submitted)} accessibilityRole="button" style={[styles.chip, styles.retry]}>
                <Text style={[styles.chipText, { color: '#FFFFFF', fontFamily: F.semi }]}>Retry</Text>
              </Pressable>
            )}
            <AddAsTyped hint="Or add it without searching:" name={customName} onPress={() => choose({ name: customName, detail: 'Added as typed' })} />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Status({ text }: { text: string }) {
  return (
    <View style={styles.eyebrowRow} accessibilityLiveRegion="polite">
      <Icon d={SPARK} size={18} color={C.accent} fill />
      <Text style={styles.status}>{text}</Text>
    </View>
  );
}

function Skeletons() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    AccessibilityInfo.isReduceMotionEnabled?.().then((reduce) => {
      if (reduce) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.45, duration: 600, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => loop?.stop();
  }, [opacity]);
  return (
    <Animated.View style={{ opacity, gap: 2 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {['70%', '55%', '64%', '48%'].map((w) => (
        <View key={w} style={styles.skelRow}>
          <View style={styles.skelTile} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={[styles.skelBar, { width: w as `${number}%` }]} />
            <View style={[styles.skelBar, { width: '40%', height: 10 }]} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

function ResultRow({ product, onList, onPress }: { product: Product; onList: boolean; onPress: () => void }) {
  const [bg, ink] = tint(product.category);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={onList ? `${product.name}, already on your list` : `Add ${product.name}, ${product.meta}, to your list`}
      style={({ pressed }) => [styles.result, pressed && { backgroundColor: C.bg }]}
    >
      <View style={[styles.tile, { backgroundColor: bg }]}>
        <Text style={[styles.tileText, { color: ink }]}>{product.name.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.rowText}>
        <Text style={styles.itemName}>{product.name}</Text>
        <Text style={styles.itemDetail}>{product.meta}</Text>
      </View>
      {onList && (
        <View style={styles.onList}>
          <Text style={styles.onListText}>On list</Text>
        </View>
      )}
      <View style={styles.addRing}>
        <Icon d={PLUS} size={18} color={C.accent} width={2.2} />
      </View>
    </Pressable>
  );
}

function TesterCode({ onSave }: { onSave: (code: string) => void }) {
  const [code, setCode] = useState('');
  const save = () => code.trim() && onSave(code);
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.field}>
        <TextInput
          value={code}
          onChangeText={setCode}
          onSubmitEditing={save}
          placeholder="Tester code"
          placeholderTextColor={C.faint}
          accessibilityLabel="Tester code"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          style={styles.input}
        />
      </View>
      <Pressable onPress={save} accessibilityRole="button" style={[styles.chip, styles.retry]}>
        <Text style={[styles.chipText, { color: '#FFFFFF', fontFamily: F.semi }]}>Save code and search</Text>
      </Pressable>
    </View>
  );
}

function AddAsTyped({ hint, name, onPress }: { hint: string; name: string; onPress: () => void }) {
  return (
    <View style={styles.custom}>
      <Text style={styles.itemDetail}>{hint}</Text>
      <Pressable onPress={onPress} accessibilityRole="button" style={[styles.chip, styles.customChip]}>
        <Icon d={PLUS} size={16} width={2.2} />
        <Text style={[styles.chipText, { fontFamily: F.medium, flexShrink: 1 }]}>Add “{name}” as written</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 18, gap: 22 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brand: { fontFamily: F.brand, fontSize: 18, color: C.ink, letterSpacing: -0.2 },
  h1: { fontFamily: F.head, fontSize: 34, lineHeight: 38, color: C.ink, letterSpacing: -0.7 },
  h2: { fontFamily: F.head, fontSize: 20, lineHeight: 24, color: C.ink },
  summary: { fontFamily: F.body, fontSize: 15, lineHeight: 21, color: C.muted },
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: C.line, borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 64, padding: 6, backgroundColor: '#FFFFFF' },
  rowDivider: { borderTopWidth: 1, borderTopColor: C.hair },
  rowText: { flex: 1, minWidth: 0, gap: 2, paddingHorizontal: 4 },
  iconBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  checkOn: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  checkOff: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#7B8594' },
  itemName: { fontFamily: F.medium, fontSize: 16, lineHeight: 21, color: C.ink },
  itemPicked: { color: C.faint, textDecorationLine: 'line-through' },
  itemDetail: { fontFamily: F.body, fontSize: 13, lineHeight: 17, color: C.muted },
  empty: { marginTop: 72, paddingHorizontal: 32, alignItems: 'center', gap: 12 },
  emptyBadge: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: C.line,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyText: { fontFamily: F.body, fontSize: 15, lineHeight: 22, color: C.muted, textAlign: 'center' },
  fab: {
    position: 'absolute', right: 24, width: 60, height: 60, borderRadius: 30, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center', elevation: 6,
    shadowColor: C.ink, shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 10 },
  },
  toast: {
    position: 'absolute', left: 16, right: 100, minHeight: 52, paddingVertical: 4, paddingRight: 4, paddingLeft: 16,
    borderRadius: 12, backgroundColor: C.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 8, elevation: 8,
  },
  toastText: { flex: 1, fontFamily: F.body, fontSize: 14, lineHeight: 19, color: '#FFFFFF', paddingVertical: 6 },
  undoBtn: { minHeight: 48, paddingHorizontal: 14, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.14)', justifyContent: 'center' },
  undoText: { fontFamily: F.semi, fontSize: 14, color: '#FFFFFF' },
  searchBg: { backgroundColor: '#FFFFFF' },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  field: {
    flex: 1, minWidth: 0, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 3,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 26,
  },
  input: { flex: 1, minWidth: 0, fontFamily: F.body, fontSize: 16, color: C.ink, paddingVertical: 10 },
  submit: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  eyebrow: { fontFamily: F.semi, fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase', color: C.accent },
  intro: { fontFamily: F.body, fontSize: 16, lineHeight: 24, color: C.body },
  tryLabel: { fontFamily: F.medium, fontSize: 13, color: C.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 48, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 24, borderWidth: 1, borderColor: C.chipLine,
    backgroundColor: '#FFFFFF', justifyContent: 'center',
  },
  chipText: { fontFamily: F.body, fontSize: 14, lineHeight: 19, color: C.ink },
  retry: { alignSelf: 'flex-start', backgroundColor: C.accent, borderColor: C.accent },
  status: { flex: 1, fontFamily: F.body, fontSize: 14, lineHeight: 20, color: C.body },
  skelRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  skelTile: { width: 44, height: 44, borderRadius: 10, backgroundColor: C.hair },
  skelBar: { height: 12, borderRadius: 6, backgroundColor: C.hair },
  result: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12 },
  tile: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tileText: { fontFamily: F.head, fontSize: 18 },
  onList: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, backgroundColor: '#E3F1E4' },
  onListText: { fontFamily: F.medium, fontSize: 12, color: '#1F5130' },
  addRing: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: C.accent, alignItems: 'center', justifyContent: 'center',
  },
  custom: { marginTop: 8, marginHorizontal: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.hair, alignItems: 'flex-start', gap: 10 },
  customChip: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%', alignSelf: 'flex-start' },
});
