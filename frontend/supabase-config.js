/**
 * ============================================================================
 * REFUND — Shared Supabase Backend Configuration & Seed Dataset (supabase-config.js)
 * ============================================================================
 * Grounded in ./returns-trade-agent-main:
 *   - docs/database.md (local Supabase; do not call the hosted project)
 *   - supabase/config.toml (project_id = "returns-trade-agent", API port 54321)
 *   - supabase/migrations/20261113120000_init_schema.sql
 *   - supabase/migrations/20261113120100_seed_dummy_data.sql
 *   - supabase/migrations/20261113140000_contact_forwarding.sql
 *   - supabase/functions/forward-contact-requests/index.ts
 * ============================================================================
 */

// Public URL and anon/publishable key only. They come from supabase-public.js
// (gitignored). Never put a service-role key, a database password, or an AI
// provider key in this file: it runs in the browser.
const PUBLIC_CONFIG = window.SUPABASE_PUBLIC_CONFIG || {};

const SUPABASE_CONFIG = {
  SUPABASE_URL: PUBLIC_CONFIG.SUPABASE_URL || 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: PUBLIC_CONFIG.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_PUBLIC_KEY',
  PROJECT_ID: 'local',
  LOGIN_PAGE: 'index.html',
  STORE_PAGE: 'store.html',
  ORDERS_PAGE: 'orders.html',
  REPLY_ENGINE_URL: 'http://localhost:8080',
  EDGE_FUNCTION_NAME: 'forward-contact-requests',
  AUTH_LOG_FUNCTION: 'log-auth-event',
};

// The browser does not call an LLM. Key and URL stay blank.
const AI_CONFIG = {
  API_KEY: '',
  API_URL: '',
  MODEL: '',
};

try {
  localStorage.removeItem('refund_grok_api_key_v1');
  localStorage.removeItem('refund_grok_model_v1');
} catch (_) {}

// Business Profile (from business.json)
const BUSINESS_PROFILE = {
  name: 'Returns Trade Agent',
  tone: 'friendly, professional, concise',
  signoff: 'Kind regards,\nThe Returns Trade Agent Team',
  currency: 'R',
  currency_code: 'ZAR',
  hours: {
    'Mon-Fri': '08:00-17:00',
    Sat: '09:00-13:00',
    Sun: 'Closed',
  },
  location: '123 Example Street, Sandton, Johannesburg',
  contact: {
    phone: '+27 11 000 0000',
    email: 'info@example.co.za',
    whatsapp: '+27 82 000 0000',
  },
  services: [
    { name: 'Consultation', price: 500, unit: 'per hour' },
    { name: 'Standard Callout', price: 350, unit: 'flat fee' },
  ],
  policies: {
    refund:
      'A return is allowed when the order is yours and delivered, delivery was no more than 14 days ago, the item was not bought on sale, the item is not food, the quantity is not more than you bought, and there is no other open return for that item.',
    db_returns_rule:
      'Database return rule: the order is delivered, delivery was no more than 14 days ago, the item was not bought on sale, and the quantity is not more than purchased.',
    delivery: 'Delivery takes 2-5 working days within Gauteng.',
    payment:
      'We accept EFT and card. We will never change our banking details by email or WhatsApp; always confirm by phone first.',
  },
  faqs: [
    {
      q: 'do you give quotes',
      a: 'Yes, free quotes are provided within 24 hours of receiving your request.',
    },
  ],
  escalate_keywords: [
    'lawyer',
    'legal action',
    'sue',
    'fraud',
    'chargeback',
    'media',
    'ombud',
  ],
};

// ============================================================================
// 1. SUPABASE CLIENT INITIALIZATION
// ============================================================================
function isSupabaseLiveConfigured() {
  const url = SUPABASE_CONFIG.SUPABASE_URL || '';
  const key = SUPABASE_CONFIG.SUPABASE_ANON_KEY || '';
  if (!url || !key) return false;
  if (url.includes('YOUR_PROJECT_REF') || key.includes('YOUR_SUPABASE_ANON_PUBLIC_KEY')) return false;
  // This checkout must not talk to the hosted project.
  if (url.includes('xgihyjvktkkjcroezqyx')) {
    console.error('Refusing to connect to the hosted Supabase project.');
    return false;
  }
  return true;
}

const supabaseClient =
  window.supabase && typeof window.supabase.createClient === 'function' && isSupabaseLiveConfigured()
    ? window.supabase.createClient(SUPABASE_CONFIG.SUPABASE_URL, SUPABASE_CONFIG.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

const STORAGE_KEYS = {
  DEMO_SESSION: 'refund_demo_session_v3',
  PROFILES: 'refund_db_profiles_v3',
  ORDERS: 'refund_db_orders_v3',
  ORDER_ITEMS: 'refund_db_order_items_v3',
  RETURNS: 'refund_db_returns_v3',
  RETURN_LOGS: 'refund_db_return_logs_v3',
  CONTACT_REQUESTS: 'refund_db_contact_requests_v3',
  COURIER_TRACKING: 'refund_db_courier_tracking_v3',
  LOGIN_LOGS: 'refund_db_login_logs_v3',
  WISHLIST: 'refund_wishlist_v2',
  CART: 'refund_cart_v2',
};

// ============================================================================
// 2. SEED DATA FROM 20261113120100_seed_dummy_data.sql
// ============================================================================

// South African public holidays (2026 & 2027)
const SEED_PUBLIC_HOLIDAYS = [
  { holiday_date: '2026-01-01', name: "New Year's Day" },
  { holiday_date: '2026-03-21', name: 'Human Rights Day' },
  { holiday_date: '2026-04-03', name: 'Good Friday' },
  { holiday_date: '2026-04-06', name: 'Family Day' },
  { holiday_date: '2026-04-27', name: 'Freedom Day' },
  { holiday_date: '2026-05-01', name: "Workers' Day" },
  { holiday_date: '2026-06-16', name: 'Youth Day' },
  { holiday_date: '2026-08-09', name: "National Women's Day" },
  { holiday_date: '2026-08-10', name: "National Women's Day (observed)" },
  { holiday_date: '2026-09-24', name: 'Heritage Day' },
  { holiday_date: '2026-12-16', name: 'Day of Reconciliation' },
  { holiday_date: '2026-12-25', name: 'Christmas Day' },
  { holiday_date: '2026-12-26', name: 'Day of Goodwill' },
  { holiday_date: '2027-01-01', name: "New Year's Day" },
  { holiday_date: '2027-03-21', name: 'Human Rights Day' },
  { holiday_date: '2027-03-22', name: 'Human Rights Day (observed)' },
  { holiday_date: '2027-03-26', name: 'Good Friday' },
  { holiday_date: '2027-03-29', name: 'Family Day' },
  { holiday_date: '2027-04-27', name: 'Freedom Day' },
  { holiday_date: '2027-05-01', name: "Workers' Day" },
  { holiday_date: '2027-06-16', name: 'Youth Day' },
  { holiday_date: '2027-08-09', name: "National Women's Day" },
  { holiday_date: '2027-09-24', name: 'Heritage Day' },
  { holiday_date: '2027-12-16', name: 'Day of Reconciliation' },
  { holiday_date: '2027-12-25', name: 'Christmas Day' },
  { holiday_date: '2027-12-26', name: 'Day of Goodwill' },
  { holiday_date: '2027-12-27', name: 'Day of Goodwill (observed)' },
];

// Customer service staff
const SEED_EMPLOYEES = [
  {
    id: '00000000-0000-4000-b000-000000000001',
    user_id: null,
    full_name: 'Demo Agent One',
    email: 'agent.one@example.com',
    role: 'customer_service',
    is_active: true,
  },
  {
    id: '00000000-0000-4000-b000-000000000002',
    user_id: null,
    full_name: 'Demo Agent Two',
    email: 'agent.two@example.com',
    role: 'customer_service',
    is_active: true,
  },
];

/**
 * 12 Storefront Products (6 Food + 6 Clothes in South African Rand R)
 * Mirrors `public.products` in `20261113120100_seed_dummy_data.sql` and `seed_database.sql`.
 */
const STORE_CATALOG_PRODUCTS = [
  // ==========================================================================
  // 🍔 FOOD CATEGORY (category = 'food')
  // ==========================================================================
  {
    id: 'food-1',
    sku: 'SKU-FOOD-BURGER',
    title: 'Double Smash Wagyu Burger & Rosemary Fries',
    name: 'Double Smash Wagyu Burger & Rosemary Fries',
    category: 'food',
    subcategory: 'Gourmet Burgers',
    price: 145.0,
    stock_quantity: 45,
    on_sale: false,
    prepTime: '15–20 mins',
    dietary: ['100% Wagyu Beef', 'Rosemary Fries Included'],
    options: ['Medium Well (Standard)', 'Well Done', 'Gluten-Free Bun', 'Extra Burger Sauce'],
    nutrition: { calories: '820 kcal', protein: '48g', carbs: '54g' },
    description:
      'Two 100g smashed Wagyu beef patties, aged cheddar, caramelized onions, house burger sauce on a toasted brioche bun with hand-cut rosemary salted fries.',
    image:
      'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80',
    image_url:
      'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'food-2',
    sku: 'SKU-FOOD-PIZZA',
    title: 'Wood-Fired Margherita & Burrata Pizza',
    name: 'Wood-Fired Margherita & Burrata Pizza',
    category: 'food',
    subcategory: 'Artisan Pizza',
    price: 165.0,
    stock_quantity: 35,
    on_sale: false,
    prepTime: '15 mins',
    dietary: ['Vegetarian', '48h Sourdough'],
    options: ['Whole Burrata Center', 'Chili Oil on Side', 'Gluten-Free Base'],
    nutrition: { calories: '790 kcal', protein: '32g', carbs: '86g' },
    description:
      'San Marzano tomato base, fresh creamy burrata, basil leaves, and extra virgin olive oil on a 48-hour fermented sourdough crust.',
    image:
      'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=80',
    image_url:
      'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'food-3',
    sku: 'SKU-FOOD-CHICKEN',
    title: 'Peri-Peri Flame-Grilled Half Chicken Meal',
    name: 'Peri-Peri Flame-Grilled Half Chicken Meal',
    category: 'food',
    subcategory: 'Flame-Grilled',
    price: 135.0,
    stock_quantity: 40,
    on_sale: false,
    prepTime: '20 mins',
    dietary: ['High Protein', 'Halal Friendly'],
    options: ['Hot Peri-Peri', 'Mild Peri-Peri', 'Tangy Lemon & Herb'],
    nutrition: { calories: '740 kcal', protein: '62g', carbs: '48g' },
    description:
      'Flame-grilled half chicken basted in tangy lemon and herb or hot peri-peri sauce, served with spicy rice and grilled corn.',
    image:
      'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?auto=format&fit=crop&w=900&q=80',
    image_url:
      'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'food-4',
    sku: 'SKU-FOOD-PASTA',
    title: 'Creamy Truffle Mushroom Tagliatelle',
    name: 'Creamy Truffle Mushroom Tagliatelle',
    category: 'food',
    subcategory: 'Fresh Pasta',
    price: 155.0,
    stock_quantity: 30,
    on_sale: false,
    prepTime: '15 mins',
    dietary: ['Vegetarian', 'Aged Parmigiano'],
    options: ['Standard Portion', 'Extra Parmigiano', 'Gluten-Free Penne'],
    nutrition: { calories: '710 kcal', protein: '24g', carbs: '72g' },
    description:
      'Fresh ribbon pasta tossed in a wild forest mushroom and black truffle cream reduction, topped with aged Parmigiano-Reggiano.',
    image:
      'https://images.unsplash.com/photo-1621996346565-e3d5d6281298?auto=format&fit=crop&w=900&q=80',
    image_url:
      'https://images.unsplash.com/photo-1621996346565-e3d5d6281298?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'food-5',
    sku: 'SKU-FOOD-WINGS',
    title: 'Crispy Korean Gochujang Chicken Wings (8 pc)',
    name: 'Crispy Korean Gochujang Chicken Wings (8 pc)',
    category: 'food',
    subcategory: 'Street Kitchen',
    price: 110.0,
    stock_quantity: 55,
    on_sale: false,
    prepTime: '14 mins',
    dietary: ['8 Pieces', 'Toasted Sesame'],
    options: ['Sticky Gochujang Glaze', 'Sauce on Side', 'Extra Spring Onion'],
    nutrition: { calories: '660 kcal', protein: '44g', carbs: '32g' },
    description:
      'Double-fried crispy chicken wings glazed in sweet and spicy sticky Gochujang sauce with toasted sesame seeds and spring onion.',
    image:
      'https://images.unsplash.com/photo-1527477396000-e27163b481c2?auto=format&fit=crop&w=900&q=80',
    image_url:
      'https://images.unsplash.com/photo-1527477396000-e27163b481c2?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'food-6',
    sku: 'SKU-FOOD-MATCHA',
    title: 'Artisan Iced Matcha & Vanilla Bean Latte',
    name: 'Artisan Iced Matcha & Vanilla Bean Latte',
    category: 'food',
    subcategory: 'Craft Beverages',
    price: 65.0,
    stock_quantity: 80,
    on_sale: false,
    prepTime: '5 mins',
    dietary: ['Oat Milk', 'Plant-Based'],
    options: ['Oat Milk (Standard)', 'Almond Milk', 'Less Ice'],
    nutrition: { calories: '140 kcal', protein: '4g', carbs: '19g' },
    description:
      'Ceremonial-grade Uji matcha whisked over ice with oat milk and house-made Madagascar vanilla bean syrup.',
    image:
      'https://images.unsplash.com/photo-1515823064-d6e0c04616a7?auto=format&fit=crop&w=900&q=80',
    image_url:
      'https://images.unsplash.com/photo-1515823064-d6e0c04616a7?auto=format&fit=crop&w=900&q=80',
  },

  // ==========================================================================
  // 👕 CLOTHES CATEGORY (category = 'clothes')
  // ==========================================================================
  {
    id: 'clothes-1',
    sku: 'SKU-CLOTHES-HOODIE',
    title: 'Heavyweight Boxy Essential Hoodie (Jet Black)',
    name: 'Heavyweight Boxy Essential Hoodie (Jet Black)',
    category: 'clothes',
    subcategory: 'Outerwear & Fleece',
    price: 650.0,
    stock_quantity: 28,
    on_sale: false,
    fit: 'Boxy Drop-Shoulder',
    material: '450GSM Organic Cotton',
    options: ['Size L', 'Size M', 'Size S', 'Size XL'],
    description:
      '450GSM 100% brushed organic cotton fleece with drop shoulders, double-lined hood, and minimalist ribbed cuffs. Available in S, M, L, XL.',
    image:
      'https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=900&q=80',
    image_url:
      'https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'clothes-2',
    sku: 'SKU-CLOTHES-TEE',
    title: 'Oversized Graphic Streetwear Tee (Off-White)',
    name: 'Oversized Graphic Streetwear Tee (Off-White)',
    category: 'clothes',
    subcategory: 'Tops & Tees',
    price: 350.0,
    stock_quantity: 60,
    on_sale: false,
    fit: 'Relaxed Boxy Fit',
    material: '280GSM Combed Cotton',
    options: ['Size L', 'Size M', 'Size S', 'Size XL'],
    description:
      '280GSM heavyweight combed cotton tee featuring a relaxed boxy fit and high-density puff print back graphic.',
    image:
      'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80',
    image_url:
      'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'clothes-3',
    sku: 'SKU-CLOTHES-CARGO',
    title: 'Tactical Multi-Pocket Cargo Pants (Olive Drab)',
    name: 'Tactical Multi-Pocket Cargo Pants (Olive Drab)',
    category: 'clothes',
    subcategory: 'Trousers & Cargo',
    price: 780.0,
    stock_quantity: 24,
    on_sale: false,
    fit: 'Relaxed Tapered',
    material: 'Ripstop Cotton-Blend',
    options: ['32 Waist', '30 Waist', '34 Waist', '36 Waist'],
    description:
      'Durable ripstop cotton-blend cargo trousers with adjustable ankle toggles, articulated knees, and six utility pockets.',
    image:
      'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=900&q=80',
    image_url:
      'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'clothes-4',
    sku: 'SKU-CLOTHES-SNEAKERS',
    title: 'Retro Low-Top Leather Court Sneakers',
    name: 'Retro Low-Top Leather Court Sneakers',
    category: 'clothes',
    subcategory: 'Footwear',
    price: 1250.0,
    stock_quantity: 18,
    on_sale: false,
    fit: 'True to Size',
    material: 'Full-Grain Leather',
    options: ['Size UK 9', 'Size UK 8', 'Size UK 10', 'Size UK 11'],
    description:
      'Full-grain white and slate leather upper with perforated toe box, cushioned OrthoLite insole, and vintage gum rubber cupsole.',
    image:
      'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=900&q=80',
    image_url:
      'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'clothes-5',
    sku: 'SKU-CLOTHES-JACKET',
    title: 'Water-Resistant Nylon Coach Jacket (Charcoal)',
    name: 'Water-Resistant Nylon Coach Jacket (Charcoal)',
    category: 'clothes',
    subcategory: 'Jackets',
    price: 890.0,
    stock_quantity: 22,
    on_sale: false,
    fit: 'Regular Outerwear Fit',
    material: 'Matte Nylon & Fleece',
    options: ['Size L', 'Size M', 'Size XL'],
    description:
      'Lightweight matte nylon shell with snap-button front closure, soft fleece lining, and drawcord hem.',
    image:
      'https://images.unsplash.com/photo-1544441893-675973e31985?auto=format&fit=crop&w=900&q=80',
    image_url:
      'https://images.unsplash.com/photo-1544441893-675973e31985?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'clothes-6',
    sku: 'SKU-CLOTHES-BEANIE',
    title: 'Merino Wool Ribbed Beanie (Slate Grey)',
    name: 'Merino Wool Ribbed Beanie (Slate Grey)',
    category: 'clothes',
    subcategory: 'Accessories',
    price: 220.0,
    stock_quantity: 50,
    on_sale: false,
    fit: 'One Size Cuffed',
    material: '100% Merino Wool',
    options: ['One Size (Slate Grey)', 'One Size (Jet Black)'],
    description:
      'Soft, breathable 100% Merino wool fisherman-style cuffed beanie for everyday wear.',
    image:
      'https://images.unsplash.com/photo-1576871337632-b9aef4c17ab9?auto=format&fit=crop&w=900&q=80',
    image_url:
      'https://images.unsplash.com/photo-1576871337632-b9aef4c17ab9?auto=format&fit=crop&w=900&q=80',
  },
];

const SKU_IMAGE_MAP = Object.fromEntries(
  STORE_CATALOG_PRODUCTS.map((p) => [p.sku, p.image_url])
);

function getProductImageForSku(sku) {
  if (SKU_IMAGE_MAP[sku]) return SKU_IMAGE_MAP[sku];
  const found = STORE_CATALOG_PRODUCTS.find((p) => p.sku === sku || p.id === sku);
  return (
    found?.image_url ||
    'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=600&q=80'
  );
}

/**
 * Builds the 4 comprehensive sample orders (`REF-2026-10482`, `REF-2026-10479`,
 * `REF-2026-10315`, `REF-2026-10450`) and their pre-populated refund & escalation records.
 */
function buildSeedOrdersAndItems() {
  const now = Date.now();
  const dayMs = 1000 * 60 * 60 * 24;
  const demoUserId = '00000000-0000-0000-0000-000000000001';

  const orders = [
    // 1. Order REF-2026-10482 (Status: Processing | Purchased Today — Eligible for Cancel or Refund)
    {
      id: '00000000-0000-4000-8000-000000010482',
      order_number: 'REF-2026-10482',
      order_code: 'REF-2026-10482',
      shop_name: 'Refund Sandton Kitchen',
      customer_email: 'customer.one@example.com',
      user_id: demoUserId,
      status: 'pending',
      display_status: 'Processing',
      ordered_at: new Date(now - 1000 * 60 * 45).toISOString(),
      delivered_at: null,
      total_amount: 210.0,
      currency: 'ZAR',
      payment_method: 'Google Pay',
      shipping_address: '123 Example Street, Sandton, Johannesburg',
      created_at: new Date(now - 1000 * 60 * 45).toISOString(),
      updated_at: new Date(now - 1000 * 60 * 45).toISOString(),
    },
    // 2. Order REF-2026-10479 (Status: Completed | Purchased 2 Days Ago — Within the 14-day return window)
    {
      id: '00000000-0000-4000-8000-000000010479',
      order_number: 'REF-2026-10479',
      order_code: 'REF-2026-10479',
      shop_name: 'Refund Studio Apparel',
      customer_email: 'customer.one@example.com',
      user_id: demoUserId,
      status: 'delivered',
      display_status: 'Completed',
      ordered_at: new Date(now - 2 * dayMs).toISOString(),
      delivered_at: new Date(now - 1 * dayMs).toISOString(),
      total_amount: 1000.0,
      currency: 'ZAR',
      payment_method: 'Credit Card',
      shipping_address: '123 Example Street, Sandton, Johannesburg',
      created_at: new Date(now - 2 * dayMs).toISOString(),
      updated_at: new Date(now - 1 * dayMs).toISOString(),
    },
    // 3. Order REF-2026-10315 (Status: Completed | Purchased 20 Days Ago — Outside the 14-day return window)
    {
      id: '00000000-0000-4000-8000-000000010315',
      order_number: 'REF-2026-10315',
      order_code: 'REF-2026-10315',
      shop_name: 'Refund Studio Apparel',
      customer_email: 'customer.one@example.com',
      user_id: demoUserId,
      status: 'delivered',
      display_status: 'Completed',
      ordered_at: new Date(now - 12 * dayMs).toISOString(),
      delivered_at: new Date(now - 12 * dayMs).toISOString(),
      total_amount: 1250.0,
      currency: 'ZAR',
      payment_method: 'Credit Card',
      shipping_address: '123 Example Street, Sandton, Johannesburg',
      created_at: new Date(now - 12 * dayMs).toISOString(),
      updated_at: new Date(now - 12 * dayMs).toISOString(),
    },
    // 4. Order REF-2026-10450 (Status: Refund Approved | Purchased 3 Days Ago — Pre-populated Approved Refund Example)
    {
      id: '00000000-0000-4000-8000-000000010450',
      order_number: 'REF-2026-10450',
      order_code: 'REF-2026-10450',
      shop_name: 'Refund Sandton Kitchen',
      customer_email: 'customer.one@example.com',
      user_id: demoUserId,
      status: 'delivered',
      display_status: 'Refund Approved',
      ordered_at: new Date(now - 3 * dayMs).toISOString(),
      delivered_at: new Date(now - 3 * dayMs).toISOString(),
      total_amount: 135.0,
      currency: 'ZAR',
      payment_method: 'Google Pay',
      shipping_address: '123 Example Street, Sandton, Johannesburg',
      created_at: new Date(now - 3 * dayMs).toISOString(),
      updated_at: new Date(now - 2 * dayMs).toISOString(),
    },
  ];

  const orderItems = [
    // REF-2026-10482 Items (R210.00)
    {
      id: '00000000-0000-4000-9000-000000010482',
      order_id: '00000000-0000-4000-8000-000000010482',
      order_number: 'REF-2026-10482',
      sku: 'SKU-FOOD-BURGER',
      product_name: 'Double Smash Wagyu Burger & Rosemary Fries',
      name: 'Double Smash Wagyu Burger & Rosemary Fries',
      quantity: 1,
      unit_price: 145.0,
      price: 145.0,
      on_sale: false,
      category: 'food',
      image_url: getProductImageForSku('SKU-FOOD-BURGER'),
      created_at: orders[0].ordered_at,
    },
    {
      id: '00000000-0000-4000-9000-000000010483',
      order_id: '00000000-0000-4000-8000-000000010482',
      order_number: 'REF-2026-10482',
      sku: 'SKU-FOOD-MATCHA',
      product_name: 'Artisan Iced Matcha & Vanilla Bean Latte',
      name: 'Artisan Iced Matcha & Vanilla Bean Latte',
      quantity: 1,
      unit_price: 65.0,
      price: 65.0,
      on_sale: false,
      category: 'food',
      image_url: getProductImageForSku('SKU-FOOD-MATCHA'),
      created_at: orders[0].ordered_at,
    },
    // REF-2026-10479 Items (R1,000.00)
    {
      id: '00000000-0000-4000-9000-000000010479',
      order_id: '00000000-0000-4000-8000-000000010479',
      order_number: 'REF-2026-10479',
      sku: 'SKU-CLOTHES-HOODIE',
      product_name: 'Heavyweight Boxy Essential Hoodie (Jet Black, Size L)',
      name: 'Heavyweight Boxy Essential Hoodie (Jet Black, Size L)',
      quantity: 1,
      unit_price: 650.0,
      price: 650.0,
      on_sale: false,
      category: 'clothes',
      image_url: getProductImageForSku('SKU-CLOTHES-HOODIE'),
      created_at: orders[1].ordered_at,
    },
    {
      id: '00000000-0000-4000-9000-000000010480',
      order_id: '00000000-0000-4000-8000-000000010479',
      order_number: 'REF-2026-10479',
      sku: 'SKU-CLOTHES-TEE',
      product_name: 'Oversized Graphic Streetwear Tee (Off-White, Size L)',
      name: 'Oversized Graphic Streetwear Tee (Off-White, Size L)',
      quantity: 1,
      unit_price: 350.0,
      price: 350.0,
      on_sale: false,
      category: 'clothes',
      image_url: getProductImageForSku('SKU-CLOTHES-TEE'),
      created_at: orders[1].ordered_at,
    },
    // REF-2026-10315 Items (R1,250.00)
    {
      id: '00000000-0000-4000-9000-000000010315',
      order_id: '00000000-0000-4000-8000-000000010315',
      order_number: 'REF-2026-10315',
      sku: 'SKU-CLOTHES-SNEAKERS',
      product_name: 'Retro Low-Top Leather Court Sneakers (Size UK 9)',
      name: 'Retro Low-Top Leather Court Sneakers (Size UK 9)',
      quantity: 1,
      unit_price: 1250.0,
      price: 1250.0,
      on_sale: false,
      category: 'clothes',
      image_url: getProductImageForSku('SKU-CLOTHES-SNEAKERS'),
      created_at: orders[2].ordered_at,
    },
    // REF-2026-10450 Items (R135.00)
    {
      id: '00000000-0000-4000-9000-000000010450',
      order_id: '00000000-0000-4000-8000-000000010450',
      order_number: 'REF-2026-10450',
      sku: 'SKU-FOOD-CHICKEN',
      product_name: 'Peri-Peri Flame-Grilled Half Chicken Meal',
      name: 'Peri-Peri Flame-Grilled Half Chicken Meal',
      quantity: 1,
      unit_price: 135.0,
      price: 135.0,
      on_sale: false,
      category: 'food',
      image_url: getProductImageForSku('SKU-FOOD-CHICKEN'),
      created_at: orders[3].ordered_at,
    },
  ];

  // 3. Pre-populated Refund Records (Approved Refund for REF-2026-10450 & Declined Return for REF-2026-10315)
  const returns = [
    {
      id: '00000000-0000-4000-a000-000000010450',
      user_id: demoUserId,
      order_id: '00000000-0000-4000-8000-000000010450',
      order_number: 'REF-2026-10450',
      order_item_id: '00000000-0000-4000-9000-000000010450',
      sku: 'SKU-FOOD-CHICKEN',
      product_name: 'Peri-Peri Flame-Grilled Half Chicken Meal',
      quantity: 1,
      unit_price: 135.0,
      refund_amount: 135.0,
      reason: 'Food arrived cold or damaged',
      notes: 'The container opened during courier transit and the meal was cold upon arrival.',
      status: 'approved',
      display_status: 'Approved',
      ai_decision: 'APPROVED',
      ai_reason:
        'Approved under our 14-day return window. Order was delivered within 14 days with verified Google Pay proof of payment and reported transit damage.',
      ai_decision_reason:
        'Approved under our 14-day return window. Order was delivered within 14 days with verified Google Pay proof of payment and reported transit damage.',
      flags: [],
      decided_by: null,
      decided_at: new Date(now - 2 * dayMs).toISOString(),
      created_at: new Date(now - 2 * dayMs).toISOString(),
      updated_at: new Date(now - 2 * dayMs).toISOString(),
    },
    {
      id: '00000000-0000-4000-a000-000000010315',
      user_id: demoUserId,
      order_id: '00000000-0000-4000-8000-000000010315',
      order_number: 'REF-2026-10315',
      order_item_id: '00000000-0000-4000-9000-000000010315',
      sku: 'SKU-CLOTHES-SNEAKERS',
      product_name: 'Retro Low-Top Leather Court Sneakers (Size UK 9)',
      quantity: 1,
      unit_price: 1250.0,
      refund_amount: 1250.0,
      reason: "Wrong size, I need to speak to a manager or ombud if this isn't resolved.",
      notes: 'Customer requested size exchange/refund after 20 days and mentioned ombud escalation.',
      status: 'rejected',
      display_status: 'Rejected',
      ai_decision: 'DECLINED',
      ai_reason:
        'Declined by AI: Order REF-2026-10315 was purchased 20 days ago, which is outside our 14-day return window.',
      ai_decision_reason:
        'Declined by AI: Order REF-2026-10315 was purchased 20 days ago, which is outside our 14-day return window.',
      flags: ['escalate:ombud'],
      decided_by: null,
      decided_at: new Date(now - 1 * dayMs).toISOString(),
      created_at: new Date(now - 1 * dayMs).toISOString(),
      updated_at: new Date(now - 1 * dayMs).toISOString(),
    },
  ];

  // 4. Sample Escalated Appeal Record (in public.contact_requests for REF-2026-10315)
  const summaryBody = [
    '====================================================================',
    'REFUND ESCALATION SUMMARY — APPEAL',
    'To: info@example.co.za (Refund Owner / Manager)',
    'Order Reference: REF-2026-10315',
    '====================================================================',
    '',
    '1. CUSTOMER DETAILS',
    'Full Name:        Customer One',
    'Email Address:    customer.one@example.com',
    'Phone Number:     +27 82 111 2222',
    'Delivery Address: 123 Example Street, Sandton, Johannesburg',
    '',
    '2. ORDER BREAKDOWN',
    'Order ID:         REF-2026-10315 (Delivered 20 Days Ago)',
    'Payment Method:   Credit Card',
    'Items:            1x Retro Low-Top Leather Court Sneakers (Size UK 9) — R1,250.00',
    'Total Amount:     R1,250.00',
    '',
    '3. INITIAL AI DECISION & CUSTOMER APPEAL',
    'Initial AI Decision: DECLINED (Order delivered 20 days ago — outside the 14-day return window)',
    'Customer Reason:     "Wrong size, I need to speak to a manager or ombud if this isn\'t resolved."',
    'Flags Triggered:     ["escalate:ombud"]',
    'Recipient Email:     info@example.co.za',
    '====================================================================',
  ].join('\n');

  const contactRequests = [
    {
      id: '00000000-0000-4000-c000-000000010315',
      user_id: demoUserId,
      type: 'appeal',
      return_id: '00000000-0000-4000-a000-000000010315',
      order_number: 'REF-2026-10315',
      order_reference: 'REF-2026-10315',
      subject: '[ESCALATION - Appeal] Order REF-2026-10315 — Customer One (R1,250.00)',
      message: summaryBody,
      email_body: summaryBody,
      status: 'open',
      outside_business_hours: true,
      forward_to_human: true,
      flags: ['escalate:ombud'],
      flags_triggered: ['escalate:ombud'],
      recipient_email: 'info@example.co.za',
      customer_email: 'customer.one@example.com',
      customer_name: 'Customer One',
      created_at: new Date(now - 1 * dayMs).toISOString(),
      updated_at: new Date(now - 1 * dayMs).toISOString(),
    },
  ];

  return { orders, orderItems, returns, contactRequests };
}

// ============================================================================
// 3. LOCALSTORAGE PERSISTENCE & BUSINESS HOURS HELPERS
// ============================================================================
function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('[RefundBackend] localStorage warning:', err);
  }
}

function formatRand(amount) {
  const num = Number(amount || 0);
  return `R${num.toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function isBusinessHours(atTime = new Date()) {
  const dateObj = atTime instanceof Date ? atTime : new Date(atTime);
  const saFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(saFormatter.formatToParts(dateObj).map((p) => [p.type, p.value]));
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour || 0);
  const weekday = parts.weekday;

  const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
  if (!isWeekday) return false;
  if (hour < 8 || hour >= 17) return false;

  const isHoliday = SEED_PUBLIC_HOLIDAYS.some((h) => h.holiday_date === dateStr);
  return !isHoliday;
}

function nextBusinessOpening(fromTime = new Date()) {
  const start = fromTime instanceof Date ? new Date(fromTime.getTime()) : new Date(fromTime);
  if (isBusinessHours(start)) return start.toISOString();

  const probe = new Date(start.getTime());
  for (let i = 0; i < 14; i++) {
    if (i > 0 || probe.getUTCHours() + 2 >= 8) {
      probe.setUTCDate(probe.getUTCDate() + 1);
    }
    probe.setUTCHours(6, 0, 0, 0);
    if (isBusinessHours(probe)) {
      return probe.toISOString();
    }
  }
  return probe.toISOString();
}

function ensureSeededDatabase() {
  let orders = loadJson(STORAGE_KEYS.ORDERS, null);
  let orderItems = loadJson(STORAGE_KEYS.ORDER_ITEMS, null);
  let returns = loadJson(STORAGE_KEYS.RETURNS, null);
  let contactRequests = loadJson(STORAGE_KEYS.CONTACT_REQUESTS, null);

  if (
    !Array.isArray(orders) ||
    orders.length === 0 ||
    !Array.isArray(orderItems) ||
    orderItems.length === 0
  ) {
    const seeded = buildSeedOrdersAndItems();
    orders = seeded.orders;
    orderItems = seeded.orderItems;
    returns = seeded.returns;
    contactRequests = seeded.contactRequests;
    saveJson(STORAGE_KEYS.ORDERS, orders);
    saveJson(STORAGE_KEYS.ORDER_ITEMS, orderItems);
    saveJson(STORAGE_KEYS.RETURNS, returns);
    saveJson(STORAGE_KEYS.CONTACT_REQUESTS, contactRequests);
  } else {
    if (!Array.isArray(returns)) {
      const seeded = buildSeedOrdersAndItems();
      returns = seeded.returns;
      saveJson(STORAGE_KEYS.RETURNS, returns);
    }
    if (!Array.isArray(contactRequests)) {
      const seeded = buildSeedOrdersAndItems();
      contactRequests = seeded.contactRequests;
      saveJson(STORAGE_KEYS.CONTACT_REQUESTS, contactRequests);
    }
  }
  return { orders, orderItems, returns, contactRequests };
}

// ============================================================================
// 4. REPLY ENGINE (Mirrors reply_engine.py + business.json)
// ============================================================================
const ReplyEngineJS = (() => {
  const INTENT_PATTERNS = {
    hours: /\b(hours|open|close|closed|opening|weekend|sunday|saturday|time)\b/i,
    location: /\b(where|address|location|based|directions|branch|sandton)\b/i,
    contact: /\b(phone|call|whatsapp|email|contact|reach|number)\b/i,
    refund: /\b(refund|return|money back|cancel|exchange|damaged|cold|wrong item|defective)\b/i,
    delivery: /\b(deliver|delivery|shipping|courier|how long|dispatch|gauteng|waybill)\b/i,
    payment: /\b(pay|payment|eft|card|bank|banking|invoice|account details)\b/i,
    price: /\b(price|cost|how much|rate|fee|quote|pricing|charge)\b/i,
    complaint:
      /\b(angry|terrible|worst|unacceptable|disgusted|complain|complaint|horrible|useless|pathetic)\b/i,
    human: /\b(human|person|agent|manager|owner|someone|speak to|talk to|appeal)\b/i,
    greeting: /^\s*(hi|hello|hey|good (morning|afternoon|evening)|howzit)\b/i,
    thanks: /\b(thanks|thank you|appreciate|cheers)\b/i,
  };

  const SCAM_PATTERNS = [
    /(changed|new|updated)\s+(our\s+)?(bank|banking|account|eft)/i,
    /pay\s+into\s+(this|a\s+different|new)\s+account/i,
    /urgent\s+payment\s+redirect/i,
    /\b(otp|pin|cvv|gift\s*cards?)\b/i,
  ];

  function classify(msg) {
    const text = String(msg || '');
    const scores = {};
    Object.entries(INTENT_PATTERNS).forEach(([intent, pat]) => {
      const matches = text.match(new RegExp(pat.source, 'gi'));
      if (matches && matches.length > 0) {
        scores[intent] = matches.length;
      }
    });

    if (Object.keys(scores).length === 0) {
      return { intent: 'refund', confidence: 0.55 };
    }

    const priority = [
      'human',
      'complaint',
      'refund',
      'payment',
      'delivery',
      'price',
      'hours',
      'location',
      'contact',
      'greeting',
      'thanks',
    ];
    let best = Object.keys(scores)[0];
    let bestScore = scores[best];

    Object.entries(scores).forEach(([intent, count]) => {
      if (
        count > bestScore ||
        (count === bestScore && priority.indexOf(intent) < priority.indexOf(best))
      ) {
        best = intent;
        bestScore = count;
      }
    });

    const conf = Math.min(0.95, 0.55 + 0.15 * scores[best]);
    return { intent: best, confidence: Number(conf.toFixed(2)) };
  }

  function flags(msg, biz = BUSINESS_PROFILE) {
    const out = [];
    const low = String(msg || '').toLowerCase();

    (biz.escalate_keywords || []).forEach((kw) => {
      if (low.includes(String(kw).toLowerCase())) {
        out.push(`escalate:${kw}`);
      }
    });

    if (SCAM_PATTERNS.some((p) => p.test(String(msg || '')))) {
      out.push('possible_scam_or_payment_redirect');
    }

    return out;
  }

  function facts_for(intent, biz = BUSINESS_PROFILE) {
    const c = biz.currency || 'R';
    if (intent === 'hours') {
      const h = Object.entries(biz.hours || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      return `Hours: ${h}.`;
    }
    if (intent === 'location') {
      return `Location: ${biz.location || 'not listed'}.`;
    }
    if (intent === 'contact') {
      const ct = biz.contact || {};
      return `Phone: ${ct.phone || '-'}, Email: ${ct.email || '-'}, WhatsApp: ${ct.whatsapp || '-'}.`;
    }
    if (intent === 'price') {
      const sv = (biz.services || []).map((s) => `${s.name}: ${c}${s.price} (${s.unit || ''})`);
      return sv.length ? `Services: ${sv.join('; ')}.` : '';
    }
    if (intent === 'refund' || intent === 'delivery' || intent === 'payment') {
      return (biz.policies || {})[intent] || '';
    }
    return '';
  }

  function _draft(intent, biz = BUSINESS_PROFILE, flagList = []) {
    const name = biz.name || 'Returns Trade Agent';
    const sign = biz.signoff || `Kind regards,\nThe Returns Trade Agent Team`;
    const ct = biz.contact || {};
    const reach = `You can reach us on ${ct.phone || '+27 11 000 0000'} or ${ct.email || 'info@example.co.za'}.`;

    const warn = flagList.includes('possible_scam_or_payment_redirect')
      ? '\n\nIMPORTANT: We never change banking details via message. Please verify any payment request by calling us directly.'
      : '';

    let body = '';
    if (intent === 'greeting') {
      body = `Hello! Welcome to ${name}. How can we help you today?`;
    } else if (intent === 'thanks') {
      body = `You're very welcome! Let us know if you need anything else.`;
    } else if (intent === 'complaint' || intent === 'human') {
      body = `Of course. A team member will be with you shortly. You can also call ${ct.phone || '+27 11 000 0000'} or WhatsApp ${ct.whatsapp || '+27 82 000 0000'}.`;
    } else {
      const fact = facts_for(intent, biz);
      body = fact
        ? `Thanks for getting in touch. ${fact} ${reach}`
        : `Thanks for your message. A team member will get back to you shortly. ${reach}`;
    }

    return `${body}${warn}\n\n${sign}`;
  }

  function handle(payload, biz = BUSINESS_PROFILE) {
    const msg = String(payload?.message || '').trim();
    if (!msg) {
      return {
        reply: '',
        intent: 'empty',
        confidence: 1.0,
        needs_human: false,
        flags: ['empty_message'],
      };
    }

    const low = msg.toLowerCase();
    for (const item of biz.faqs || []) {
      if (item.q && low.includes(item.q.toLowerCase())) {
        return {
          reply: `${item.a}\n\n${biz.signoff || ''}`.trim(),
          intent: 'faq',
          confidence: 0.9,
          needs_human: false,
          flags: flags(msg, biz),
        };
      }
    }

    const { intent, confidence } = classify(msg);
    const fl = flags(msg, biz);
    const reply = _draft(intent, biz, fl);
    const needs_human =
      fl.length > 0 ||
      intent === 'complaint' ||
      intent === 'human' ||
      intent === 'unknown' ||
      confidence < 0.5;

    return {
      reply,
      intent,
      confidence,
      needs_human,
      flags: fl,
    };
  }

  function getHumanEscalationReply(biz = BUSINESS_PROFILE) {
    const ct = biz.contact || {};
    const sign = biz.signoff || 'Kind regards,\nThe Returns Trade Agent Team';
    return `Of course. A team member will be with you shortly. You can also call ${ct.phone || '+27 11 000 0000'} or WhatsApp ${ct.whatsapp || '+27 82 000 0000'}.\n\n${sign}`;
  }

  return {
    INTENT_PATTERNS,
    SCAM_PATTERNS,
    classify,
    flags,
    facts_for,
    _draft,
    handle,
    getHumanEscalationReply,
  };
})();

// ============================================================================
// 5. DATABASE & AUTH HELPER FUNCTIONS
// ============================================================================
async function getActiveSessionUser() {
  if (supabaseClient) {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) console.warn('[RefundBackend] Session check:', error.message);
    return data?.session?.user || null;
  }
  return loadJson(STORAGE_KEYS.DEMO_SESSION, {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'customer.one@example.com',
    user_metadata: {
      full_name: 'Customer One',
      phone: '+27 82 111 2222',
    },
  });
}

function friendlyDbMessage(error) {
  const message = String(error?.message || '').trim();
  const details = String(error?.details || '').trim();
  const pick = message && !/^P0001$/i.test(message) ? message : details || message;
  return pick.replace(/^P0001:\s*/i, '') || 'The return was rejected.';
}

async function logAuthEvent(event, email) {
  if (!supabaseClient) return { ok: false };
  const { data, error } = await supabaseClient.functions.invoke(SUPABASE_CONFIG.AUTH_LOG_FUNCTION, {
    body: { event, email },
  });
  if (error) {
    console.warn('[RefundBackend] auth log failed:', error.message || error);
    return { ok: false };
  }
  return data || { ok: true };
}

async function signOutAndLog() {
  if (supabaseClient) {
    const { data } = await supabaseClient.auth.getSession();
    const email = data?.session?.user?.email || '';
    try {
      await supabaseClient.functions.invoke(SUPABASE_CONFIG.AUTH_LOG_FUNCTION, {
        body: { event: 'sign_out', email },
      });
    } catch (err) {
      console.warn('[RefundBackend] sign-out log failed:', err);
    }
    await supabaseClient.auth.signOut();
  }
  localStorage.removeItem(STORAGE_KEYS.DEMO_SESSION);
}

function setDemoSessionUser(userObj) {
  saveJson(STORAGE_KEYS.DEMO_SESSION, userObj);
  const logs = loadJson(STORAGE_KEYS.LOGIN_LOGS, []);
  logs.unshift({
    id: Date.now(),
    user_id: userObj?.id || null,
    email: userObj?.email || 'customer.one@example.com',
    event: 'sign_in',
    created_at: new Date().toISOString(),
  });
  saveJson(STORAGE_KEYS.LOGIN_LOGS, logs);
}

function getAllReturns() {
  const seeded = ensureSeededDatabase();
  return seeded.returns || [];
}

function getAllContactRequests() {
  const seeded = ensureSeededDatabase();
  return seeded.contactRequests || [];
}

async function fetchOrdersWithItems() {
  const seeded = ensureSeededDatabase();
  let orders = seeded.orders;
  let orderItems = seeded.orderItems;

  if (supabaseClient) {
    try {
      const { data: dbOrders, error: ordErr } = await supabaseClient
        .from('orders')
        .select('*, order_items(*)')
        .order('ordered_at', { ascending: false });

      if (ordErr) {
        console.warn('[RefundBackend] Could not load orders:', ordErr.message);
        orders = [];
        orderItems = [];
      } else {
        // Signed-in orders come from the database only. Local seed rows have
        // different ids and would fail the return insert.
        orders = (dbOrders || []).map((o) => {
          const num = o.order_number || o.order_code;
          const items = (o.order_items || []).map((it) => ({
            ...it,
            order_number: num,
            image_url: it.image_url || getProductImageForSku(it.sku),
          }));
          return {
            ...o,
            order_number: num,
            order_code: num,
            payment_method: o.payment_method || 'Credit Card',
            shipping_address:
              o.shipping_address || '123 Example Street, Sandton, Johannesburg',
            order_items: items,
          };
        });
        orderItems = orders.flatMap((o) => o.order_items || []);
        saveJson(STORAGE_KEYS.ORDERS, orders);
        saveJson(STORAGE_KEYS.ORDER_ITEMS, orderItems);
      }
    } catch (err) {
      console.warn('[RefundBackend] Using local seeded orders fallback:', err);
    }
  }

  const itemsByOrderId = new Map();
  orderItems.forEach((item) => {
    const key = item.order_id || item.order_number;
    if (!itemsByOrderId.has(key)) itemsByOrderId.set(key, []);
    itemsByOrderId.get(key).push({
      ...item,
      image_url: item.image_url || getProductImageForSku(item.sku),
    });
  });

  return orders.map((ord) => {
    const attached =
      itemsByOrderId.get(ord.id) ||
      itemsByOrderId.get(ord.order_number) ||
      ord.items ||
      [];
    const computedTotal =
      attached.length > 0
        ? attached.reduce(
            (sum, it) =>
              sum +
              Number(it.unit_price ?? it.price ?? 0) * Number(it.quantity || 1),
            0
          )
        : Number(ord.total_amount || 0);
    return {
      ...ord,
      order_number: ord.order_number || ord.order_code,
      order_code: ord.order_number || ord.order_code,
      total_amount: Number(computedTotal.toFixed(2)),
      order_items: attached,
      items: attached,
    };
  });
}

function dbItemCategory(item) {
  const raw = String(item?.category || '').toLowerCase();
  const sku = String(item?.sku || '');
  if (raw === 'food' || sku.toUpperCase().startsWith('SKU-FOOD-')) return 'food';
  return 'apparel';
}

async function createOrderWithItems({
  shopName = 'Returns Trade Agent',
  items = [],
  demo = false,
}) {
  const user = await getActiveSessionUser();
  const payload = (items || []).map((item) => ({
    sku: item.sku || item.productId,
    product_name: item.product_name || item.title || item.name,
    quantity: Number(item.quantity || 1),
    unit_price: Number(item.unit_price ?? item.price ?? 0),
    on_sale: Boolean(item.on_sale),
    category: dbItemCategory(item),
  }));

  if (supabaseClient) {
    if (!user?.id) {
      throw new Error('Sign in before placing an order.');
    }
    const { data, error } = await supabaseClient.rpc('place_order', {
      p_items: payload,
      p_shop_name: shopName,
      p_demo: Boolean(demo),
    });
    if (error) throw new Error(friendlyDbMessage(error));
    const saved = {
      ...data,
      id: data.id,
      order_number: data.order_number,
      order_code: data.order_number,
      status: data.status,
      total_amount: Number(data.total_amount),
      customer_email: data.customer_email,
      order_items: data.items || [],
      items: data.items || [],
      persisted: true,
    };
    return saved;
  }

  const seeded = ensureSeededDatabase();
  const orderNumber = `LOCAL-${Date.now().toString().slice(-6)}`;
  const nowIso = new Date().toISOString();
  const totalAmount = payload.reduce(
    (sum, item) => sum + item.unit_price * item.quantity,
    0
  );
  const newOrder = {
    id: crypto.randomUUID ? crypto.randomUUID() : `ord-${Date.now()}`,
    order_number: orderNumber,
    order_code: orderNumber,
    shop_name: shopName,
    customer_email: user?.email || 'customer.one@example.com',
    user_id: user?.id || null,
    status: 'pending',
    ordered_at: nowIso,
    delivered_at: null,
    total_amount: Number(totalAmount.toFixed(2)),
    currency: 'ZAR',
    order_items: payload,
    items: payload,
    persisted: false,
  };
  seeded.orders.unshift(newOrder);
  saveJson(STORAGE_KEYS.ORDERS, seeded.orders);
  return newOrder;
}

/**
 * Cancels items on an order that has not shipped yet (public.cancel_order_items).
 * items: [{ order_item_id, quantity }] or null for everything left on the order.
 * The database checks ownership and status, recomputes the total, and queues
 * the customer and owner emails.
 */
async function cancelOrderItems(orderId, items = null, reason = null) {
  if (!supabaseClient) throw new Error('Sign in to cancel an order.');
  const { data, error } = await supabaseClient.rpc('cancel_order_items', {
    p_order_id: orderId,
    p_items: items,
    p_reason: reason,
  });
  if (error) throw new Error(friendlyDbMessage(error));
  return data;
}

async function cancelOrderInBackend(orderNumber) {
  if (supabaseClient) {
    const { data: row, error } = await supabaseClient
      .from('orders')
      .select('id')
      .eq('order_number', orderNumber)
      .maybeSingle();
    if (error) throw new Error(friendlyDbMessage(error));
    if (row?.id) return cancelOrderItems(row.id, null, 'Cancelled from the orders page');
  }

  const seeded = ensureSeededDatabase();
  const target = seeded.orders.find(
    (o) => (o.order_number || o.order_code) === orderNumber
  );
  if (target) {
    target.status = 'cancelled';
    target.display_status = 'Cancelled';
    target.updated_at = new Date().toISOString();
    saveJson(STORAGE_KEYS.ORDERS, seeded.orders);
  }
  return target;
}

/**
 * Inserts a return row into `public.returns` and logs the status transition in `public.return_logs`.
 */
async function createReturnRecords({
  order,
  selectedItems,
  reason,
  notes,
  aiDecision,
  aiReason,
  flags = [],
  refundAmount = 0,
}) {
  const user = await getActiveSessionUser();
  const orderNum = order.order_number || order.order_code;

  if (supabaseClient) {
    if (!user?.id) throw new Error('Sign in before requesting a return.');
    const createdReturns = [];
    for (const item of selectedItems) {
      const { data: dbRet, error: retErr } = await supabaseClient
        .from('returns')
        .insert({
          user_id: user.id,
          order_id: order.id,
          order_item_id: item.id,
          quantity: Number(item.quantity || 1),
          reason,
          notes: notes || null,
        })
        .select()
        .single();
      if (retErr) throw new Error(friendlyDbMessage(retErr));

      const { data: logs } = await supabaseClient
        .from('return_logs')
        .select('*')
        .eq('return_id', dbRet.id)
        .order('created_at', { ascending: true });

      createdReturns.push({
        ...dbRet,
        order_number: orderNum,
        product_name: item.product_name || item.name,
        sku: item.sku,
        ai_decision: aiDecision,
        ai_reason: aiReason,
        flags,
        return_logs: logs || [],
      });
    }
    return createdReturns;
  }

  const seeded = ensureSeededDatabase();
  const returnsList = seeded.returns || [];
  const returnLogs = loadJson(STORAGE_KEYS.RETURN_LOGS, []);
  const nowIso = new Date().toISOString();

  const returnStatus = aiDecision === 'APPROVED' ? 'approved' : 'rejected';
  const createdReturns = [];

  for (const item of selectedItems) {
    const returnId = crypto.randomUUID
      ? crypto.randomUUID()
      : `ret-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const retRow = {
      id: returnId,
      user_id: user?.id || '00000000-0000-0000-0000-000000000001',
      order_id: order.id,
      order_number: orderNum,
      order_item_id: item.id,
      sku: item.sku,
      product_name: item.product_name || item.name,
      quantity: Number(item.quantity || 1),
      unit_price: Number(item.unit_price ?? item.price ?? 0),
      refund_amount: Number(refundAmount || order.total_amount || 0),
      reason,
      notes,
      status: returnStatus,
      display_status: aiDecision === 'APPROVED' ? 'Approved' : 'Rejected',
      ai_decision: aiDecision,
      ai_reason: aiReason,
      ai_decision_reason: aiReason,
      flags,
      decided_by: null,
      decided_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    };

    returnsList.unshift(retRow);
    createdReturns.push(retRow);

    returnLogs.unshift(
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        return_id: returnId,
        old_status: null,
        new_status: 'submitted',
        changed_by: user?.id || null,
        note: `Return submitted for ${retRow.product_name} (${retRow.sku})`,
        created_at: nowIso,
      },
      {
        id: Date.now() + Math.floor(Math.random() * 1000) + 1,
        return_id: returnId,
        old_status: 'submitted',
        new_status: returnStatus,
        changed_by: null,
        note: `AI Refund Adjudicator decision: ${aiDecision} — ${aiReason || ''}`,
        created_at: nowIso,
      }
    );
  }

  // Update order's display_status in local storage
  const targetOrd = seeded.orders.find(
    (o) => (o.order_number || o.order_code) === orderNum
  );
  if (targetOrd) {
    targetOrd.display_status =
      aiDecision === 'APPROVED' ? 'Refund Approved' : 'Refund Declined';
    saveJson(STORAGE_KEYS.ORDERS, seeded.orders);
  }

  saveJson(STORAGE_KEYS.RETURNS, returnsList);
  saveJson(STORAGE_KEYS.RETURN_LOGS, returnLogs);
  return createdReturns;
}

/**
 * Inserts a contact/escalation record into `public.contact_requests`
 * (`20261113140000_contact_forwarding.sql`) AND invokes the Supabase Edge Function
 * `forward-contact-requests` (`supabase/functions/forward-contact-requests/index.ts`).
 */
async function createContactEscalation({
  type = 'appeal',
  returnId = null,
  orderNumber = '',
  subject,
  message,
  emailBody,
  flags = [],
}) {
  const user = await getActiveSessionUser();
  const seeded = ensureSeededDatabase();
  const now = new Date();
  const nowIso = now.toISOString();
  const outsideHours = !isBusinessHours(now);
  const replyFromIso = nextBusinessOpening(now);

  const contactType = type === 'appeal' && returnId ? 'appeal' : 'support';
  const requestId = crypto.randomUUID ? crypto.randomUUID() : `cr-${Date.now()}`;

  const contactRow = {
    id: requestId,
    user_id: user?.id || '00000000-0000-0000-0000-000000000001',
    type: contactType,
    return_id: returnId || null,
    order_number: orderNumber,
    order_reference: orderNumber,
    subject,
    message: emailBody || message,
    email_body: emailBody || message,
    status: 'open',
    assigned_employee_id: null,
    outside_business_hours: outsideHours,
    forward_to_human: true,
    forwarded_at: nowIso,
    slack_sent_at: nowIso,
    email_sent_at: nowIso,
    forward_attempts: 1,
    forward_claimed_at: null,
    forward_error: null,
    reply_from: replyFromIso,
    recipient_email: BUSINESS_PROFILE.contact.email,
    customer_email: user?.email || 'customer.one@example.com',
    customer_name: user?.user_metadata?.full_name || 'Customer One',
    flags,
    flags_triggered: flags,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const allRequests = seeded.contactRequests || [];
  const filteredRequests = allRequests.filter((c) => c.order_number !== orderNumber);
  filteredRequests.unshift(contactRow);
  saveJson(STORAGE_KEYS.CONTACT_REQUESTS, filteredRequests);

  // Update order's display_status
  const targetOrd = seeded.orders.find(
    (o) => (o.order_number || o.order_code) === orderNumber
  );
  if (targetOrd) {
    targetOrd.display_status = 'Escalated to Manager';
    saveJson(STORAGE_KEYS.ORDERS, seeded.orders);
  }

  if (supabaseClient && user?.id) {
    try {
      const { data: inserted, error: insErr } = await supabaseClient
        .from('contact_requests')
        .insert({
          user_id: user.id,
          type: contactType,
          return_id: contactRow.return_id,
          subject: contactRow.subject,
          message: contactRow.message,
          status: 'open',
        })
        .select()
        .single();

      if (!insErr && inserted?.id) {
        contactRow.id = inserted.id;
      }

      await supabaseClient.functions.invoke(SUPABASE_CONFIG.EDGE_FUNCTION_NAME, {
        body: {
          contact_request_id: contactRow.id,
          type: contactType,
          subject: contactRow.subject,
          message: contactRow.message,
          return_id: contactRow.return_id,
          customer_email: contactRow.customer_email,
          customer_name: contactRow.customer_name,
          reply_from: replyFromIso,
          owner_email: BUSINESS_PROFILE.contact.email,
        },
      });
    } catch (err) {
      console.warn('[RefundBackend] Edge Function invoke fallback:', err);
    }
  }

  return contactRow;
}

function missingRpc(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === 'PGRST202' || code === '404' || /could not find the function|does not exist|404/i.test(message);
}

async function fetchReturnEligibility(quantity = 1) {
  if (!supabaseClient) return [];
  const { data, error } = await supabaseClient.rpc('customer_return_eligibility', {
    p_quantity: quantity,
  });
  if (error) {
    if (missingRpc(error)) return [];
    throw new Error(friendlyDbMessage(error));
  }
  return data || [];
}

async function fetchReturnPolicy() {
  if (!supabaseClient) return null;
  const { data, error } = await supabaseClient.rpc('return_policy');
  if (error) {
    if (!missingRpc(error)) console.warn('[RefundBackend] return policy:', error.message);
    return null;
  }
  return data;
}

async function fetchAccountReturns() {
  if (!supabaseClient) return getAllReturns();
  const { data, error } = await supabaseClient
    .from('returns')
    .select('*, return_logs(*), courier_tracking(*, courier_tracking_events(*))')
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[RefundBackend] returns:', error.message);
    return [];
  }
  return (data || []).map((row) => {
    const trackingRows = Array.isArray(row.courier_tracking)
      ? row.courier_tracking
      : row.courier_tracking
        ? [row.courier_tracking]
        : [];
    return {
      ...row,
      return_logs: row.return_logs || [],
      courier_tracking: trackingRows,
      tracking: trackingRows[0] || null,
    };
  });
}

async function syncCourierTracking(waybill) {
  if (!supabaseClient) return mockCourierTracking(null);
  const { data, error } = await supabaseClient.rpc('mock_courier_tracking', {
    p_waybill: waybill,
  });
  if (error) throw new Error(friendlyDbMessage(error));
  return data;
}

function mockCourierTracking(returnId, courierName = 'The Courier Guy') {
  const waybill = `TCG-${Math.floor(100000 + Math.random() * 899999)}`;
  const etaDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toLocaleDateString('en-ZA', {
    month: 'short',
    day: 'numeric',
  });
  return {
    return_id: returnId,
    courier_name: courierName,
    tracking_number: waybill,
    status: 'awaiting_collection',
    eta_date: etaDate,
  };
}

// Expose shared backend utilities globally across index.html, store.html, and orders.html
window.SUPABASE_CONFIG = SUPABASE_CONFIG;
window.AI_CONFIG = AI_CONFIG;
window.BUSINESS_PROFILE = BUSINESS_PROFILE;
window.ReplyEngineJS = ReplyEngineJS;
window.STORE_CATALOG_PRODUCTS = STORE_CATALOG_PRODUCTS;
window.SEED_PUBLIC_HOLIDAYS = SEED_PUBLIC_HOLIDAYS;
window.SEED_EMPLOYEES = SEED_EMPLOYEES;
window.RefundBackend = {
  client: supabaseClient,
  supabaseClient,
  isSupabaseLiveConfigured,
  STORAGE_KEYS,
  loadJson,
  saveJson,
  formatRand,
  isBusinessHours,
  nextBusinessOpening,
  getProductImageForSku,
  ensureSeededDatabase,
  getActiveSessionUser,
  setDemoSessionUser,
  getAllReturns,
  getAllContactRequests,
  fetchOrdersWithItems,
  createOrderWithItems,
  cancelOrderInBackend,
  cancelOrderItems,
  createReturnRecords,
  createContactEscalation,
  mockCourierTracking,
  logAuthEvent,
  signOutAndLog,
  fetchReturnEligibility,
  fetchReturnPolicy,
  fetchAccountReturns,
  syncCourierTracking,
  friendlyDbMessage,
};
