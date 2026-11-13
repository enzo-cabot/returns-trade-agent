// Scoped to this page. Do not redeclare formatRand, STORAGE_KEYS, or supabaseClient;
// supabase-config.js already owns those names in the shared global scope.
(function () {
/**
 * Refund — E-Commerce Storefront & Demo Checkout Controller (store.js)
 *
 * Uses shared backend definitions from supabase-config.js:
 * - window.STORE_CATALOG_PRODUCTS (Clothes SKUs from 20261113120100_seed_dummy_data.sql + Gourmet Food in R)
 * - window.RefundBackend (formatRand, fetchOrdersWithItems, createOrderWithItems, getActiveSessionUser)
 */

// supabase-config.js already declares supabaseClient, formatRand and STORAGE_KEYS
// in this page's global scope. A second const here throws and stops the store.
const PRODUCTS = Array.isArray(window.STORE_CATALOG_PRODUCTS) ? window.STORE_CATALOG_PRODUCTS : [];

const state = {
  user: null,
  activeCategory: 'food', // 'food' | 'clothes'
  searchQuery: '',
  wishlist: [], // array of product IDs
  cart: [], // array of { productId, sku, quantity, selectedOption, on_sale }
  ordersCount: 0,
  quickViewProduct: null,
  quickViewQty: 1,
  quickViewOption: '',
  selectedPaymentTab: 'card', // 'card' | 'gpay'
  lastConfirmedOrder: null,
};

// ============================================================================
// 2. DOM ELEMENTS
// ============================================================================
const dom = {
  switcherPills: document.querySelectorAll('.switcher-pill'),
  searchInput: document.getElementById('product-search'),
  clearSearchBtn: document.getElementById('clear-search-btn'),

  heroCategoryTag: document.getElementById('hero-category-tag'),
  heroTitle: document.getElementById('hero-title'),
  heroSubtitle: document.getElementById('hero-subtitle'),
  catalogHeading: document.getElementById('catalog-heading'),
  catalogCount: document.getElementById('catalog-count'),
  productGrid: document.getElementById('product-grid'),

  wishlistCountBadge: document.getElementById('wishlist-count-badge'),
  cartCountBadge: document.getElementById('cart-count-badge'),
  ordersCountBadge: document.getElementById('orders-count-badge'),
  userEmailPill: document.getElementById('user-email-pill'),
  signOutBtn: document.getElementById('sign-out-btn'),

  drawerBackdrop: document.getElementById('drawer-backdrop'),
  wishlistDrawer: document.getElementById('wishlist-drawer'),
  cartDrawer: document.getElementById('cart-drawer'),
  openWishlistBtn: document.getElementById('open-wishlist-btn'),
  openCartBtn: document.getElementById('open-cart-btn'),

  wishlistDrawerCount: document.getElementById('wishlist-drawer-count'),
  wishlistItemsContainer: document.getElementById('wishlist-items-container'),
  moveAllToCartBtn: document.getElementById('move-all-to-cart-btn'),

  cartDrawerCount: document.getElementById('cart-drawer-count'),
  cartItemsContainer: document.getElementById('cart-items-container'),
  cartSubtotal: document.getElementById('cart-subtotal'),
  cartTax: document.getElementById('cart-tax'),
  cartTotal: document.getElementById('cart-total'),
  proceedCheckoutBtn: document.getElementById('proceed-checkout-btn'),

  quickViewModal: document.getElementById('quick-view-modal'),
  closeQuickViewBtn: document.getElementById('close-quick-view-btn'),
  qvImage: document.getElementById('qv-image'),
  qvCategoryBadge: document.getElementById('qv-category-badge'),
  qvSkuTag: document.getElementById('qv-sku-tag'),
  qvTitle: document.getElementById('qv-title'),
  qvPrice: document.getElementById('qv-price'),
  qvDescription: document.getElementById('qv-description'),
  qvDynamicSpecs: document.getElementById('qv-dynamic-specs'),
  qvQtyMinus: document.getElementById('qv-qty-minus'),
  qvQtyValue: document.getElementById('qv-qty-value'),
  qvQtyPlus: document.getElementById('qv-qty-plus'),
  qvWishlistBtn: document.getElementById('qv-wishlist-btn'),
  qvWishlistText: document.getElementById('qv-wishlist-text'),
  qvAddCartBtn: document.getElementById('qv-add-cart-btn'),

  checkoutModal: document.getElementById('checkout-modal'),
  closeCheckoutBtn: document.getElementById('close-checkout-btn'),
  checkoutFormView: document.getElementById('checkout-form-view'),
  orderConfirmationView: document.getElementById('order-confirmation-view'),
  checkoutAlert: document.getElementById('checkout-alert'),
  shippingAddress: document.getElementById('shipping-address'),
  paymentTabs: document.querySelectorAll('.payment-tab'),
  checkoutCardForm: document.getElementById('checkout-card-form'),
  checkoutGpayPanel: document.getElementById('checkout-gpay-panel'),
  cardHolderInput: document.getElementById('card-holder'),
  cardNumberInput: document.getElementById('card-number'),
  cardExpiryInput: document.getElementById('card-expiry'),
  cardCvvInput: document.getElementById('card-cvv'),
  checkoutItemsCountLabel: document.getElementById('checkout-items-count-label'),
  checkoutSummaryTotal: document.getElementById('checkout-summary-total'),
  placeOrderCardBtn: document.getElementById('place-order-card-btn'),
  checkoutCardSpinner: document.getElementById('checkout-card-spinner'),
  checkoutCardBtnText: document.getElementById('checkout-card-btn-text'),

  googlePayActionBtn: document.getElementById('google-pay-action-btn'),
  gpaySpinner: document.getElementById('gpay-spinner'),
  gpayBtnContent: document.getElementById('gpay-btn-content'),
  gpayStatusText: document.getElementById('gpay-status-text'),

  confirmOrderCode: document.getElementById('confirm-order-code'),
  copyOrderCodeBtn: document.getElementById('copy-order-code-btn'),
  confirmPaymentMethod: document.getElementById('confirm-payment-method'),
  confirmItemsSummary: document.getElementById('confirm-items-summary'),
  confirmTotalPaid: document.getElementById('confirm-total-paid'),
  continueShoppingBtn: document.getElementById('continue-shopping-btn'),
  viewManageOrderBtn: document.getElementById('view-manage-order-btn'),

  toastContainer: document.getElementById('toast-container'),
};

// ============================================================================
// 3. TOAST & PERSISTENCE HELPERS
// ============================================================================
function showToast(message) {
  if (!dom.toastContainer) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function loadLocalState() {
  try {
    const savedWishlist = localStorage.getItem(STORAGE_KEYS.WISHLIST);
    const savedCart = localStorage.getItem(STORAGE_KEYS.CART);
    state.wishlist = savedWishlist ? JSON.parse(savedWishlist) : ['clothes-1', 'food-1'];
    state.cart = savedCart
      ? JSON.parse(savedCart)
      : [
          {
            productId: 'food-1',
            sku: 'SKU-FOOD-BURGER',
            quantity: 1,
            selectedOption: 'Medium Well',
            on_sale: false,
          },
        ];
  } catch (err) {
    state.wishlist = [];
    state.cart = [];
  }
}

function saveWishlist() {
  localStorage.setItem(STORAGE_KEYS.WISHLIST, JSON.stringify(state.wishlist));
  updateHeaderBadges();
}

function saveCart() {
  localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify(state.cart));
  updateHeaderBadges();
}

function getCartTotals() {
  let subtotal = 0;
  let itemCount = 0;
  state.cart.forEach((entry) => {
    const product = PRODUCTS.find((p) => p.id === entry.productId);
    if (product) {
      subtotal += product.price * entry.quantity;
      itemCount += entry.quantity;
    }
  });
  return {
    itemCount,
    subtotal: Number(subtotal.toFixed(2)),
    total: Number(subtotal.toFixed(2)),
  };
}

function updateHeaderBadges() {
  const { itemCount } = getCartTotals();

  if (dom.wishlistCountBadge) {
    dom.wishlistCountBadge.textContent = String(state.wishlist.length);
    dom.wishlistCountBadge.hidden = state.wishlist.length === 0;
  }

  if (dom.cartCountBadge) {
    dom.cartCountBadge.textContent = String(itemCount);
    dom.cartCountBadge.hidden = itemCount === 0;
  }

  if (dom.ordersCountBadge) {
    dom.ordersCountBadge.textContent = String(state.ordersCount);
    dom.ordersCountBadge.hidden = state.ordersCount === 0;
  }
}

// ============================================================================
// 4. AUTH SESSION & ORDERS COUNT SYNC
// ============================================================================
async function initUserSession() {
  if (window.RefundBackend?.isSupabaseLiveConfigured()) {
    state.user = await window.RefundBackend.getActiveSessionUser();
    if (!state.user) {
      window.location.href = 'index.html';
      return;
    }
    const orders = await window.RefundBackend.fetchOrdersWithItems();
    state.ordersCount = Array.isArray(orders) ? orders.length : 0;
  } else if (window.RefundBackend) {
    state.user = await window.RefundBackend.getActiveSessionUser();
    const orders = await window.RefundBackend.fetchOrdersWithItems();
    state.ordersCount = Array.isArray(orders) ? orders.length : 0;
  } else {
    state.user = { id: 'demo-user-001', email: 'customer.one@example.com' };
  }

  if (dom.userEmailPill && state.user?.email) {
    dom.userEmailPill.textContent = state.user.email;
  }
  updateHeaderBadges();
}

async function handleSignOut() {
  try {
    if (window.RefundBackend?.signOutAndLog) {
      await window.RefundBackend.signOutAndLog();
    } else if (window.RefundBackend?.client) {
      await window.RefundBackend.client.auth.signOut();
    }
  } catch (err) {
    console.warn('Sign out notice:', err);
  }
  window.location.href = 'index.html';
}

// ============================================================================
// 5. CATEGORY SWITCHER & PRODUCT CATALOG RENDERING
// ============================================================================
function setCategory(category) {
  state.activeCategory = category;

  dom.switcherPills.forEach((pill) => {
    const isMatch = pill.dataset.category === category;
    pill.classList.toggle('is-active', isMatch);
    pill.setAttribute('aria-selected', isMatch ? 'true' : 'false');
  });

  if (category === 'food') {
    dom.heroCategoryTag.textContent = 'SANDTON GOURMET KITCHEN • FRESH PREPARED';
    dom.heroTitle.textContent = 'Fresh Artisan Food, Delivered Fast';
    dom.heroSubtitle.textContent =
      'Order gourmet burgers, wood-fired pizza, pasta, and craft combos in South African Rand (R). Backed by our 14-day return window from delivery.';
    dom.catalogHeading.textContent = '🍔 Food Menu';
  } else {
    dom.heroCategoryTag.textContent = 'REFUND APPAREL • DATABASE SEED SKUS';
    dom.heroTitle.textContent = 'Everyday Streetwear & Tailored Essentials';
    dom.heroSubtitle.textContent =
      'Matches the exact SKU items in public.order_items (SKU-TSHIRT-M, SKU-JEANS-32, SKU-HOODIE-L, SKU-DRESS-S, SKU-JACKET-XL).';
    dom.catalogHeading.textContent = '👕 Clothes Collection';
  }

  renderProductGrid();
}

function renderProductGrid() {
  const query = state.searchQuery.trim().toLowerCase();
  if (dom.clearSearchBtn) {
    dom.clearSearchBtn.hidden = query.length === 0;
  }

  const filtered = PRODUCTS.filter((item) => {
    const matchesCategory = item.category === state.activeCategory;
    if (!matchesCategory) return false;
    if (!query) return true;
    return (
      item.title.toLowerCase().includes(query) ||
      item.subcategory.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query) ||
      item.sku.toLowerCase().includes(query)
    );
  });

  if (dom.catalogCount) {
    dom.catalogCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}`;
  }

  if (filtered.length === 0) {
    dom.productGrid.innerHTML = `
      <div class="empty-card" style="grid-column: 1 / -1;">
        <div class="empty-title">No matching items found</div>
        <p class="empty-subtitle">Try clearing your search filter or switching between 🍔 Food and 👕 Clothes.</p>
      </div>
    `;
    return;
  }

  dom.productGrid.innerHTML = filtered
    .map((product) => {
      const isWishlisted = state.wishlist.includes(product.id);
      const metaPills =
        product.category === 'food'
          ? [product.prepTime, ...(product.dietary || []).slice(0, 2)]
          : [`SKU: ${product.sku}`, product.fit];

      return `
        <article class="product-card" data-product-id="${product.id}">
          <div class="product-media" data-quick-view="${product.id}">
            <img src="${product.image}" alt="${product.title}" class="product-image" loading="lazy" />
            <span class="card-badge">${product.subcategory}</span>
            <button
              type="button"
              class="fav-icon ${isWishlisted ? 'is-wishlisted' : ''}"
              data-toggle-wishlist="${product.id}"
              aria-label="${isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}"
              title="${isWishlisted ? 'Saved in Wishlist' : 'Add to Wishlist'}"
            >
              ${isWishlisted ? '♥' : '♡'}
            </button>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;">
            <span class="sku-pill">${product.sku}</span>
            ${
              product.on_sale
                ? '<span class="on-sale-badge" title="Sale item in public.order_items">ON SALE</span>'
                : ''
            }
          </div>

          <h3 class="product-title" data-quick-view="${product.id}">${product.title}</h3>
          <p class="product-desc">${product.description}</p>

          <div class="product-meta-tags">
            ${metaPills.map((tag) => `<span class="meta-tag">${tag}</span>`).join('')}
          </div>

          <div class="card-bottom-row">
            <div class="price-block">
              <span class="product-price">${formatRand(product.price)}</span>
            </div>
          </div>

          <div class="store-card-actions">
            <button type="button" class="btn-outline btn-sm" data-quick-view="${product.id}">
              View Product
            </button>
            <button type="button" class="btn-primary btn-sm" data-add-cart="${product.id}">
              Add to Cart
            </button>
          </div>
        </article>
      `;
    })
    .join('');
}

// ============================================================================
// 6. WISHLIST & SHOPPING CART ACTIONS
// ============================================================================
function toggleWishlist(productId) {
  const product = PRODUCTS.find((p) => p.id === productId);
  if (!product) return;

  const idx = state.wishlist.indexOf(productId);
  if (idx >= 0) {
    state.wishlist.splice(idx, 1);
    showToast(`Removed "${product.title}" from Wishlist`);
  } else {
    state.wishlist.push(productId);
    showToast(`Saved "${product.title}" to Wishlist`);
  }

  saveWishlist();
  renderProductGrid();
  renderWishlistDrawer();

  if (state.quickViewProduct && state.quickViewProduct.id === productId) {
    syncQuickViewWishlistButton();
  }
}

function addToCart(productId, quantity = 1, optionOverride = '') {
  const product = PRODUCTS.find((p) => p.id === productId);
  if (!product) return;

  const selectedOption = optionOverride || (product.options && product.options[0]) || 'Standard';
  const existing = state.cart.find(
    (item) => item.productId === productId && item.selectedOption === selectedOption
  );

  if (existing) {
    existing.quantity += quantity;
  } else {
    state.cart.push({
      productId: product.id,
      sku: product.sku,
      quantity,
      selectedOption,
      on_sale: Boolean(product.on_sale),
    });
  }

  saveCart();
  renderCartDrawer();
  showToast(`Added ${quantity}× "${product.title}" (${formatRand(product.price)}) to Cart`);
}

function updateCartItemQty(index, delta) {
  const entry = state.cart[index];
  if (!entry) return;
  entry.quantity += delta;
  if (entry.quantity <= 0) {
    state.cart.splice(index, 1);
  }
  saveCart();
  renderCartDrawer();
}

// ============================================================================
// 7. SLIDE-OVER DRAWERS (WISHLIST & CART)
// ============================================================================
function openDrawer(type) {
  dom.drawerBackdrop.hidden = false;
  if (type === 'wishlist') {
    renderWishlistDrawer();
    dom.cartDrawer.classList.remove('is-open');
    dom.wishlistDrawer.classList.add('is-open');
    dom.wishlistDrawer.setAttribute('aria-hidden', 'false');
  } else if (type === 'cart') {
    renderCartDrawer();
    dom.wishlistDrawer.classList.remove('is-open');
    dom.cartDrawer.classList.add('is-open');
    dom.cartDrawer.setAttribute('aria-hidden', 'false');
  }
}

function closeDrawers() {
  dom.wishlistDrawer.classList.remove('is-open');
  dom.cartDrawer.classList.remove('is-open');
  dom.wishlistDrawer.setAttribute('aria-hidden', 'true');
  dom.cartDrawer.setAttribute('aria-hidden', 'true');
  dom.drawerBackdrop.hidden = true;
}

function renderWishlistDrawer() {
  const items = state.wishlist
    .map((id) => PRODUCTS.find((p) => p.id === id))
    .filter(Boolean);

  dom.wishlistDrawerCount.textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
  dom.moveAllToCartBtn.disabled = items.length === 0;

  if (items.length === 0) {
    dom.wishlistItemsContainer.innerHTML = `
      <div class="empty-card">
        <div class="empty-title">Your Wishlist is empty</div>
        <p class="empty-subtitle">Tap the heart icon on any Food or Clothes item to save it here.</p>
      </div>
    `;
    return;
  }

  dom.wishlistItemsContainer.innerHTML = items
    .map(
      (product) => `
      <div class="drawer-item">
        <img src="${product.image}" alt="${product.title}" class="drawer-item-img" />
        <div class="drawer-item-info">
          <div class="drawer-item-title">${product.title}</div>
          <div class="drawer-item-meta">${product.sku} • ${product.subcategory}</div>
          <div class="drawer-item-bottom">
            <span class="drawer-item-price">${formatRand(product.price)}</span>
            <div style="display:flex;gap:6px;">
              <button type="button" class="btn-outline btn-xs" data-wishlist-remove="${product.id}">Remove</button>
              <button type="button" class="btn-primary btn-xs" data-wishlist-to-cart="${product.id}">+ Cart</button>
            </div>
          </div>
        </div>
      </div>
    `
    )
    .join('');
}

function renderCartDrawer() {
  const { itemCount, subtotal, total } = getCartTotals();

  dom.cartDrawerCount.textContent = `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
  dom.cartSubtotal.textContent = formatRand(subtotal);
  dom.cartTotal.textContent = formatRand(total);
  dom.proceedCheckoutBtn.disabled = state.cart.length === 0;

  if (state.cart.length === 0) {
    dom.cartItemsContainer.innerHTML = `
      <div class="empty-card">
        <div class="empty-title">Your Cart is empty</div>
        <p class="empty-subtitle">Add Food or Clothes items to test our Demo Checkout flow.</p>
      </div>
    `;
    return;
  }

  dom.cartItemsContainer.innerHTML = state.cart
    .map((entry, idx) => {
      const product = PRODUCTS.find((p) => p.id === entry.productId);
      if (!product) return '';
      const lineTotal = product.price * entry.quantity;
      return `
        <div class="drawer-item">
          <img src="${product.image}" alt="${product.title}" class="drawer-item-img" />
          <div class="drawer-item-info">
            <div class="drawer-item-title">${product.title}</div>
            <div class="drawer-item-meta">${product.sku} • ${entry.selectedOption}${
        product.on_sale ? ' • ON SALE' : ''
      }</div>
            <div class="drawer-item-bottom">
              <span class="drawer-item-price">${formatRand(lineTotal)}</span>
              <div class="qty-mini">
                <button type="button" data-cart-dec="${idx}" aria-label="Decrease quantity">−</button>
                <span>${entry.quantity}</span>
                <button type="button" data-cart-inc="${idx}" aria-label="Increase quantity">+</button>
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

// ============================================================================
// 8. QUICK-VIEW PRODUCT MODAL
// ============================================================================
function openQuickView(productId) {
  const product = PRODUCTS.find((p) => p.id === productId);
  if (!product) return;

  state.quickViewProduct = product;
  state.quickViewQty = 1;
  state.quickViewOption = (product.options && product.options[0]) || 'Standard';

  dom.qvImage.src = product.image;
  dom.qvImage.alt = product.title;
  dom.qvCategoryBadge.textContent = product.subcategory;
  dom.qvSkuTag.textContent = `${product.sku}${product.on_sale ? ' • ON SALE' : ' • FULL PRICE'}`;
  dom.qvTitle.textContent = product.title;
  dom.qvPrice.textContent = formatRand(product.price);
  dom.qvDescription.textContent = product.description;
  dom.qvQtyValue.textContent = '1';

  syncQuickViewWishlistButton();

  const optionLabel = product.category === 'food' ? 'Preparation / Option' : 'Select Size / Fit';
  const optionsHtml = (product.options || [])
    .map(
      (opt) => `
      <button
        type="button"
        class="option-pill ${opt === state.quickViewOption ? 'is-selected' : ''}"
        data-qv-option="${opt}"
      >
        ${opt}
      </button>
    `
    )
    .join('');

  const extraDetailsHtml =
    product.category === 'food' && product.nutrition
      ? `
      <div class="nutrition-grid">
        <div class="nutrition-box"><span>Calories</span><strong>${product.nutrition.calories}</strong></div>
        <div class="nutrition-box"><span>Protein</span><strong>${product.nutrition.protein}</strong></div>
        <div class="nutrition-box"><span>Carbs</span><strong>${product.nutrition.carbs}</strong></div>
        <div class="nutrition-box"><span>Prep Time</span><strong>${product.prepTime}</strong></div>
      </div>
    `
      : `
      <div class="nutrition-grid">
        <div class="nutrition-box"><span>Material</span><strong>${product.material || 'Cotton'}</strong></div>
        <div class="nutrition-box"><span>Fit</span><strong>${product.fit || 'Regular'}</strong></div>
        <div class="nutrition-box"><span>Sale Status</span><strong>${product.on_sale ? 'On Sale' : 'Full Price'}</strong></div>
        <div class="nutrition-box"><span>Return Rule</span><strong>${product.on_sale ? 'Defective Only' : '7-Day Refund'}</strong></div>
      </div>
    `;

  dom.qvDynamicSpecs.innerHTML = `
    ${extraDetailsHtml}
    <div>
      <span class="form-label" style="display:block;margin-bottom:6px;">${optionLabel}</span>
      <div class="option-pills">${optionsHtml}</div>
    </div>
  `;

  dom.quickViewModal.hidden = false;
}

function syncQuickViewWishlistButton() {
  if (!state.quickViewProduct) return;
  const isSaved = state.wishlist.includes(state.quickViewProduct.id);
  dom.qvWishlistText.textContent = isSaved ? '♥ Saved in Wishlist' : '♡ Add to Wishlist';
}

function closeQuickView() {
  dom.quickViewModal.hidden = true;
  state.quickViewProduct = null;
}

// ============================================================================
// 9. DEMO PAYMENT MODAL (CREDIT CARD & GOOGLE PAY) + SUPABASE ORDER CREATION
// ============================================================================
function openCheckoutModal() {
  const { itemCount, total } = getCartTotals();
  if (itemCount === 0) {
    showToast('Your cart is empty.');
    return;
  }

  closeDrawers();
  dom.checkoutAlert.hidden = true;
  dom.checkoutFormView.hidden = false;
  dom.orderConfirmationView.hidden = true;

  dom.checkoutItemsCountLabel.textContent = `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
  dom.checkoutSummaryTotal.textContent = formatRand(total);
  switchPaymentTab('card');

  dom.checkoutModal.hidden = false;
}

function closeCheckoutModal() {
  dom.checkoutModal.hidden = true;
}

function switchPaymentTab(tabName) {
  state.selectedPaymentTab = tabName;
  dom.paymentTabs.forEach((btn) => {
    const isActive = btn.dataset.paymentTab === tabName;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  dom.checkoutCardForm.hidden = tabName !== 'card';
  dom.checkoutGpayPanel.hidden = tabName !== 'gpay';
}

async function processDemoPayment(paymentMethodLabel) {
  const { total } = getCartTotals();
  if (state.cart.length === 0) return;

  const shippingAddress =
    dom.shippingAddress?.value.trim() || '123 Example Street, Sandton, Johannesburg';

  const itemsSnapshot = state.cart
    .map((entry) => {
      const product = PRODUCTS.find((p) => p.id === entry.productId);
      if (!product) return null;
      return {
        productId: product.id,
        sku: product.sku,
        title: product.title,
        product_name: `${product.title} (${entry.selectedOption})`,
        category: product.category,
        price: product.price,
        unit_price: product.price,
        quantity: entry.quantity,
        selectedOption: entry.selectedOption,
        image: product.image,
        on_sale: Boolean(product.on_sale),
      };
    })
    .filter(Boolean);

  // Determine shop_name based on cart items
  const hasFood = itemsSnapshot.some((i) => i.category === 'food');
  const hasClothes = itemsSnapshot.some((i) => i.category === 'clothes');
  const shopName =
    hasFood && hasClothes
      ? 'Refund gourmet & apparel'
      : hasFood
      ? 'Refund Sandton Kitchen'
      : 'Refund Studio Apparel';

  let createdOrder = null;
  if (window.RefundBackend) {
    createdOrder = await window.RefundBackend.createOrderWithItems({
      shopName,
      customerEmail: state.user?.email || 'customer.one@example.com',
      totalAmount: total,
      paymentMethod: paymentMethodLabel,
      shippingAddress,
      items: itemsSnapshot,
    });
  }

  const orderCode = createdOrder?.order_number || `DEMO-${Math.floor(1011 + Math.random() * 8900)}`;
  state.lastConfirmedOrder = {
    order_number: orderCode,
    payment_method: paymentMethodLabel,
    total_amount: total,
    items: itemsSnapshot,
  };

  // Clear Cart & update badges
  state.cart = [];
  saveCart();
  state.ordersCount += 1;
  updateHeaderBadges();

  // Render Confirmation Receipt
  dom.confirmOrderCode.textContent = orderCode;
  dom.confirmPaymentMethod.textContent = paymentMethodLabel;
  dom.confirmTotalPaid.textContent = formatRand(total);
  dom.confirmItemsSummary.innerHTML = itemsSnapshot
    .map(
      (item) => `
      <div class="confirm-item-row">
        <span>${item.quantity}× ${item.title} <small style="color:#666;">(${item.sku})</small></span>
        <strong>${formatRand(item.price * item.quantity)}</strong>
      </div>
    `
    )
    .join('');

  if (dom.viewManageOrderBtn) {
    dom.viewManageOrderBtn.href = `orders.html?order=${encodeURIComponent(orderCode)}`;
  }

  dom.checkoutFormView.hidden = true;
  dom.orderConfirmationView.hidden = false;
  showToast(`Order ${orderCode} confirmed (${formatRand(total)})`);
}

// ============================================================================
// 10. EVENT LISTENERS & INITIALIZATION
// ============================================================================
function bindEvents() {
  // Category Switcher Pills
  dom.switcherPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      setCategory(pill.dataset.category);
    });
  });

  // Real-time Search
  dom.searchInput?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value || '';
    renderProductGrid();
  });

  dom.clearSearchBtn?.addEventListener('click', () => {
    state.searchQuery = '';
    if (dom.searchInput) dom.searchInput.value = '';
    renderProductGrid();
  });

  // Product Grid Delegation
  dom.productGrid?.addEventListener('click', (e) => {
    const wishlistBtn = e.target.closest('[data-toggle-wishlist]');
    if (wishlistBtn) {
      e.stopPropagation();
      toggleWishlist(wishlistBtn.dataset.toggleWishlist);
      return;
    }

    const addCartBtn = e.target.closest('[data-add-cart]');
    if (addCartBtn) {
      e.stopPropagation();
      addToCart(addCartBtn.dataset.addCart, 1);
      return;
    }

    const quickViewTrigger = e.target.closest('[data-quick-view]');
    if (quickViewTrigger) {
      openQuickView(quickViewTrigger.dataset.quickView);
    }
  });

  // Drawers Open/Close
  dom.openWishlistBtn?.addEventListener('click', () => openDrawer('wishlist'));
  dom.openCartBtn?.addEventListener('click', () => openDrawer('cart'));
  dom.drawerBackdrop?.addEventListener('click', closeDrawers);

  document.querySelectorAll('[data-close-drawer]').forEach((btn) => {
    btn.addEventListener('click', closeDrawers);
  });

  // Wishlist Drawer Actions
  dom.wishlistItemsContainer?.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-wishlist-remove]');
    if (removeBtn) {
      toggleWishlist(removeBtn.dataset.wishlistRemove);
      return;
    }
    const toCartBtn = e.target.closest('[data-wishlist-to-cart]');
    if (toCartBtn) {
      addToCart(toCartBtn.dataset.wishlistToCart, 1);
    }
  });

  dom.moveAllToCartBtn?.addEventListener('click', () => {
    state.wishlist.forEach((productId) => addToCart(productId, 1));
    closeDrawers();
    openDrawer('cart');
  });

  // Cart Drawer Actions
  dom.cartItemsContainer?.addEventListener('click', (e) => {
    const decBtn = e.target.closest('[data-cart-dec]');
    if (decBtn) {
      updateCartItemQty(Number(decBtn.dataset.cartDec), -1);
      return;
    }
    const incBtn = e.target.closest('[data-cart-inc]');
    if (incBtn) {
      updateCartItemQty(Number(incBtn.dataset.cartInc), 1);
    }
  });

  dom.proceedCheckoutBtn?.addEventListener('click', openCheckoutModal);

  // Quick-View Modal Actions
  dom.closeQuickViewBtn?.addEventListener('click', closeQuickView);
  dom.quickViewModal?.addEventListener('click', (e) => {
    if (e.target === dom.quickViewModal) closeQuickView();
  });

  dom.qvDynamicSpecs?.addEventListener('click', (e) => {
    const optBtn = e.target.closest('[data-qv-option]');
    if (!optBtn) return;
    state.quickViewOption = optBtn.dataset.qvOption;
    dom.qvDynamicSpecs.querySelectorAll('.option-pill').forEach((pill) => {
      pill.classList.toggle('is-selected', pill.dataset.qvOption === state.quickViewOption);
    });
  });

  dom.qvQtyMinus?.addEventListener('click', () => {
    if (state.quickViewQty > 1) {
      state.quickViewQty -= 1;
      dom.qvQtyValue.textContent = String(state.quickViewQty);
    }
  });

  dom.qvQtyPlus?.addEventListener('click', () => {
    state.quickViewQty += 1;
    dom.qvQtyValue.textContent = String(state.quickViewQty);
  });

  dom.qvWishlistBtn?.addEventListener('click', () => {
    if (state.quickViewProduct) {
      toggleWishlist(state.quickViewProduct.id);
    }
  });

  dom.qvAddCartBtn?.addEventListener('click', () => {
    if (state.quickViewProduct) {
      addToCart(state.quickViewProduct.id, state.quickViewQty, state.quickViewOption);
      closeQuickView();
    }
  });

  // Checkout Modal & Payment Tabs
  dom.closeCheckoutBtn?.addEventListener('click', closeCheckoutModal);
  dom.checkoutModal?.addEventListener('click', (e) => {
    if (e.target === dom.checkoutModal) closeCheckoutModal();
  });

  dom.paymentTabs.forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      switchPaymentTab(tabBtn.dataset.paymentTab);
    });
  });

  // Format Card Number & Expiry
  dom.cardNumberInput?.addEventListener('input', (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 16);
    e.target.value = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  });

  dom.cardExpiryInput?.addEventListener('input', (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (digits.length >= 3) {
      e.target.value = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    } else {
      e.target.value = digits;
    }
  });

  // Credit Card Demo Submit
  dom.checkoutCardForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    dom.placeOrderCardBtn.disabled = true;
    dom.checkoutCardSpinner.hidden = false;
    dom.checkoutCardBtnText.textContent = 'Processing Card Payment...';

    const rawDigits = (dom.cardNumberInput?.value || '').replace(/\D/g, '');
    const last4 = rawDigits.slice(-4) || '8891';

    await new Promise((r) => setTimeout(r, 700));
    await processDemoPayment(`Credit Card •••• ${last4}`);

    dom.placeOrderCardBtn.disabled = false;
    dom.checkoutCardSpinner.hidden = true;
    dom.checkoutCardBtnText.textContent = 'Pay Now';
  });

  // Google Pay 1.5-second Demo Authentication
  dom.googlePayActionBtn?.addEventListener('click', async () => {
    dom.googlePayActionBtn.disabled = true;
    dom.gpaySpinner.hidden = false;
    dom.gpayBtnContent.hidden = true;
    dom.gpayStatusText.hidden = false;

    await new Promise((r) => setTimeout(r, 1500));
    await processDemoPayment('Google Pay');

    dom.googlePayActionBtn.disabled = false;
    dom.gpaySpinner.hidden = true;
    dom.gpayBtnContent.hidden = false;
    dom.gpayStatusText.hidden = true;
  });

  // Confirmation Actions
  dom.copyOrderCodeBtn?.addEventListener('click', async () => {
    const code = dom.confirmOrderCode?.textContent || '';
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      showToast(`Copied Order Number: ${code}`);
    } catch (_) {
      showToast(`Order Number: ${code}`);
    }
  });

  dom.continueShoppingBtn?.addEventListener('click', closeCheckoutModal);
  dom.signOutBtn?.addEventListener('click', handleSignOut);
}

document.addEventListener('DOMContentLoaded', async () => {
  loadLocalState();
  bindEvents();
  setCategory('food');
  await initUserSession();
});

})();
