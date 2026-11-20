// The mockup's small demo catalogue and its deterministic matcher. Offline; no prices or stock.

export type CatalogEntry = { name: string; detail: string; category: string; tags: string };

const ROWS = [
  'Bananas|About 1 kg|Produce|banana fruit',
  'Pink Lady apples|1 kg bag|Produce|apple fruit',
  'Baby spinach|120 g bag|Produce|spinach salad greens leafy vegetable veg',
  'Avocados|2 pack|Produce|avocado guacamole',
  'Cherry tomatoes|250 g punnet|Produce|tomato salad vegetable veg',
  'Brown onions|1 kg bag|Produce|onion vegetable veg',
  'Garlic|3 bulbs|Produce|garlic',
  'Lemons|4 pack|Produce|lemon citrus fruit',
  'Carrots|1 kg bag|Produce|carrot vegetable veg kids',
  'Broccoli|1 head|Produce|broccoli vegetable veg greens',
  'Blueberries|125 g punnet|Produce|berry fruit breakfast smoothie',
  'Firm tofu|300 g|Produce|tofu vegan vegetarian protein',
  'Full cream milk|2 L|Dairy & eggs|milk dairy coffee',
  'Lactose-free milk|1 L|Dairy & eggs|milk dairy coffee lactose',
  'Barista oat milk|1 L|Dairy & eggs|milk oat plant dairy vegan coffee',
  'Unsweetened almond milk|1 L|Dairy & eggs|milk almond plant dairy vegan',
  'Free-range eggs|12 pack|Dairy & eggs|egg breakfast baking',
  'Plain Greek yoghurt|1 kg tub|Dairy & eggs|yoghurt yogurt breakfast dairy',
  'Tasty cheese block|500 g|Dairy & eggs|cheese dairy sandwich',
  'Salted butter|250 g|Dairy & eggs|butter dairy baking',
  'Feta|200 g|Dairy & eggs|cheese salad dairy',
  'Sourdough loaf|750 g|Bakery|bread toast',
  'Wholemeal sandwich bread|700 g|Bakery|bread sandwich lunch lunchbox toast',
  'Gluten-free bread|500 g|Bakery|bread gluten gf coeliac toast',
  'Wholemeal wraps|8 pack|Bakery|wrap tortilla lunch lunchbox',
  'Croissants|4 pack|Bakery|pastry breakfast',
  'Spaghetti|500 g|Pantry|pasta dinner',
  'Gluten-free penne|500 g|Pantry|pasta gluten gf coeliac dinner',
  'Jasmine rice|2 kg|Pantry|rice dinner',
  'Rolled oats|1 kg|Pantry|oat porridge breakfast',
  'Extra virgin olive oil|750 ml|Pantry|oil olive cooking',
  'Chickpeas|400 g tin|Pantry|chickpea bean legume vegan canned',
  'Diced tomatoes|400 g tin|Pantry|tomato pasta sauce canned',
  'Smooth peanut butter|375 g jar|Pantry|peanut spread nut',
  'Honey|500 g jar|Pantry|honey spread sweet',
  'Ground coffee|250 g|Pantry|coffee espresso',
  'Black tea bags|100 pack|Pantry|tea',
  'Chicken breast fillets|About 500 g|Meat & seafood|chicken meat protein dinner',
  'Beef mince|500 g|Meat & seafood|beef mince meat protein dinner',
  'Salmon fillets|2 pack|Meat & seafood|salmon fish seafood protein dinner',
  'Frozen peas|1 kg|Frozen|pea vegetable veg',
  'Frozen mixed berries|1 kg|Frozen|berry fruit smoothie',
  'Vanilla ice cream|2 L|Frozen|ice cream dessert',
  'Sparkling water|10 × 375 ml|Drinks|water sparkling soda',
  'Orange juice, no added sugar|2 L|Drinks|juice orange breakfast',
  'Rice crackers|100 g|Snacks|cracker kids lunchbox',
  'Salted almonds|250 g|Snacks|almond nut',
  'Dark chocolate 70%|100 g|Snacks|chocolate sweet dessert',
  'Muesli bars|6 pack|Snacks|bar kids lunchbox school',
  'Popcorn kernels|500 g|Snacks|popcorn movie',
  'Dishwashing liquid|500 ml|Household|dish dishes washing cleaning clean',
  'Dishwasher tablets|30 pack|Household|dish dishes dishwasher cleaning clean',
  'Laundry liquid|2 L|Household|laundry washing clothes',
  'Toilet paper|12 rolls|Household|toilet paper',
  'Paper towels|2 rolls|Household|paper towel cleaning kitchen',
  'Bin liners|30 pack|Household|bin rubbish garbage bag',
  'Toothpaste|110 g|Personal care|tooth teeth dental',
  'Shampoo|400 ml|Personal care|hair shampoo',
  'Sunscreen SPF 50+|200 ml|Personal care|sun sunscreen',
];

export const CATALOG: CatalogEntry[] = ROWS.map((row) => {
  const [name, detail, category, tags] = row.split('|');
  return { name, detail, category, tags };
});

const TINTS: Record<string, [string, string]> = {
  Produce: ['#E3F1E4', '#1F5130'],
  'Dairy & eggs': ['#E4EEF8', '#1D4470'],
  Bakery: ['#F5EBDD', '#6B4214'],
  Pantry: ['#F3EEDC', '#5E4B12'],
  'Meat & seafood': ['#F8E5E2', '#7A2318'],
  Frozen: ['#E2F2F5', '#0F5361'],
  Drinks: ['#E7EAF8', '#2E3A87'],
  Snacks: ['#F6E7F0', '#7A1F55'],
  Household: ['#ECEEF1', '#374151'],
  'Personal care': ['#EFE8F6', '#4C2A7A'],
};

export const tint = (category?: string): [string, string] => (category && TINTS[category]) || ['#ECEEF1', '#0F1B2D'];

export const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export const findCatalogEntry = (name: string) => CATALOG.find((p) => normalizeName(p.name) === normalizeName(name));

// Lowercase words with a trailing plural "s" dropped, so "lunchboxes" meets "lunchbox".
const words = (text: string) =>
  text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));

const STOP = new Set(
  'a an the for of to and with some my me i need want get buy something stuff thing any please in on our we us free good best'.split(' '),
);

const hit = (list: string[], t: string) =>
  list.some((w) => w === t || (t.length >= 3 && w.startsWith(t)) || (w.length >= 4 && t.startsWith(w)));

/** Name hits score 3, tag or category hits score 1; ties keep catalogue order. At most 6. */
export function demoSearch(query: string): CatalogEntry[] {
  const tokens = words(query).filter((t) => !STOP.has(t));
  if (!tokens.length) return [];
  return CATALOG.map((p, i) => {
    const nameWords = words(p.name);
    const tagWords = words(`${p.tags} ${p.category}`);
    const score = tokens.reduce((s, t) => s + (hit(nameWords, t) ? 3 : hit(tagWords, t) ? 1 : 0), 0);
    return { p, score, i };
  })
    .filter((o) => o.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 6)
    .map((o) => o.p);
}
