// Scoped to this page. Do not redeclare BUSINESS_PROFILE, AI_CONFIG, ReplyEngineJS,
// or supabaseClient; supabase-config.js already owns those names.
(function () {
/**
 * ============================================================================
 * REFUND — Orders, AI Refund Adjudicator, ReplyEngine & Manager Escalation (orders.js)
 *
 * Grounded in ./returns-trade-agent-main backend schema & Edge Function:
 * - public.orders (order_number DEMO-1001..DEMO-1010, shop_name, status, ordered_at, delivered_at, total_amount, currency='ZAR')
 * - public.order_items (sku, product_name, quantity, unit_price, on_sale)
 * - public.returns & public.return_logs
 * - public.contact_requests (type: 'appeal' | 'support', return_id, outside_business_hours, forward_to_human)
 * - supabase/functions/forward-contact-requests/index.ts
 * ============================================================================
 */

const Backend = window.RefundBackend || null;
// BUSINESS_PROFILE, ReplyEngineJS, AI_CONFIG and supabaseClient are globals
// from supabase-config.js. Redeclaring them here throws before this page runs.

function getActiveAiApiKey() {
  try {
    const saved = localStorage.getItem(AI_CONFIG.STORAGE_KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch (_) {}
  if (
    AI_CONFIG.API_KEY &&
    !AI_CONFIG.API_KEY.includes('YOUR_') &&
    AI_CONFIG.API_KEY.trim().length > 0
  ) {
    return AI_CONFIG.API_KEY.trim();
  }
  return '';
}

function getActiveAiModel() {
  try {
    const saved = localStorage.getItem(AI_CONFIG.MODEL_STORAGE_KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch (_) {}
  return AI_CONFIG.MODEL || 'grok-3-mini';
}

function formatCurrency(amount) {
  if (Backend && typeof Backend.formatRand === 'function') {
    return Backend.formatRand(amount);
  }
  return `R${Number(amount || 0).toFixed(2)}`;
}

function formatDateTime(isoString) {
  if (!isoString) return 'Not yet delivered';
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return String(isoString);
    return date.toLocaleString('en-ZA', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (_) {
    return String(isoString);
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
      <polyline points="22 4 12 14.01 9 11.01"></polyline>
    </svg>
    <span></span>
  `;
  toast.querySelector('span').textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3200);
}

// ============================================================================
// 1. STATE MANAGEMENT
// ============================================================================
const state = {
  currentUser: null,
  orders: [],
  returns: [],
  contactRequests: [],
  searchQuery: '',
  statusFilter: 'all',
  highlightedOrderCode: '',
  activeRefundOrder: null,
  activeAdjudication: null,
  activeReturnRecord: null,
  activeEscalationType: 'Appeal', // 'Appeal' | 'Talk to Person'
  chatTranscript: [],
  lastEmailSummaryPayload: null,
  pythonBackendOnline: false,
  eligibility: [],
};

// ============================================================================
// 2. MODULAR AI REFUND EVALUATOR: evaluateRefundWithAI(order, refundDetails, chatHistory)
// ============================================================================
/**
 * Evaluates a customer's refund request using AI_CONFIG (Grok API / LLM endpoint)
 * with a deterministic rule-based fallback grounded in `business.json`,
 * `20261113120100_seed_dummy_data.sql` (`on_sale`, `delivered_at`, `ordered_at`),
 * and `reply_engine.py` (`SCAM_PATTERNS` & `escalate_keywords`).
 */
async function evaluateRefundWithAI(order, refundDetails, chatHistory = []) {
  const reason = String(refundDetails?.reason || '').trim();
  const notes = String(refundDetails?.notes || '').trim();
  const selectedItems = Array.isArray(refundDetails?.selectedItems)
    ? refundDetails.selectedItems
    : [];
  const refundAmount = Number(refundDetails?.refundAmount || order?.total_amount || 0);
  const combinedText = `${reason}. ${notes}`.trim();

  // Run ReplyEngineJS deterministic classifier & flag detector first
  const baseEngine = ReplyEngineJS
    ? ReplyEngineJS.handle({ message: combinedText || 'refund request' }, BUSINESS_PROFILE)
    : { intent: 'refund', confidence: 0.85, needs_human: false, flags: [] };
  const detectedFlags = Array.isArray(baseEngine.flags) ? [...baseEngine.flags] : [];

  // Calculate days since delivery (or order date)
  const referenceIso = order?.delivered_at || order?.ordered_at || order?.created_at;
  let daysSinceOrder = 0;
  if (referenceIso) {
    const parsed = new Date(referenceIso);
    if (!Number.isNaN(parsed.getTime())) {
      daysSinceOrder = Math.max(
        0,
        Math.floor((Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24))
      );
    }
  }

  const hasSaleItemSelected = selectedItems.some((item) => Boolean(item.on_sale));
  const orderNumber = order?.order_number || order?.order_code || 'DEMO-1001';
  const orderStatus = String(order?.status || 'delivered').toLowerCase();

  // 1. If a live AI / Grok API key is configured, query AI_CONFIG.API_URL
  const apiKey = getActiveAiApiKey();
  if (apiKey) {
    const isGroqCloud = apiKey.startsWith('gsk_');
    const endpoint = isGroqCloud
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : AI_CONFIG.API_URL;
    const model = isGroqCloud ? 'llama-3.3-70b-versatile' : getActiveAiModel();

    const systemPrompt = [
      `You are the official AI Refund Adjudicator for "${BUSINESS_PROFILE.name}" (${BUSINESS_PROFILE.location}).`,
      `Tone: ${BUSINESS_PROFILE.tone}. Currency: ${BUSINESS_PROFILE.currency} (ZAR).`,
      `Business Policies:`,
      `- Refund Policy: ${BUSINESS_PROFILE.policies.refund}`,
      `- Delivery Policy: ${BUSINESS_PROFILE.policies.delivery}`,
      `- Payment Security Policy: ${BUSINESS_PROFILE.policies.payment}`,
      ``,
      `STRICT ADJUDICATION RULES:`,
      `1. If detected_security_flags includes "possible_scam_or_payment_redirect", DECLINE immediately.`,
      `2. If order_status is "pending" or "shipped" (not yet delivered), DECLINE return/refund until delivery (or suggest order cancellation if pending).`,
      `3. If days_since_purchase > 14, DECLINE because it exceeds the 14-day return window measured from delivery.`,
      `4. If any selected item has on_sale=true AND the reason is non-defective ("Changed my mind"), DECLINE because sale items cannot be refunded for change of mind.`,
      `5. If reason is "Changed my mind", DECLINE automated approval and invite manager inspection.`,
      `6. Otherwise (within 14 days of delivery, proof of payment verified via Order ID, valid defect/damage/wrong item), APPROVE the refund.`,
      ``,
      `Return ONLY valid JSON with keys: { "decision": "APPROVED" | "DECLINED", "confidence": number, "intent": string, "needs_human": boolean, "decision_reason": string, "reply": string }`,
    ].join('\n');

    const userPrompt = JSON.stringify({
      order_number: orderNumber,
      order_status: orderStatus,
      days_since_purchase: daysSinceOrder,
      selected_items: selectedItems.map((i) => ({
        sku: i.sku,
        name: i.product_name || i.name,
        qty: i.quantity,
        unit_price: i.unit_price || i.price,
        on_sale: Boolean(i.on_sale),
      })),
      refund_amount_zar: `R${refundAmount.toFixed(2)}`,
      reason,
      notes,
      detected_security_flags: detectedFlags,
      recent_chat_turns: chatHistory.slice(-4),
    });

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const raw = data?.choices?.[0]?.message?.content || '{}';
        const parsed = JSON.parse(raw);
        let decision = String(parsed.decision || '').toUpperCase();
        if (decision !== 'APPROVED' && decision !== 'DECLINED') {
          decision = 'DECLINED';
        }
        if (detectedFlags.includes('possible_scam_or_payment_redirect')) {
          decision = 'DECLINED';
        }

        return {
          is_valid: decision === 'APPROVED',
          decision,
          decision_reason:
            parsed.decision_reason ||
            `Evaluated order ${orderNumber} (${daysSinceOrder}d old) under the 14-day policy.`,
          reply:
            parsed.reply ||
            `${parsed.decision_reason || ''}\n\n${BUSINESS_PROFILE.signoff}`,
          intent: parsed.intent || baseEngine.intent || 'refund',
          confidence: Number(parsed.confidence || 0.93),
          needs_human:
            Boolean(parsed.needs_human) ||
            decision === 'DECLINED' ||
            detectedFlags.length > 0,
          flags: detectedFlags,
          days_since_purchase: daysSinceOrder,
          policy_applied: BUSINESS_PROFILE.policies.refund,
          adjudicated_by: `Grok AI (${model})`,
        };
      }
    } catch (err) {
      console.warn('[evaluateRefundWithAI] Live API error, falling back to policy engine:', err);
    }
  }

  // 2. Deterministic Rule-Based Fallback grounded in business.json & seed data rules
  const policyText = BUSINESS_PROFILE.policies.refund;
  let decision = 'APPROVED';
  let decisionReason = '';

  if (detectedFlags.includes('possible_scam_or_payment_redirect')) {
    decision = 'DECLINED';
    decisionReason = `Security Block: Potential banking/EFT redirect detected. ${BUSINESS_PROFILE.policies.payment}`;
  } else if (selectedItems.some((item) => isFoodItem(item))) {
    decision = 'DECLINED';
    decisionReason = 'Food items cannot be returned.';
  } else if (orderStatus === 'pending' || orderStatus === 'shipped') {
    decision = 'DECLINED';
    decisionReason = `Order ${orderNumber} currently has status "${orderStatus}" and has not been marked as delivered yet. Returns require a delivered order (or you may cancel a pending order).`;
  } else if (daysSinceOrder > 14) {
    decision = 'DECLINED';
    decisionReason = `Order ${orderNumber} was delivered/placed ${daysSinceOrder} days ago, which is outside our 14-day return window. Policy: "${policyText}"`;
  } else if (hasSaleItemSelected && reason.toLowerCase().includes('changed my mind')) {
    decision = 'DECLINED';
    decisionReason = `Selected item(s) were purchased ON SALE (on_sale = true) and are not eligible for a non-defective change-of-mind refund.`;
  } else if (reason.toLowerCase().includes('changed my mind')) {
    decision = 'DECLINED';
    decisionReason = `Change-of-mind refunds require manager verification of unopened tags and proof of payment. Policy: "${policyText}"`;
  } else if (/used|worn|opened|washed|no receipt|no proof/i.test(notes)) {
    decision = 'DECLINED';
    decisionReason = `Item condition or missing proof of payment does not qualify for an automated refund. Policy: "${policyText}"`;
  } else {
    decision = 'APPROVED';
    decisionReason = `Order ${orderNumber} is within the 14-day return window (${daysSinceOrder} day(s) since delivery) with verified digital proof of payment. Approved for ${formatCurrency(refundAmount)}.`;
  }

  const warn = detectedFlags.includes('possible_scam_or_payment_redirect')
    ? '\n\nIMPORTANT: We never change banking details via message. Please verify any payment request by calling us directly.'
    : '';

  let botReply = '';
  if (detectedFlags.length > 0 || baseEngine.intent === 'complaint' || baseEngine.intent === 'human') {
    botReply =
      `Thanks for submitting your refund request for ${orderNumber}. ${decisionReason}\n\n` +
      `Note: Your message triggered a priority review flag (${detectedFlags.join(', ') || baseEngine.intent}). ` +
      `You can click "Appeal Decision" or "Talk to a Person" below, or call ${BUSINESS_PROFILE.contact.phone}.${warn}\n\n` +
      `${BUSINESS_PROFILE.signoff}`;
  } else if (decision === 'APPROVED') {
    botReply =
      `Good news! Your refund of ${formatCurrency(refundAmount)} for ${orderNumber} has been APPROVED under our policy (${policyText}). ` +
      `${decisionReason}\n\n${BUSINESS_PROFILE.signoff}`;
  } else {
    botReply =
      `Thank you for reaching out regarding ${orderNumber}. After reviewing your request against our policy (${policyText}), ` +
      `your automated refund request was DECLINED: ${decisionReason}\n\n` +
      `If you would like a human manager to review your case, please click "Appeal Decision" or "Talk to a Person" below.\n\n` +
      `${BUSINESS_PROFILE.signoff}`;
  }

  return {
    is_valid: decision === 'APPROVED',
    decision,
    decision_reason: decisionReason,
    reply: botReply,
    intent: baseEngine.intent === 'unknown' ? 'refund' : baseEngine.intent,
    confidence: Math.max(baseEngine.confidence || 0.85, 0.88),
    needs_human: decision === 'DECLINED' || detectedFlags.length > 0 || baseEngine.needs_human,
    flags: detectedFlags,
    days_since_purchase: daysSinceOrder,
    policy_applied: policyText,
    adjudicated_by: 'Refund AI Policy Engine (business.json + reply_engine)',
  };
}

// Expose globally as requested
window.evaluateRefundWithAI = evaluateRefundWithAI;

function updateEngineStatusUI() {
  const statusText = document.getElementById('engine-status-text');
  const modeTag = document.getElementById('chatbot-mode-tag');
  const hasKey = Boolean(getActiveAiApiKey());
  const modelName = getActiveAiModel();

  if (hasKey) {
    if (statusText) statusText.textContent = `Grok AI (${modelName}) Active`;
    if (modeTag) modeTag.textContent = `Grok API (${modelName}) + business.json`;
  } else {
    if (statusText) statusText.textContent = 'ReplyEngine + AI Validator Ready';
    if (modeTag) modeTag.textContent = 'business.json + reply_engine.py (Click 🔑 for live Grok API)';
  }
}

// ============================================================================
// 3. LOAD & SYNC ORDERS FROM SUPABASE / SEED DATA (DEMO-1001 .. DEMO-1010)
// ============================================================================
function isFoodItem(item) {
  const category = String(item?.category || '').toLowerCase();
  const sku = String(item?.sku || '');
  return category === 'food' || sku.toUpperCase().startsWith('SKU-FOOD-');
}

function eligibilityForItem(item) {
  const fromDb = (state.eligibility || []).find((row) => row.order_item_id === item.id);
  if (fromDb) return fromDb;
  if (isFoodItem(item)) {
    return {
      order_item_id: item.id,
      eligible: false,
      code: 'food',
      reason: 'Food items cannot be returned.',
    };
  }
  return null;
}

async function syncWithSupabase() {
  const userEmailPill = document.getElementById('user-email-pill');

  if (Backend) {
    state.currentUser = await Backend.getActiveSessionUser();
    if (Backend.isSupabaseLiveConfigured?.() && !state.currentUser) {
      window.location.href = 'index.html';
      return;
    }
    state.orders = await Backend.fetchOrdersWithItems();
    state.returns = Backend.fetchAccountReturns
      ? await Backend.fetchAccountReturns()
      : Backend.getAllReturns();
    state.contactRequests = Backend.getAllContactRequests();
    if (Backend.fetchReturnEligibility && state.currentUser) {
      try {
        state.eligibility = await Backend.fetchReturnEligibility(1);
      } catch (err) {
        console.warn('[orders] eligibility:', err);
        state.eligibility = [];
      }
    }
    if (Backend.fetchReturnPolicy && state.currentUser) {
      const policy = await Backend.fetchReturnPolicy();
      if (policy?.summary) {
        BUSINESS_PROFILE.policies.refund = policy.summary;
      }
    }
  }

  if (userEmailPill) {
    userEmailPill.textContent = state.currentUser?.email || 'customer.one@example.com';
  }

  renderOrdersPage();
}

// ============================================================================
// 4. RENDER ORDERS LIST & STATS
// ============================================================================
function getOrderEffectiveStatus(order) {
  const orderNum = order.order_number || order.order_code;
  const hasEscalation = state.contactRequests.some((c) => c.order_number === orderNum);
  if (hasEscalation || order.status === 'Escalated to Manager') {
    return 'Escalated to Manager';
  }
  const hasReturn = state.returns.some(
    (r) => r.order_number === orderNum || r.order_id === order.id
  );
  if (hasReturn || order.status === 'Refund Requested') {
    return 'Refund Requested';
  }
  return order.status || 'delivered';
}

function getStatusBadgeClass(effectiveStatus) {
  const low = String(effectiveStatus || '').toLowerCase();
  if (low === 'delivered' || low === 'completed') return 'status-delivered';
  if (low === 'shipped') return 'status-shipped';
  if (low === 'pending' || low === 'processing') return 'status-pending';
  if (low === 'cancelled') return 'status-cancelled';
  if (low === 'escalated to manager') return 'status-escalated';
  if (low === 'refund requested' || low === 'return / refund active') {
    return 'status-refund-requested';
  }
  return 'status-processing';
}

function getPaymentMethodBadgeHtml(paymentMethod) {
  const method = String(paymentMethod || 'Credit Card');
  if (method.toLowerCase().includes('google')) {
    return `<span class="payment-method-badge" title="Paid with Google Pay">G Pay • Google Pay</span>`;
  }
  if (method.toLowerCase().includes('eft')) {
    return `<span class="payment-method-badge" title="Paid via Instant EFT">🏦 Instant EFT</span>`;
  }
  return `<span class="payment-method-badge" title="${escapeHtml(method)}">💳 ${escapeHtml(method)}</span>`;
}

function updateStatsAndBadges() {
  const totalOrdersEl = document.getElementById('stat-total-orders');
  const refundOrdersEl = document.getElementById('stat-refund-orders');
  const navOrdersBadge = document.getElementById('nav-orders-count');

  const totalCount = state.orders.length;
  const activeRefundOrEscalationCount = state.orders.filter((o) => {
    const eff = getOrderEffectiveStatus(o);
    return eff === 'Refund Requested' || eff === 'Escalated to Manager';
  }).length;

  if (totalOrdersEl) totalOrdersEl.textContent = String(totalCount);
  if (refundOrdersEl) refundOrdersEl.textContent = String(activeRefundOrEscalationCount);
  if (navOrdersBadge) {
    navOrdersBadge.textContent = String(totalCount);
    navOrdersBadge.hidden = totalCount === 0;
  }
}

function renderOrdersPage() {
  updateStatsAndBadges();

  const listEl = document.getElementById('orders-list');
  const clearBtn = document.getElementById('clear-order-search-btn');
  if (!listEl) return;

  const query = state.searchQuery.trim().toLowerCase();
  if (clearBtn) {
    clearBtn.hidden = !query;
  }

  const filtered = state.orders.filter((order) => {
    const orderNum = String(order.order_number || order.order_code || '');
    const effectiveStatus = getOrderEffectiveStatus(order);

    if (state.statusFilter !== 'all') {
      const filterLow = state.statusFilter.toLowerCase();
      if (filterLow === 'refund requested') {
        if (effectiveStatus !== 'Refund Requested') return false;
      } else if (filterLow === 'escalated to manager') {
        if (effectiveStatus !== 'Escalated to Manager') return false;
      } else if (String(order.status || '').toLowerCase() !== filterLow) {
        return false;
      }
    }

    if (!query) return true;
    const codeMatch = orderNum.toLowerCase().includes(query);
    const shopMatch = String(order.shop_name || '').toLowerCase().includes(query);
    const items = order.order_items || order.items || [];
    const itemMatch = items.some(
      (it) =>
        String(it.product_name || it.name || '').toLowerCase().includes(query) ||
        String(it.sku || '').toLowerCase().includes(query)
    );
    return codeMatch || shopMatch || itemMatch;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="empty-card">
        <div class="empty-icon">🧾</div>
        <h2 class="empty-title">No matching orders found</h2>
        <p class="empty-subtitle">
          Try clearing the search or choosing All orders.
        </p>
        <div style="display:flex;justify-content:center;gap:10px;">
          <button type="button" id="empty-reset-filters-btn" class="btn-outline btn-sm">Reset Filters</button>
          <a href="store.html" class="btn-primary btn-sm" style="text-decoration:none;">← Browse Store</a>
        </div>
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered
    .map((order) => {
      const orderNum = order.order_number || order.order_code;
      const effectiveStatus = getOrderEffectiveStatus(order);
      const badgeClass = getStatusBadgeClass(effectiveStatus);
      const paymentMethod = order.payment_method || 'Credit Card';
      const rawStatus = String(order.status || 'delivered').toLowerCase();
      const canCancel = rawStatus === 'pending' || rawStatus === 'processing';
      const canOpenRefundBot = rawStatus !== 'cancelled';

      const isHighlighted =
        state.highlightedOrderCode &&
        orderNum.toUpperCase() === state.highlightedOrderCode.toUpperCase();

      const orderReturns = state.returns.filter(
        (r) => r.order_number === orderNum || r.order_id === order.id
      );
      const latestReturn = orderReturns[0] || null;
      const latestEscalation =
        state.contactRequests.find((c) => c.order_number === orderNum) || null;

      const items = order.order_items || order.items || [];
      const itemsHtml = items
        .map((item) => {
          const itemName = item.product_name || item.name || 'Order Item';
          const sku = item.sku || 'SKU-ITEM';
          const qty = Number(item.quantity || 1);
          const unitPrice = Number(item.unit_price ?? item.price ?? 0);
          const onSale = Boolean(item.on_sale);
          const decision = eligibilityForItem(item);
          const eligibilityHtml = decision
            ? `<div class="item-eligibility" data-sku="${escapeHtml(sku)}" data-eligible="${
                decision.eligible ? 'yes' : 'no'
              }" style="font-size:12px;margin-top:4px;color:${
                decision.eligible ? '#067647' : '#b42318'
              };">${
                decision.eligible
                  ? 'Eligible to return'
                  : escapeHtml(decision.reason || decision.detail || 'Not eligible')
              }</div>`
            : '';
          const catBadge = item.category === 'food' ? '🍔 Food' : '👕 Apparel';
          const thumbUrl =
            item.image_url ||
            'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=300&q=80';

          return `
            <div class="order-line-item">
              <div class="order-line-left">
                <img
                  src="${escapeHtml(thumbUrl)}"
                  alt="${escapeHtml(itemName)}"
                  class="order-line-thumb"
                />
                <div>
                  <div style="font-weight:600;color:#111111;margin-bottom:3px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span>${escapeHtml(itemName)}</span>
                    <span class="sku-pill" style="margin-bottom:0;">${escapeHtml(sku)}</span>
                    ${onSale ? '<span class="on-sale-badge">ON SALE</span>' : ''}
                  </div>
                  <div style="font-size:12px;color:#666666;">
                    <span class="item-cat-pill">${catBadge}</span>
                    <span>Qty: ${qty} × ${formatCurrency(unitPrice)}</span>
                  </div>
                  ${eligibilityHtml}
                </div>
              </div>
              <strong>${formatCurrency(unitPrice * qty)}</strong>
            </div>
          `;
        })
        .join('');

      let statusBannerHtml = '';
      if (effectiveStatus === 'Escalated to Manager' && latestEscalation) {
        const flagsList = Array.isArray(latestEscalation.flags) ? latestEscalation.flags : [];
        const flagsBadges =
          flagsList.length > 0
            ? flagsList.map((f) => `<span class="flag-tag">${escapeHtml(f)}</span>`).join('')
            : `<span class="flag-tag is-clean">Flags: None</span>`;

        statusBannerHtml = `
          <div class="escalation-tracker-box">
            <div class="escalation-tracker-header">
              <div>
                <strong>👤 Escalated to Manager (public.contact_requests • type="${escapeHtml(
                  latestEscalation.type
                )}")</strong>
              </div>
              <span style="font-size:12px;font-weight:600;">Forwarded to: ${escapeHtml(
                BUSINESS_PROFILE.contact.email
              )}</span>
            </div>
            <div style="margin-top:4px;font-size:12px;">
              Subject: <strong>${escapeHtml(latestEscalation.subject)}</strong> • Outside Business Hours: <strong>${
          latestEscalation.outside_business_hours ? 'Yes' : 'No'
        }</strong>
            </div>
            <div class="escalation-flags-inline">${flagsBadges}</div>
            <div class="refund-tracker-steps">
              <span class="tracker-step is-done">1. AI Adjudicated</span>
              <span>→</span>
              <span class="tracker-step is-done">2. forward-contact-requests Invoked</span>
              <span>→</span>
              <span class="tracker-step">3. Human Manager Review</span>
            </div>
          </div>
        `;
      } else if (latestReturn) {
        const logs = Array.isArray(latestReturn.return_logs) ? latestReturn.return_logs : [];
        const logHtml = logs.length
          ? `<ul class="return-status-history" style="margin:8px 0 0;padding-left:18px;font-size:12px;">${logs
              .map(
                (log) =>
                  `<li>${escapeHtml(log.new_status)}${
                    log.created_at ? ` — ${formatDateTime(log.created_at)}` : ''
                  }</li>`
              )
              .join('')}</ul>`
          : '';
        const track = latestReturn.tracking || (latestReturn.courier_tracking || [])[0] || null;
        const events = track?.courier_tracking_events || [];
        const trackingHtml = track
          ? `<div class="courier-tracking" data-waybill="${escapeHtml(track.waybill_number || '')}" style="margin-top:8px;font-size:12px;">
              <strong>The Courier Guy</strong> · ${escapeHtml(track.waybill_number || '')} · ${escapeHtml(track.status || '')}
              ${
                events.length
                  ? `<ul style="margin:4px 0 0;padding-left:18px;">${events
                      .map(
                        (ev) =>
                          `<li>${escapeHtml(ev.status)}${ev.location ? ` · ${escapeHtml(ev.location)}` : ''}</li>`
                      )
                      .join('')}</ul>`
                  : ''
              }
              <div style="margin-top:6px;">
                <button type="button" class="btn-outline btn-sm" data-refresh-tracking="${escapeHtml(
                  track.waybill_number || ''
                )}">Refresh tracking</button>
              </div>
            </div>`
          : `<div style="margin-top:6px;font-size:12px;">Tracking appears after the return is approved and the parcel is collected.</div>`;
        statusBannerHtml = `
          <div class="refund-tracker-box" data-return-status="${escapeHtml(latestReturn.status || '')}">
            <div>
              <strong>Return <code class="inline-code">${escapeHtml(latestReturn.id || '')}</code></strong>
            </div>
            <div style="margin-top:4px;font-size:12px;opacity:0.9;">
              Status: <strong>${escapeHtml(latestReturn.status || '')}</strong> • Reason: "${escapeHtml(
          latestReturn.reason || ''
        )}"
            </div>
            <div style="margin-top:6px;font-size:12px;">Status history</div>
            ${logHtml}
            ${trackingHtml}
          </div>
        `;
      }

      const refundBtnLabel =
        effectiveStatus === 'Escalated to Manager'
          ? 'View Escalation & AI Chat'
          : latestReturn
          ? 'Appeal / Talk to a Person'
          : 'Request Refund';

      return `
        <article class="order-card ${isHighlighted ? 'is-highlighted' : ''}" data-order-code="${escapeHtml(orderNum)}">
          <div class="order-card-header">
            <div class="order-id-group">
              <span class="order-code-pill">${escapeHtml(orderNum)}</span>
              <span class="order-date" title="Ordered At">Ordered: ${formatDateTime(order.ordered_at || order.created_at)}</span>
              ${
                order.delivered_at
                  ? `<span class="order-date" title="Delivered At">• Delivered: ${formatDateTime(order.delivered_at)}</span>`
                  : ''
              }
              ${getPaymentMethodBadgeHtml(paymentMethod)}
            </div>
            <div class="order-header-right">
              <span class="order-header-total">${formatCurrency(order.total_amount)}</span>
              <span class="status-badge ${badgeClass}">${escapeHtml(effectiveStatus)}</span>
            </div>
          </div>

          <div class="order-items-grid">
            ${itemsHtml}
          </div>

          <div class="order-card-footer">
            <div class="order-total-block" style="font-size:12.5px;color:#555;">
              Shop: <strong style="color:#111;">${escapeHtml(order.shop_name || 'Refund Sandton')}</strong>
              • Customer: <span style="color:#111;">${escapeHtml(order.customer_email || 'customer.one@example.com')}</span>
            </div>
            <div class="order-action-btns">
              ${
                canCancel
                  ? `<button type="button" class="btn-danger-outline" data-cancel-order="${escapeHtml(
                      orderNum
                    )}">Cancel Order</button>`
                  : ''
              }
              ${
                canOpenRefundBot
                  ? `<button type="button" class="btn-primary btn-sm" data-request-refund="${escapeHtml(
                      orderNum
                    )}">${escapeHtml(refundBtnLabel)}</button>`
                  : ''
              }
            </div>
          </div>

          ${statusBannerHtml}
        </article>
      `;
    })
    .join('');
}

// ============================================================================
// 5. CANCEL ORDER HANDLER
// ============================================================================
async function handleCancelOrder(orderNumber) {
  const order = state.orders.find(
    (o) => (o.order_number || o.order_code) === orderNumber
  );
  if (!order) return;

  const confirmed = window.confirm(
    `Cancel Order ${orderNumber}?\n\nThis updates public.orders.status to 'cancelled'.`
  );
  if (!confirmed) return;

  if (Backend) {
    await Backend.cancelOrderInBackend(orderNumber);
    state.orders = await Backend.fetchOrdersWithItems();
  } else {
    order.status = 'cancelled';
  }

  renderOrdersPage();
  showToast(`Order ${orderNumber} has been cancelled.`);
}

// ============================================================================
// 6. AI REFUND CHATBOT & TYPING ANIMATION
// ============================================================================
function appendChatMessage(role, text, extraHtml = '') {
  const stream = document.getElementById('ai-chat-stream');
  if (!stream) return;

  const timestamp = new Date().toLocaleTimeString('en-ZA', {
    hour: '2-digit',
    minute: '2-digit',
  });

  state.chatTranscript.push({
    role: role === 'user' ? 'Customer' : 'Returns Trade Agent',
    text,
    timestamp,
  });

  const wrapper = document.createElement('div');
  wrapper.className = `chat-msg ${role === 'user' ? 'chat-msg-user' : 'chat-msg-bot'}`;
  wrapper.innerHTML = `
    <span class="chat-msg-sender">${
      role === 'user' ? 'You (Customer)' : 'Returns Trade Agent'
    } • ${timestamp}</span>
    <div class="chat-msg-bubble">${escapeHtml(text)}</div>
    ${extraHtml}
  `;

  stream.appendChild(wrapper);
  stream.scrollTop = stream.scrollHeight;
}

function showChatTypingIndicator() {
  const stream = document.getElementById('ai-chat-stream');
  if (!stream) return null;

  const typingEl = document.createElement('div');
  typingEl.className = 'chat-msg chat-msg-bot';
  typingEl.id = 'ai-typing-indicator';
  typingEl.innerHTML = `
    <span class="chat-msg-sender">Returns Trade Agent is checking your request...</span>
    <div class="typing-indicator-bubble" aria-label="AI is typing">
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    </div>
  `;
  stream.appendChild(typingEl);
  stream.scrollTop = stream.scrollHeight;
  return typingEl;
}

function removeChatTypingIndicator() {
  const existing = document.getElementById('ai-typing-indicator');
  if (existing) existing.remove();
}

function buildDecisionCardHtml(adjudication, refundAmount, waybillInfo = null) {
  const isApproved = adjudication.decision === 'APPROVED';
  const cardClass = isApproved ? 'is-approved' : 'is-declined';
  const badgeLabel = isApproved
    ? 'Return approved'
    : 'Return not accepted';
  const flagsArr = Array.isArray(adjudication.flags) ? adjudication.flags : [];

  const flagsHtml =
    flagsArr.length > 0
      ? flagsArr
          .map((fl) => `<span class="diag-pill is-flag">⚠️ ${escapeHtml(fl)}</span>`)
          .join('')
      : `<span class="diag-pill">Flags: None</span>`;

  return `
    <div class="ai-decision-card ${cardClass}">
      <div class="ai-decision-header">
        <span class="ai-decision-badge">${badgeLabel}</span>
        <span class="ai-decision-amount">${formatCurrency(refundAmount)}</span>
      </div>
      <div class="ai-decision-reason">
        ${escapeHtml(adjudication.decision_reason)}
      </div>
      <div class="ai-diagnostics-row">
        <span class="diag-pill">Engine: ${escapeHtml(adjudication.adjudicated_by || 'Refund AI')}</span>
        <span class="diag-pill">Intent: ${escapeHtml(adjudication.intent || 'refund')}</span>
        <span class="diag-pill">Confidence: ${Math.round((adjudication.confidence || 0.88) * 100)}%</span>
        <span class="diag-pill">Order Age: ${adjudication.days_since_purchase ?? 0}d</span>
        ${flagsHtml}
      </div>
    </div>
  `;
}

function renderPostDecisionActionButtons(adjudication) {
  const actionsBar = document.getElementById('post-decision-actions');
  const needsHumanBanner = document.getElementById('needs-human-alert');
  const appealBtn = document.getElementById('btn-appeal-decision');
  const talkBtn = document.getElementById('btn-talk-person');

  if (!actionsBar) return;
  actionsBar.hidden = false;

  const isDeclined = adjudication?.decision === 'DECLINED';
  const hasRiskFlags =
    Array.isArray(adjudication?.flags) && adjudication.flags.length > 0;
  const autoHighlight =
    Boolean(adjudication?.needs_human) || isDeclined || hasRiskFlags;

  actionsBar.classList.toggle('is-auto-highlighted', autoHighlight);
  if (needsHumanBanner) {
    needsHumanBanner.hidden = !(
      hasRiskFlags ||
      adjudication?.intent === 'complaint' ||
      adjudication?.intent === 'human'
    );
  }

  if (appealBtn) {
    appealBtn.className = isDeclined
      ? 'btn-primary post-action-btn'
      : 'btn-outline post-action-btn';
  }
  if (talkBtn) {
    talkBtn.className = 'btn-outline post-action-btn';
  }
}

function openRefundModal(orderNumber) {
  const order = state.orders.find(
    (o) => (o.order_number || o.order_code) === orderNumber
  );
  if (!order) return;

  state.activeRefundOrder = order;
  state.activeAdjudication = null;
  state.activeReturnRecord = null;
  state.chatTranscript = [];

  const orderNum = order.order_number || order.order_code;
  const paymentMethod = order.payment_method || 'Credit Card';
  const existingReturns = state.returns.filter(
    (r) => r.order_number === orderNum || r.order_id === order.id
  );
  const existingReturn = existingReturns[0] || null;
  const existingEscalation = state.contactRequests.find(
    (c) => c.order_number === orderNum
  );

  document.getElementById('refund-modal-subtitle').textContent = `Order ${orderNum} • Status: ${order.status} • Ordered ${formatDateTime(order.ordered_at || order.created_at)} • Paid via ${paymentMethod}`;
  document.getElementById('refund-destination-method').textContent = `Original Payment Method (${paymentMethod})`;
  document.getElementById('refund-reason').value = existingReturn?.reason || '';
  document.getElementById('refund-notes').value = '';
  document.getElementById('refund-alert').hidden = true;
  document.getElementById('refund-btn-text').textContent = 'Submit Refund';

  // Reset right-side panels
  document.getElementById('post-decision-actions').hidden = true;
  document.getElementById('escalation-composer').hidden = true;
  document.getElementById('manager-email-card').hidden = true;
  document.getElementById('email-preview-container').hidden = true;
  document.getElementById('escalation-final-note').value = '';

  const items = order.order_items || order.items || [];
  const checklist = document.getElementById('refund-items-checklist');
  checklist.innerHTML = items
    .map((item, idx) => {
      const itemName = item.product_name || item.name || 'Item';
      const sku = item.sku || `SKU-${idx + 1}`;
      const qty = Number(item.quantity || 1);
      const unitPrice = Number(item.unit_price ?? item.price ?? 0);
      const lineTotal = unitPrice * qty;
      const decision = eligibilityForItem(item);
      const eligible = !decision || decision.eligible === true;
      const reasonText = decision
        ? decision.eligible
          ? 'Eligible to return'
          : decision.reason || decision.detail || 'Not eligible'
        : '';
      return `
        <label class="refund-check-item">
          <span class="refund-check-left">
            <input
              type="checkbox"
              class="refund-item-checkbox"
              data-line-amount="${lineTotal}"
              data-line-name="${escapeHtml(itemName)}"
              data-line-sku="${escapeHtml(sku)}"
              data-item-index="${idx}"
              value="${idx}"
              ${eligible ? 'checked' : ''}
            />
            <span>${qty}× ${escapeHtml(itemName)} <small style="color:#666;">(${escapeHtml(sku)}${
        item.on_sale ? ' • ON SALE' : ''
      })</small>
              ${
                reasonText
                  ? `<span class="item-eligibility" data-sku="${escapeHtml(sku)}" data-eligible="${
                      eligible ? 'yes' : 'no'
                    }" style="display:block;font-size:12px;color:${eligible ? '#067647' : '#b42318'};">${escapeHtml(
                      reasonText
                    )}</span>`
                  : ''
              }
            </span>
          </span>
          <strong>${formatCurrency(lineTotal)}</strong>
        </label>
      `;
    })
    .join('');

  updateEstimatedRefundAmount();

  const stream = document.getElementById('ai-chat-stream');
  if (stream) stream.innerHTML = '';

  appendChatMessage(
    'bot',
    `Hello! Welcome to ${BUSINESS_PROFILE.name}. Choose an item and a reason, then submit the return. It stays submitted until our team reviews it.\n\nPolicy: "${BUSINESS_PROFILE.policies.refund}"`
  );

  if (existingReturn) {
    state.activeReturnRecord = existingReturn;
    const status = existingReturn.status || 'submitted';
    const restoredAdjudication = {
      decision: status === 'approved' || status === 'refunded' ? 'APPROVED' : status === 'rejected' ? 'DECLINED' : 'SUBMITTED',
      decision_reason: `Database status: ${status}.`,
      intent: 'refund',
      confidence: 0.9,
      flags: existingReturn.flags || [],
      days_since_purchase: 0,
      needs_human: status === 'rejected',
      refund_amount: existingReturn.refund_amount || order.total_amount,
      reason: existingReturn.reason,
    };
    state.activeAdjudication = restoredAdjudication;

    appendChatMessage(
      'bot',
      `This return is ${status}${status === 'submitted' ? ' and awaiting review' : ''}.`
    );
    if (status === 'rejected' || status === 'approved' || status === 'refunded') {
      renderPostDecisionActionButtons(restoredAdjudication);
    }

    if (existingEscalation) {
      showDispatchedEmailCard({
        to: BUSINESS_PROFILE.contact.email,
        subject: existingEscalation.subject,
        body: existingEscalation.email_body || existingEscalation.message,
        escalationType: existingEscalation.type === 'appeal' ? 'Appeal' : 'Talk to Person',
        edgeFunctionInvoked: true,
      });
    }
  }

  document.getElementById('refund-modal').hidden = false;
}

function updateEstimatedRefundAmount() {
  const checked = document.querySelectorAll('.refund-item-checkbox:checked');
  let sum = 0;
  checked.forEach((cb) => {
    sum += Number(cb.getAttribute('data-line-amount') || 0);
  });
  const amountEl = document.getElementById('refund-estimated-amount');
  if (amountEl) amountEl.textContent = formatCurrency(sum);
  return sum;
}

// Interactive Chat Input (Ask ReplyEngine about hours, location, delivery, or policies)
async function handleChatInputSubmit(event) {
  event.preventDefault();
  const inputEl = document.getElementById('ai-chat-input');
  const message = String(inputEl?.value || '').trim();
  if (!message) return;

  inputEl.value = '';
  appendChatMessage('user', message);

  showChatTypingIndicator();
  await new Promise((r) => setTimeout(r, 550));
  removeChatTypingIndicator();

  const engineRes = ReplyEngineJS.handle({ message }, BUSINESS_PROFILE);
  const fl = Array.isArray(engineRes.flags) ? engineRes.flags : [];

  const diagHtml =
    fl.length > 0
      ? `<div class="ai-diagnostics-row" style="margin-top:6px;">
          <span class="diag-pill">Intent: ${escapeHtml(engineRes.intent)} (${Math.round(
          (engineRes.confidence || 0.75) * 100
        )}%)</span>
          ${fl.map((f) => `<span class="diag-pill is-flag">⚠️ ${escapeHtml(f)}</span>`).join('')}
        </div>`
      : '';

  appendChatMessage('bot', engineRes.reply, diagHtml);

  if (engineRes.needs_human) {
    if (!state.activeAdjudication) {
      state.activeAdjudication = {
        decision: 'DECLINED',
        decision_reason: `ReplyEngine flagged message for human assistance (intent: ${engineRes.intent}).`,
        intent: engineRes.intent,
        confidence: engineRes.confidence,
        flags: fl,
        needs_human: true,
      };
    } else {
      state.activeAdjudication.needs_human = true;
      state.activeAdjudication.flags = Array.from(
        new Set([...(state.activeAdjudication.flags || []), ...fl])
      );
    }
    renderPostDecisionActionButtons(state.activeAdjudication);
  }
}

// Submit Refund Form -> Show Typing Animation -> evaluateRefundWithAI -> Save to public.returns & public.return_logs
async function handleRefundSubmit(event) {
  event.preventDefault();
  const order = state.activeRefundOrder;
  if (!order) return;

  const alertEl = document.getElementById('refund-alert');
  alertEl.hidden = true;

  const checkedBoxes = Array.from(document.querySelectorAll('.refund-item-checkbox:checked'));
  if (checkedBoxes.length === 0) {
    alertEl.textContent = 'Please select at least one item in the order to refund.';
    alertEl.hidden = false;
    return;
  }

  const reason = document.getElementById('refund-reason').value.trim();
  if (!reason) {
    alertEl.textContent = 'Please choose a refund reason from the dropdown.';
    alertEl.hidden = false;
    return;
  }

  const notes = document.getElementById('refund-notes').value.trim();
  const allOrderItems = order.order_items || order.items || [];
  const selectedItems = checkedBoxes
    .map((cb) => allOrderItems[Number(cb.getAttribute('data-item-index'))])
    .filter(Boolean);
  const selectedNames = selectedItems.map((it) => `${it.product_name || it.name} (${it.sku || 'SKU'})`);
  const refundAmount = updateEstimatedRefundAmount();

  const submitBtn = document.getElementById('submit-refund-btn');
  const spinner = document.getElementById('refund-spinner');
  const btnText = document.getElementById('refund-btn-text');

  submitBtn.disabled = true;
  spinner.hidden = false;
  btnText.textContent = 'AI Evaluating...';

  const orderNum = order.order_number || order.order_code;

  // 1. Append customer's refund submission to the chat stream
  const userSummaryMsg =
    `Submitted Refund Request for ${orderNum}: ${selectedNames.join(', ')} (${formatCurrency(refundAmount)})\n` +
    `Reason: ${reason}` +
    (notes ? `\nNotes: ${notes}` : '');
  appendChatMessage('user', userSummaryMsg);

  // 2. Show AI typing animation in the chatbot
  showChatTypingIndicator();

  try {
    await new Promise((resolve) => setTimeout(resolve, 950));

    // 3. Call modular evaluateRefundWithAI(order, refundDetails, chatHistory)
    const adjudication = await evaluateRefundWithAI(
      order,
      {
        reason,
        notes,
        selectedItems,
        refundAmount,
      },
      state.chatTranscript
    );

    removeChatTypingIndicator();

    // 4. The database records the return as submitted. This screen does not approve it.
    let createdReturns = [];
    if (Backend) {
      createdReturns = await Backend.createReturnRecords({
        order,
        selectedItems,
        reason,
        notes,
        aiDecision: adjudication.decision,
        aiReason: adjudication.decision_reason,
        flags: adjudication.flags,
        refundAmount,
      });
      state.activeReturnRecord = createdReturns[0] || null;
      state.returns = Backend.fetchAccountReturns
        ? await Backend.fetchAccountReturns()
        : Backend.getAllReturns();
    }

    state.activeAdjudication = {
      ...adjudication,
      decision: 'SUBMITTED',
      decision_reason: 'The return was received and is awaiting review.',
      selected_items: selectedNames,
      reason,
      notes,
      refund_amount: refundAmount,
    };

    const confirmationHtml = (createdReturns || [])
      .map((ret) => {
        const status = ret.status || 'submitted';
        const logs = Array.isArray(ret.return_logs) ? ret.return_logs : [];
        const logHtml = logs.length
          ? `<ul class="return-status-history" style="margin:8px 0 0;padding-left:18px;">${logs
              .map(
                (log) =>
                  `<li>${escapeHtml(log.new_status)} — ${formatDateTime(log.created_at)}</li>`
              )
              .join('')}</ul>`
          : '';
        return `
          <div class="refund-tracker-box return-confirmation" data-return-id="${escapeHtml(
            ret.id
          )}" data-return-status="${escapeHtml(status)}">
            <strong>Return received</strong>
            <div>Reference: <code class="inline-code">${escapeHtml(ret.id)}</code></div>
            <div>Status: <strong>${escapeHtml(status)}</strong> — awaiting review</div>
            <div>We email you when the status changes. Collection is arranged only after approval.</div>
            ${logHtml ? `<div>Status history</div>${logHtml}` : ''}
          </div>`;
      })
      .join('');

    appendChatMessage(
      'bot',
      `We received your return for ${orderNum}. Status: submitted. It is awaiting review. Only our team can approve, reject, or refund it.`,
      confirmationHtml
    );

    // 6. Immediately display Post-Decision Action Bar ("⚖️ Appeal Decision" & "👤 Talk to a Person")
    renderPostDecisionActionButtons(adjudication);

    renderOrdersPage();
    showToast(`Return submitted for ${orderNum}. Awaiting review.`);
  } catch (err) {
    removeChatTypingIndicator();
    const message = err?.message || 'Could not submit the return.';
    alertEl.textContent = message;
    alertEl.hidden = false;
    appendChatMessage('bot', message);
  } finally {
    submitBtn.disabled = false;
    spinner.hidden = true;
    btnText.textContent = 'Submit Refund';
  }
}

// ============================================================================
// 7. "APPEAL DECISION" / "TALK TO A PERSON" & EDGE FUNCTION ESCALATION
//    (Inserts into public.contact_requests & invokes forward-contact-requests)
// ============================================================================
function openEscalationComposer(escalationType) {
  state.activeEscalationType = escalationType; // 'Appeal' or 'Talk to Person'
  const composer = document.getElementById('escalation-composer');
  const titleEl = document.getElementById('escalation-composer-title');
  const noteEl = document.getElementById('escalation-final-note');

  if (!composer) return;
  composer.hidden = false;

  if (titleEl) {
    titleEl.textContent =
      escalationType === 'Appeal'
        ? '⚖️ Appeal AI Decision to Manager (public.contact_requests • type="appeal")'
        : '👤 Talk to a Person (public.contact_requests • type="support")';
  }
  if (noteEl) {
    noteEl.placeholder =
      escalationType === 'Appeal'
        ? 'Add any final message for the manager explaining why you are appealing (optional)...'
        : 'Add any final message or preferred callback number for our team (optional)...';
    noteEl.focus();
  }
}

function buildManagerEscalationEmailPayload(order, adjudication, escalationType, appealComment) {
  const orderNum = order.order_number || order.order_code;
  const customerEmail =
    state.currentUser?.email || order.customer_email || 'customer.one@example.com';
  const customerName =
    state.currentUser?.user_metadata?.full_name ||
    customerEmail.split('@')[0] ||
    'Customer One';
  const customerPhone = state.currentUser?.user_metadata?.phone || '+27 82 111 2222';
  const refundAmount = Number(adjudication?.refund_amount || order.total_amount || 0);
  const labelType = escalationType === 'Appeal' ? 'Appeal' : 'Support / Talk to Person';

  const subject = `[ESCALATION - ${labelType}] Order ${orderNum} — ${customerName} (${formatCurrency(refundAmount)})`;

  const appealFlags = ReplyEngineJS
    ? ReplyEngineJS.flags(appealComment || '', BUSINESS_PROFILE)
    : [];
  const allFlags = Array.from(
    new Set([...(adjudication?.flags || []), ...appealFlags])
  );
  const flagsFormatted = allFlags.length > 0 ? allFlags.join(', ') : 'None';

  const items = order.order_items || order.items || [];
  const orderItemsLines = items
    .map(
      (item) =>
        `  - ${item.quantity || 1}x ${item.product_name || item.name} (${item.sku || 'SKU'}${
          item.on_sale ? ', ON SALE' : ''
        }) @ ${formatCurrency(item.unit_price ?? item.price ?? 0)}`
    )
    .join('\n');

  const selectedItemsList =
    Array.isArray(adjudication?.selected_items) && adjudication.selected_items.length > 0
      ? adjudication.selected_items.join(', ')
      : items.map((i) => i.product_name || i.name).join(', ');

  const transcriptLines =
    state.chatTranscript.length > 0
      ? state.chatTranscript
          .map((entry) => `[${entry.timestamp}] ${entry.role}:\n${entry.text}`)
          .join('\n\n')
      : 'No prior chat messages recorded.';

  const outsideHours = Backend ? !Backend.isBusinessHours() : false;
  const nextOpening = Backend ? Backend.nextBusinessOpening() : 'Next business day 08:00 SAST';

  const body = [
    `====================================================================`,
    `REFUND ESCALATION SUMMARY — ${labelType.toUpperCase()}`,
    `To: ${BUSINESS_PROFILE.contact.email} (${BUSINESS_PROFILE.name} Owner / Manager)`,
    `Edge Function: forward-contact-requests`,
    `Outside Business Hours: ${outsideHours ? `Yes (Next opening: ${nextOpening})` : 'No (Within SAST hours)'}`,
    `Generated: ${new Date().toLocaleString('en-ZA')}`,
    `====================================================================`,
    ``,
    `1. CUSTOMER DETAILS`,
    `--------------------------------------------------------------------`,
    `Full Name:        ${customerName}`,
    `Email Address:    ${customerEmail}`,
    `Phone Number:     ${customerPhone}`,
    `Location:         ${order.shipping_address || BUSINESS_PROFILE.location}`,
    ``,
    `2. ORDER SUMMARY (public.orders & public.order_items)`,
    `--------------------------------------------------------------------`,
    `Order Number:     ${orderNum}`,
    `Shop Name:        ${order.shop_name || 'Refund Sandton'}`,
    `Order Status:     ${order.status}`,
    `Ordered At:       ${formatDateTime(order.ordered_at || order.created_at)}`,
    `Delivered At:     ${formatDateTime(order.delivered_at)}`,
    `Order Total:      ${formatCurrency(order.total_amount)}`,
    `Items Purchased:`,
    orderItemsLines,
    ``,
    `3. REFUND & APPEAL DETAILS (public.returns & public.contact_requests)`,
    `--------------------------------------------------------------------`,
    `Contact Type:     ${escalationType === 'Appeal' ? 'appeal' : 'support'}`,
    `Return ID:        ${state.activeReturnRecord?.id || 'Linked automatically'}`,
    `Selected Items:   ${selectedItemsList}`,
    `Refund Amount:    ${formatCurrency(refundAmount)}`,
    `Stated Reason:    ${adjudication?.reason || document.getElementById('refund-reason')?.value || 'Customer escalation'}`,
    `Customer Notes:   ${adjudication?.notes || document.getElementById('refund-notes')?.value || 'None provided'}`,
    `Escalation Note:  ${appealComment || 'Customer requested human manager review.'}`,
    ``,
    `4. AI DECISION & REPLY ENGINE FLAGS`,
    `--------------------------------------------------------------------`,
    `AI Decision:      ${adjudication?.decision || 'DECLINED'}`,
    `AI Explanation:   ${adjudication?.decision_reason || 'Escalated to human team member.'}`,
    `Detected Intent:  ${adjudication?.intent || 'human'}`,
    `Risk Flags:       ${flagsFormatted}`,
    ``,
    `5. CHAT TRANSCRIPT`,
    `--------------------------------------------------------------------`,
    transcriptLines,
    `====================================================================`,
  ].join('\n');

  return {
    to: BUSINESS_PROFILE.contact.email,
    subject,
    body,
    escalationType,
    contactType: escalationType === 'Appeal' ? 'appeal' : 'support',
    order_number: orderNum,
    return_id: state.activeReturnRecord?.id || null,
    flags: allFlags,
  };
}

function showDispatchedEmailCard(summaryPayload) {
  const card = document.getElementById('manager-email-card');
  const metaEl = document.getElementById('manager-email-meta');
  const toEl = document.getElementById('preview-email-to');
  const subjectEl = document.getElementById('preview-email-subject');
  const bodyEl = document.getElementById('preview-email-body');
  const mailtoLink = document.getElementById('mailto-fallback-link');

  if (!card) return;
  card.hidden = false;

  if (metaEl) {
    metaEl.textContent = `Sent to ${summaryPayload.to} via forward-contact-requests • Status: Escalated to Manager`;
  }
  if (toEl) toEl.textContent = summaryPayload.to;
  if (subjectEl) subjectEl.textContent = summaryPayload.subject;
  if (bodyEl) bodyEl.textContent = summaryPayload.body;

  if (mailtoLink) {
    const mailtoHref = `mailto:${encodeURIComponent(summaryPayload.to)}?subject=${encodeURIComponent(
      summaryPayload.subject
    )}&body=${encodeURIComponent(summaryPayload.body)}`;
    mailtoLink.setAttribute('href', mailtoHref);
  }
}

async function handleSendEscalationToManager() {
  const order = state.activeRefundOrder;
  if (!order) return;

  const orderNum = order.order_number || order.order_code;
  const appealComment = document.getElementById('escalation-final-note')?.value.trim() || '';
  const escalationType = state.activeEscalationType || 'Appeal';

  const sendBtn = document.getElementById('send-escalation-btn');
  const spinner = document.getElementById('escalation-spinner');
  const btnText = document.getElementById('send-escalation-btn-text');

  if (sendBtn) sendBtn.disabled = true;
  if (spinner) spinner.hidden = false;
  if (btnText) btnText.textContent = 'Forwarding via Edge Function...';

  try {
    // 1. Ensure a return record exists if type === 'appeal' (enforced by constraint appeal_needs_return in 20261113120000_init_schema.sql)
    if (!state.activeReturnRecord && Backend) {
      const items = order.order_items || order.items || [];
      const created = await Backend.createReturnRecords({
        order,
        selectedItems: items.slice(0, 1),
        reason: state.activeAdjudication?.reason || 'Customer Escalation / Appeal',
        notes: appealComment || 'Escalated to manager',
        aiDecision: state.activeAdjudication?.decision || 'DECLINED',
        aiReason: state.activeAdjudication?.decision_reason || 'Customer requested appeal',
        flags: state.activeAdjudication?.flags || [],
        refundAmount: order.total_amount,
      });
      state.activeReturnRecord = created[0] || null;
      state.returns = Backend.fetchAccountReturns
        ? await Backend.fetchAccountReturns()
        : Backend.getAllReturns();
    }

    // 2. Append customer action to chat transcript
    const customerMsg =
      escalationType === 'Appeal'
        ? `⚖️ Appeal Decision${appealComment ? `: "${appealComment}"` : ''}`
        : `👤 Talk to a Person${appealComment ? `: "${appealComment}"` : ''}`;
    appendChatMessage('user', customerMsg);

    // 3. Chatbot responds with the exact ReplyEngine human escalation message
    const exactHumanReply = ReplyEngineJS
      ? ReplyEngineJS.getHumanEscalationReply(BUSINESS_PROFILE)
      : `Of course. A team member will be with you shortly. You can also call +27 11 000 0000 or WhatsApp +27 82 000 0000.\n\nKind regards,\nThe Returns Trade Agent Team`;
    appendChatMessage('bot', exactHumanReply);

    // 4. Build summarized email & insert into public.contact_requests + invoke forward-contact-requests Edge Function
    const summaryPayload = buildManagerEscalationEmailPayload(
      order,
      state.activeAdjudication,
      escalationType,
      appealComment
    );
    state.lastEmailSummaryPayload = summaryPayload;

    if (Backend) {
      await Backend.createContactEscalation({
        type: summaryPayload.contactType,
        returnId: summaryPayload.return_id,
        orderNumber: orderNum,
        subject: summaryPayload.subject,
        message: appealComment || summaryPayload.body,
        emailBody: summaryPayload.body,
        flags: summaryPayload.flags,
      });
      state.contactRequests = Backend.getAllContactRequests();
    }

    // 5. Show Manager Email Dispatched card & email preview inside the modal
    showDispatchedEmailCard(summaryPayload);
    document.getElementById('escalation-composer').hidden = true;
    document.getElementById('email-preview-container').hidden = false;

    renderOrdersPage();
    showToast(`Manager escalation sent to ${BUSINESS_PROFILE.contact.email}`);
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    if (spinner) spinner.hidden = true;
    if (btnText) btnText.textContent = 'Send to Manager / Owner (info@example.co.za)';
  }
}

// ============================================================================
// 8. EVENT LISTENERS & INITIALIZATION
// ============================================================================
function initOrdersPage() {
  const params = new URLSearchParams(window.location.search);
  const orderParam = params.get('order');
  const searchInput = document.getElementById('order-search-input');

  if (orderParam) {
    state.highlightedOrderCode = orderParam.trim();
    state.searchQuery = orderParam.trim();
    if (searchInput) searchInput.value = orderParam.trim();
  }

  // Search Input
  searchInput?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderOrdersPage();
  });

  // Clear Search Button
  document.getElementById('clear-order-search-btn')?.addEventListener('click', () => {
    state.searchQuery = '';
    state.highlightedOrderCode = '';
    if (searchInput) searchInput.value = '';
    if (window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    renderOrdersPage();
  });

  // Status Filter Pills
  document.querySelectorAll('.filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      state.statusFilter = pill.getAttribute('data-status-filter') || 'all';
      document.querySelectorAll('.filter-pill').forEach((p) => {
        p.classList.toggle('is-active', p === pill);
      });
      renderOrdersPage();
    });
  });

  // Sync Button
  document.getElementById('refresh-orders-btn')?.addEventListener('click', async () => {
    await syncWithSupabase();
    showToast('Orders synced with Supabase & local seed data');
  });

  // Delegated Clicks inside Orders List
  document.getElementById('orders-list')?.addEventListener('click', async (e) => {
    const resetBtn = e.target.closest('#empty-reset-filters-btn');
    if (resetBtn) {
      state.searchQuery = '';
      state.statusFilter = 'all';
      state.highlightedOrderCode = '';
      if (searchInput) searchInput.value = '';
      document.querySelectorAll('.filter-pill').forEach((p) => {
        p.classList.toggle('is-active', p.getAttribute('data-status-filter') === 'all');
      });
      renderOrdersPage();
      return;
    }

    const cancelBtn = e.target.closest('[data-cancel-order]');
    if (cancelBtn) {
      handleCancelOrder(cancelBtn.getAttribute('data-cancel-order'));
      return;
    }

    const refundBtn = e.target.closest('[data-request-refund]');
    if (refundBtn) {
      openRefundModal(refundBtn.getAttribute('data-request-refund'));
      return;
    }

    const trackingBtn = e.target.closest('[data-refresh-tracking]');
    if (trackingBtn && Backend?.syncCourierTracking) {
      const waybill = trackingBtn.getAttribute('data-refresh-tracking');
      trackingBtn.disabled = true;
      try {
        await Backend.syncCourierTracking(waybill);
        state.returns = await Backend.fetchAccountReturns();
        renderOrdersPage();
        showToast('Courier tracking updated');
      } catch (err) {
        showToast(err?.message || 'Could not refresh tracking');
      }
    }
  });

  // Quick Demo Scenario Chips inside Refund Form
  document.querySelectorAll('.scenario-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const presetReason = chip.getAttribute('data-preset-reason') || '';
      const presetNote = chip.getAttribute('data-preset-note') || '';
      const reasonEl = document.getElementById('refund-reason');
      const notesEl = document.getElementById('refund-notes');
      if (reasonEl && presetReason) reasonEl.value = presetReason;
      if (notesEl) notesEl.value = presetNote;
    });
  });

  // Refund Modal Close
  document.getElementById('close-refund-modal-btn')?.addEventListener('click', () => {
    document.getElementById('refund-modal').hidden = true;
  });

  document.getElementById('refund-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'refund-modal') {
      e.target.hidden = true;
    }
  });

  // AI / Grok API Key Config Bar
  const grokKeyInput = document.getElementById('grok-api-key-input');
  const grokModelSelect = document.getElementById('grok-model-select');
  if (grokKeyInput && getActiveAiApiKey()) {
    grokKeyInput.value = getActiveAiApiKey();
  }
  if (grokModelSelect) {
    grokModelSelect.value = getActiveAiModel();
  }

  document.getElementById('toggle-grok-key-btn')?.addEventListener('click', () => {
    const bar = document.getElementById('grok-config-bar');
    if (bar) {
      bar.hidden = !bar.hidden;
      if (!bar.hidden) grokKeyInput?.focus();
    }
  });

  document.getElementById('save-grok-key-btn')?.addEventListener('click', () => {
    const keyVal = grokKeyInput?.value.trim() || '';
    const modelVal = grokModelSelect?.value || 'grok-3-mini';
    try {
      if (keyVal) {
        localStorage.setItem(AI_CONFIG.STORAGE_KEY, keyVal);
      } else {
        localStorage.removeItem(AI_CONFIG.STORAGE_KEY);
      }
      localStorage.setItem(AI_CONFIG.MODEL_STORAGE_KEY, modelVal);
    } catch (_) {}
    updateEngineStatusUI();
    document.getElementById('grok-config-bar').hidden = true;
    showToast(
      keyVal
        ? `AI Key saved (${modelVal} active for evaluateRefundWithAI)`
        : 'AI Key cleared (using rule-based policy evaluator)'
    );
  });

  updateEngineStatusUI();

  document
    .getElementById('refund-items-checklist')
    ?.addEventListener('change', updateEstimatedRefundAmount);
  document.getElementById('refund-form')?.addEventListener('submit', handleRefundSubmit);

  document
    .getElementById('ai-chat-input-form')
    ?.addEventListener('submit', handleChatInputSubmit);

  // Post-Decision Action Bar ("⚖️ Appeal Decision" & "👤 Talk to a Person")
  document.getElementById('btn-appeal-decision')?.addEventListener('click', () => {
    openEscalationComposer('Appeal');
  });

  document.getElementById('btn-talk-person')?.addEventListener('click', () => {
    openEscalationComposer('Talk to Person');
  });

  document.getElementById('cancel-escalation-btn')?.addEventListener('click', () => {
    document.getElementById('escalation-composer').hidden = true;
  });

  document
    .getElementById('send-escalation-btn')
    ?.addEventListener('click', handleSendEscalationToManager);

  // Manager Email Preview Toggle & Copy Summary
  document.getElementById('toggle-email-preview-btn')?.addEventListener('click', () => {
    const previewBox = document.getElementById('email-preview-container');
    if (previewBox) previewBox.hidden = !previewBox.hidden;
  });

  document.getElementById('copy-email-summary-btn')?.addEventListener('click', async () => {
    const bodyText = document.getElementById('preview-email-body')?.textContent || '';
    if (!bodyText) return;
    try {
      await navigator.clipboard.writeText(bodyText);
      showToast('Manager escalation email summary copied to clipboard');
    } catch (_) {
      showToast('Summary ready in preview box');
    }
  });

  // Sign Out Button
  document.getElementById('sign-out-btn')?.addEventListener('click', async () => {
    try {
      if (Backend?.signOutAndLog) await Backend.signOutAndLog();
      else if (window.RefundBackend?.client) await window.RefundBackend.client.auth.signOut();
    } catch (_) {}
    window.location.href = 'index.html';
  });

  syncWithSupabase();
}

document.addEventListener('DOMContentLoaded', initOrdersPage);

})();
