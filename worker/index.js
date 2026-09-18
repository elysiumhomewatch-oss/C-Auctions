// ═══════════════════════════════════════════════════════════════
// Consignment Auction Platform — Worker API
// D1 for data, Backblaze B2 (native API, private bucket) for images
// ═══════════════════════════════════════════════════════════════
//
// CHANGELOG (admin-panel support, added on top of the tested v1 API):
//   - PATCH /auctions/:id          — edit an auction (status draft→live→closed, etc.)
//   - GET   /items/:id/bids        — bid history for one item (admin)
//   - GET   /payments              — list payments, optional ?status= filter (admin)
//   - POST  /payments/:id/mark-paid — mark a buyer payment received (admin)
//   - GET   /payouts/pending       — per-seller pending payout totals (admin)
//   - POST  /payouts               — record a payout to a seller (admin)
//   - GET   /payouts               — payout history (admin)
//   - POST  /payouts/:id/mark-paid — mark a payout as actually sent (admin)
//
// CHANGELOG (collection QR system):
//   - POST  /payments/:id/collection-tokens — generate buyer+seller 10-digit PINs (admin)
//   - GET   /payments/:id/collection-tokens — fetch existing tokens for a payment (admin)
//   - GET   /collect/:pin                   — public: look up token info by PIN (for QR link)
//   - POST  /collect/:pin/confirm           — public: confirm collection with either PIN
// Everything above these changelogs is unchanged from the tested version.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
function err(message, status = 400) { return json({ error: message }, status); }
function id(prefix) { return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`; }

function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return key && env.ADMIN_KEY && key === env.ADMIN_KEY;
}

// ── Backblaze B2 (native API — simpler than S3 SigV4 for a single-bucket use case) ──
let b2Cache = null; // { apiUrl, downloadUrl, authToken, expiresAt }

async function b2Authorize(env) {
  if (b2Cache && b2Cache.expiresAt > Date.now()) return b2Cache;
  const credentials = btoa(`${env.B2_KEY_ID}:${env.B2_APP_KEY}`);
  const res = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!res.ok) throw new Error('B2 authorization failed: ' + await res.text());
  const data = await res.json();
  b2Cache = {
    apiUrl: data.apiUrl,
    downloadUrl: data.downloadUrl,
    authToken: data.authorizationToken,
    expiresAt: Date.now() + 22 * 60 * 60 * 1000, // tokens last 24h; refresh a bit early
  };
  return b2Cache;
}

async function b2Upload(env, bytes, fileName, contentType) {
  const auth = await b2Authorize(env);
  const uploadUrlRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: { Authorization: auth.authToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: env.B2_BUCKET_ID }),
  });
  if (!uploadUrlRes.ok) throw new Error('B2 get_upload_url failed: ' + await uploadUrlRes.text());
  const { uploadUrl, authorizationToken } = await uploadUrlRes.json();

  const digest = await crypto.subtle.digest('SHA-1', bytes);
  const sha1 = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');

  const upload = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: authorizationToken,
      'X-Bz-File-Name': encodeURIComponent(fileName),
      'Content-Type': contentType || 'b2/x-auto',
      'X-Bz-Content-Sha1': sha1,
      'Content-Length': String(bytes.byteLength),
    },
    body: bytes,
  });
  if (!upload.ok) throw new Error('B2 upload failed: ' + await upload.text());
  return fileName;
}

async function b2Download(env, fileName) {
  const auth = await b2Authorize(env);
  const url = `${auth.downloadUrl}/file/${env.B2_BUCKET_NAME}/${fileName}`;
  const res = await fetch(url, { headers: { Authorization: auth.authToken } });
  return res;
}

// ── Router ─────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
    const method = request.method;

    try {
      // ── config ──
      if (parts[0] === 'config' && method === 'GET') return getConfig(env);
      if (parts[0] === 'config' && method === 'POST') return setConfig(request, env);

      // ── sellers ──
      if (parts[0] === 'sellers' && method === 'POST') return createSeller(request, env);
      if (parts[0] === 'sellers' && method === 'GET' && !parts[1]) return listSellers(request, env);
      if (parts[0] === 'sellers' && method === 'GET' && parts[1]) return getSeller(parts[1], env);

      // ── auctions ──
      if (parts[0] === 'auctions' && method === 'POST' && !parts[1]) return createAuction(request, env);
      if (parts[0] === 'auctions' && method === 'GET' && !parts[1]) return listAuctions(request, env);
      if (parts[0] === 'auctions' && method === 'PATCH' && parts[1] && !parts[2]) return updateAuction(parts[1], request, env);
      if (parts[0] === 'auctions' && parts[2] === 'items' && method === 'GET') return listItems(parts[1], env);

      // ── items ──
      if (parts[0] === 'items' && method === 'POST' && !parts[1]) return createItem(request, env);
      if (parts[0] === 'items' && method === 'PATCH' && parts[1] && !parts[2]) return updateItem(parts[1], request, env);
      if (parts[0] === 'items' && parts[2] === 'bid' && method === 'POST') return placeBid(parts[1], request, env);
      if (parts[0] === 'items' && parts[2] === 'close' && method === 'POST') return closeItem(parts[1], request, env);
      if (parts[0] === 'items' && parts[2] === 'bids' && method === 'GET') return listBids(parts[1], request, env);

      // ── payments ──
      if (parts[0] === 'payments' && method === 'GET' && !parts[1]) return listPayments(request, env);
      if (parts[0] === 'payments' && parts[2] === 'mark-paid' && method === 'POST') return markPaymentPaid(parts[1], request, env);

      // ── payouts ──
      if (parts[0] === 'payouts' && parts[1] === 'pending' && method === 'GET') return payoutsPending(request, env);
      if (parts[0] === 'payouts' && method === 'POST' && !parts[1]) return createPayout(request, env);
      if (parts[0] === 'payouts' && method === 'GET' && !parts[1]) return listPayouts(request, env);
      if (parts[0] === 'payouts' && parts[2] === 'mark-paid' && method === 'POST') return markPayoutPaid(parts[1], request, env);

      // ── collection tokens ──
      if (parts[0] === 'payments' && parts[2] === 'collection-tokens' && method === 'POST') return generateCollectionTokens(parts[1], request, env);
      if (parts[0] === 'payments' && parts[2] === 'collection-tokens' && method === 'GET') return getCollectionTokens(parts[1], request, env);
      if (parts[0] === 'collect' && parts[1] && !parts[2] && method === 'GET') return lookupPin(parts[1], env);
      if (parts[0] === 'collect' && parts[1] && parts[2] === 'confirm' && method === 'POST') return confirmCollection(parts[1], request, env);

      // ── images ──
      if (parts[0] === 'images' && method === 'POST') return uploadImage(request, env);
      if (parts[0] === 'images' && method === 'GET' && parts[1]) return serveImage(parts.slice(1).join('/'), env);

      return err('Not found', 404);
    } catch (e) {
      return err('Server error: ' + e.message, 500);
    }
  },
};

// ── Config ─────────────────────────────────────────────────────
async function getConfig(env) {
  const rows = await env.DB.prepare('SELECT key, value FROM config').all();
  const cfg = {};
  for (const r of rows.results) cfg[r.key] = r.value;
  return json({ ok: true, config: cfg });
}
async function setConfig(request, env) {
  if (!requireAdmin(request, env)) return err('Unauthorized', 401);
  const body = await request.json();
  const stmts = Object.entries(body).map(([k, v]) =>
    env.DB.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, String(v))
  );
  await env.DB.batch(stmts);
  return json({ ok: true });
}

// ── Sellers ────────────────────────────────────────────────────
async function createSeller(request, env) {
  if (!requireAdmin(request, env)) return err('Unauthorized', 401);
  const b = await request.json();
  if (!b.name || !b.phone) return err('name and phone are required');
  const sellerId = id('SEL');
  await env.DB.prepare(
    'INSERT INTO sellers (id, name, phone, email, payout_method, bank_details) VALUES (?,?,?,?,?,?)'
  ).bind(sellerId, b.name, b.phone, b.email || null, b.payoutMethod || 'eft', b.bankDetails ? JSON.stringify(b.bankDetails) : null).run();
  return json({ ok: true, id: sellerId });
}
async function listSellers(request, env) {
  if (!requireAdmin(request, env)) return err('Unauthorized', 401);
  const rows = await env.DB.prepare('SELECT * FROM sellers ORDER BY created_at DESC').all();
  return json({ ok: true, sellers: rows.results });
}
async function getSeller(sellerId, env) {
  const row = await env.DB.prepare('SELECT * FROM sellers WHERE id = ?').bind(sellerId).first();
  if (!row) return err('Seller not found', 404);
  return json({ ok: true, seller: row });
}

// ── Auctions ───────────────────────────────────────────────────
async function createAuction(request, env) {
  if (!requireAdmin(request, env)) return err('Unauthorized', 401);
  const b = await request.json();
  if (!b.name) return err('name is required');
  const auctionId = id('AUC');
  await env.DB.prepare(
    'INSERT INTO auctions (id, name, status, starts_at, ends_at, commission_pct) VALUES (?,?,?,?,?,?)'
  ).bind(auctionId, b.name, b.status || 'draft', b.startsAt || null, b.endsAt || null, b.commissionPct ?? 15.0).run();
  return json({ ok: true, id: auctionId });
}
async function listAuctions(request, env) {
  const rows = await env.DB.prepare('SELECT * FROM auctions ORDER BY created_at DESC').all();
  return json({ ok: true, auctions: rows.results });
}
async function updateAuction(auctionId, request, env) {
  if (!requireAdmin(request, env)) return err('Unauthorized', 401);
  const b = await request.json();
  const fields = {
    name: 'name', status: 'status', starts_at: 'startsAt',
    ends_at: 'endsAt', commission_pct: 'commissionPct',
  };
  const sets = [], vals = [];
  for (const [col, key] of Object.entries(fields)) {
    if (b[key] !== undefined) { sets.push(`${col} = ?`); vals.push(b[key]); }
  }
  if (!sets.length) return err('Nothing to update');
  vals.push(auctionId);
  const res = await env.DB.prepare(`UPDATE auctions SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  if (!res.meta.changes) return err('Auction not found', 404);
  return json({ ok: true });
}

// ── Items ──────────────────────────────────────────────────────
async function listItems(auctionId, env) {
  const rows = await env.DB.prepare('SELECT * FROM items WHERE auction_id = ? ORDER BY created_at DESC').bind(auctionId).all();
  return json({ ok: true, items: rows.results });
}

async function createItem(request, env) {
  if (!requireAdmin(request, env)) return err('Unauthorized', 401);
  const b = await request.json();
  if (!b.auctionId || !b.sellerId || !b.name || b.startingBid == null) {
    return err('auctionId, sellerId, name and startingBid are required');
  }
  const itemId = id('ITM');
  await env.DB.prepare(`
    INSERT INTO items
      (id, auction_id, seller_id, name, description, image_key, starting_bid, reserve_price,
       current_bid, min_increment, status, end_date, commission_pct, delivery_method)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    itemId, b.auctionId, b.sellerId, b.name, b.description || '', b.imageKey || null,
    Number(b.startingBid), b.reservePrice != null ? Number(b.reservePrice) : null,
    Number(b.startingBid), Number(b.minIncrement) || 1, 'open',
    b.endDate || null, b.commissionPct != null ? Number(b.commissionPct) : null,
    b.deliveryMethod || 'pickup'
  ).run();
  return json({ ok: true, id: itemId });
}

async function updateItem(itemId, request, env) {
  if (!requireAdmin(request, env)) return err('Unauthorized', 401);
  const b = await request.json();
  const fields = {
    name: 'name', description: 'description', image_key: 'imageKey',
    starting_bid: 'startingBid', reserve_price: 'reservePrice', min_increment: 'minIncrement',
    end_date: 'endDate', commission_pct: 'commissionPct', delivery_method: 'deliveryMethod',
  };
  const sets = [], vals = [];
  for (const [col, key] of Object.entries(fields)) {
    if (b[key] !== undefined) { sets.push(`${col} = ?`); vals.push(b[key]); }
  }
  if (!sets.length) return err('Nothing to update');
  vals.push(itemId);
  const res = await env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  if (!res.meta.changes) return err('Item not found', 404);
  return json({ ok: true });
}

// Atomic bid placement — fixes the race condition from the Apps Script version.
// The WHERE clause does the "is this still the best bid, still open, still before its
// deadline" check and the write in one atomic statement, so two simultaneous bids can't
// both pass validation against a now-stale current_bid.
async function placeBid(itemId, request, env) {
  const b = await request.json();
  if (!b.bidderId || !b.bidderName || b.amount == null) {
    return err('bidderId, bidderName and amount are required');
  }
  const item = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(itemId).first();
  if (!item) return err('Item not found', 404);
  if (item.status !== 'open') return err('Bidding on this item is closed.');
  if (item.end_date && new Date(item.end_date).getTime() && new Date() > new Date(item.end_date)) {
    return err('Bidding on this item has closed.');
  }
  const minBid = Number(item.current_bid) + Number(item.min_increment);
  if (Number(b.amount) < minBid) return err(`Minimum bid is ${minBid.toFixed(2)}`);

  const result = await env.DB.prepare(`
    UPDATE items SET current_bid = ?, highest_bidder_id = ?, highest_bidder_name = ?
    WHERE id = ? AND status = 'open' AND current_bid < ?
  `).bind(Number(b.amount), b.bidderId, b.bidderName, itemId, Number(b.amount)).run();

  if (!result.meta.changes) {
    return err('Someone just placed a higher bid — please refresh and try again.', 409);
  }
  await env.DB.prepare(
    'INSERT INTO bids (id, item_id, bidder_id, bidder_name, amount) VALUES (?,?,?,?,?)'
  ).bind(id('BID'), itemId, b.bidderId, b.bidderName, Number(b.amount)).run();

  return json({ ok: true });
}

async function listBids(itemId, request, env) {
  if (!requireAdmin(request, env)) return err('Unauthorized', 401);
  const rows = await env.DB.prepare('SELECT * FROM bids WHERE item_id = ? ORDER BY placed_at DESC').bind(itemId).all();
  return json({ ok: true, bids: rows.results });
}

async function closeItem(itemId, request, env) {
  if (!requireAdmin(request, env)) return err('Unauthorized', 401);
  const item = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(itemId).first();
  if (!item) return err('Item not found', 404);

  const sold = item.highest_bidder_id && (item.reserve_price == null || item.current_bid >= item.reserve_price);
  const newStatus = sold ? 'sold' : (item.highest_bidder_id ? 'unsold' : 'unsold');
  await env.DB.prepare('UPDATE items SET status = ? WHERE id = ?').bind(newStatus, itemId).run();

  if (sold) {
    const auction = await env.DB.prepare('SELECT * FROM auctions WHERE id = ?').bind(item.auction_id).first();
    const pct = item.commission_pct != null ? item.commission_pct : (auction ? auction.commission_pct : 15);
    const commission = Math.round(item.current_bid * (pct / 100) * 100) / 100;
    const sellerDue = Math.round((item.current_bid - commission) * 100) / 100;
    await env.DB.prepare(
      'INSERT INTO payments (id, item_id, amount, commission, seller_due, status) VALUES (?,?,?,?,?,?)'
    ).bind(id('PAY'), itemId, item.current_bid, commission, sellerDue, 'pending').run();
  }
  return json({ ok: true, result: newStatus });
}

// ── Payments (buyer → platform) ───────────────────────────────
async function listPayments(request, env) {
  if (!requireAdmin(request, env)) return err('Unauthorized', 401);
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const base = `
    SELECT p.*, i.name AS item_name, i.seller_id AS seller_id, s.name AS seller_name
    FROM payments p
    JOIN items i ON i.id = p.item_id
    JOIN sellers s ON s.id = i.seller_id
  `;
  const rows = status
    ? await env.DB.prepare(base + ' WHERE p.status = ? ORDER BY p.id DESC').bind(status).all()
    : await env.DB.prepare(base + ' ORDER BY p.id DESC').all();
  return json({ ok: true, payments: rows.results });
}

async function markPaymentPaid(paymentId, request, env) {
  if (!requireAdmin(request, env)) return err('Unauthorized', 401);
  let gatewayRef = null;
  try { const b = await request.json(); gatewayRef = b.gatewayRef || null; } catch {}
  const res = await env.DB.prepare(
    `UPDATE payments SET status = 'paid', paid_at = datetime('now'), gateway_ref = COALESCE(?, gateway_ref)
     WHERE id = ? AND status != 'paid'`
  ).bind(gatewayRef, paymentId).run();
  if (!res.meta.changes) return err('Payment not found, or already marked paid', 404);
  return json({ ok: true });
}

// ── Payouts (platform → seller) ───────────────────────────────
// A payment must be status='paid' (buyer has paid us) and not already referenced
// in any existing payout's payment_ids JSON array before it can be paid out.
async function payoutsPending(request, env) {
  if (!requireAdmin(request, env)) return err('Unauthorized', 401);
  const rows = await env.DB.prepare(`
    SELECT p.id AS payment_id, p.item_id, p.amount, p.commission, p.seller_due,
           i.name AS item_name, i.seller_id, s.name AS seller_name, s.phone AS seller_phone,
           s.payout_method AS payout_method, s.bank_details AS bank_details
    FROM payments p
    JOIN items i ON i.id = p.item_id
    JOIN sellers s ON s.id = i.seller_id
    WHERE p.status = 'paid'
      AND p.id NOT IN (
        SELECT je.value FROM payouts po, json_each(po.payment_ids) je
      )
    ORDER BY s.name, p.id
  `).all();

  const bySeller = {};
  for (const r of rows.results) {
    if (!bySeller[r.seller_id]) {
      bySeller[r.seller_id] = {
        sellerId: r.seller_id, sellerName: r.seller_name, sellerPhone: r.seller_phone,
        payoutMethod: r.payout_method, bankDetails: r.bank_details ? JSON.parse(r.bank_details) : null,
        total: 0, payments: [],
      };
    }
    bySeller[r.seller_id].total = Math.round((bySeller[r.seller_id].total + r.seller_due) * 100) / 100;
    bySeller[r.seller_id].payments.push({
      paymentId: r.payment_id, itemId: r.item_id, itemName: r.item_name,
      amount: r.amount, commission: r.commission, sellerDue: r.seller_due,
    });
  }
  return json({ ok: true, sellers: Object.values(bySeller) });
}

async function createPayout(request, env) {
  if (!requireAdmin(request, env)) return err('Unauthorized', 401);
  const b = await request.json();
  if (!b.sellerId || !Array.isArray(b.paymentIds) || !b.paymentIds.length) {
    return err('sellerId and a non-empty paymentIds array are required');
  }
  const placeholders = b.paymentIds.map(() => '?').join(',');
  const rows = await env.DB.prepare(`
    SELECT p.id, p.seller_due, i.seller_id
    FROM payments p JOIN items i ON i.id = p.item_id
    WHERE p.status = 'paid' AND p.id IN (${placeholders})
      AND p.id NOT IN (SELECT je.value FROM payouts po, json_each(po.payment_ids) je)
  `).bind(...b.paymentIds).all();

  const valid = rows.results.filter(r => r.seller_id === b.sellerId);
  if (!valid.length) return err('None of those payments are eligible for payout (already paid out, not found, or wrong seller)');
  if (valid.length !== b.paymentIds.length) {
    return err(`Only ${valid.length} of ${b.paymentIds.length} payments are eligible — refresh and try again`);
  }

  const total = Math.round(valid.reduce((sum, r) => sum + r.seller_due, 0) * 100) / 100;
  const payoutId = id('PO');
  await env.DB.prepare(
    'INSERT INTO payouts (id, seller_id, payment_ids, total_amount, status) VALUES (?,?,?,?,?)'
  ).bind(payoutId, b.sellerId, JSON.stringify(valid.map(r => r.id)), total, 'pending').run();

  return json({ ok: true, id: payoutId, total });
}

async function listPayouts(request, env) {
  if (!requireAdmin(request, env)) return err('Unauthorized', 401);
  const rows = await env.DB.prepare(`
    SELECT po.*, s.name AS seller_name
    FROM payouts po JOIN sellers s ON s.id = po.seller_id
    ORDER BY po.created_at DESC
  `).all();
  return json({ ok: true, payouts: rows.results });
}

async function markPayoutPaid(payoutId, request, env) {
  if (!requireAdmin(request, env)) return err('Unauthorized', 401);
  const res = await env.DB.prepare(
    `UPDATE payouts SET status = 'paid', paid_at = datetime('now') WHERE id = ? AND status != 'paid'`
  ).bind(payoutId).run();
  if (!res.meta.changes) return err('Payout not found, or already marked paid', 404);
  return json({ ok: true });
}

// ── Images (Backblaze B2, private bucket, proxied through this Worker) ──
async function uploadImage(request, env) {
  if (!requireAdmin(request, env)) return err('Unauthorized', 401);
  const form = await request.formData();
  const file = form.get('file');
  if (!file) return err('No file provided');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const safeName = (file.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `items/${Date.now()}-${safeName}`;
  await b2Upload(env, bytes, key, file.type);
  return json({ ok: true, imageKey: key });
}

async function serveImage(key, env) {
  const res = await b2Download(env, key);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return err(`Image not found (B2 status ${res.status}): ${detail}`, 404);
  }
  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      ...CORS,
    },
  });
}

// ── Collection tokens ───────────────────────────────────────────
// Generates a 10-digit numeric PIN, zero-padded, crypto-random.
function generatePin() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 10_000_000_000).padStart(10, '0');
}

async function generateCollectionTokens(paymentId, request, env) {
  if (!requireAdmin(request, env)) return err('Unauthorized', 401);

  const payment = await env.DB.prepare(
    `SELECT p.*, i.name AS item_name, i.seller_id,
            s.name AS seller_name, s.phone AS seller_phone,
            i.highest_bidder_id AS buyer_id, i.highest_bidder_name AS buyer_name
     FROM payments p
     JOIN items i ON i.id = p.item_id
     JOIN sellers s ON s.id = i.seller_id
     WHERE p.id = ?`
  ).bind(paymentId).first();
  if (!payment) return err('Payment not found', 404);
  if (payment.status !== 'paid') return err('Payment must be marked paid before generating collection tokens');

  // Idempotent — if tokens already exist for this payment, return them.
  const existing = await env.DB.prepare(
    'SELECT * FROM collection_tokens WHERE payment_id = ?'
  ).bind(paymentId).all();
  if (existing.results.length) {
    return json({ ok: true, tokens: existing.results, reused: true });
  }

  // Generate two unique PINs (retry on collision — probability is negligible but handle it).
  let buyerPin, sellerPin;
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generatePin();
    const clash = await env.DB.prepare(
      'SELECT 1 FROM collection_tokens WHERE pin = ?'
    ).bind(candidate).first();
    if (!clash) {
      if (!buyerPin) buyerPin = candidate;
      else { sellerPin = candidate; break; }
    }
  }
  if (!buyerPin || !sellerPin) return err('Could not generate unique PINs — try again');

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO collection_tokens (payment_id, role, pin, party_name, created_at)
       VALUES (?, 'buyer', ?, ?, ?)`
    ).bind(paymentId, buyerPin, payment.buyer_name || payment.buyer_id, now),
    env.DB.prepare(
      `INSERT INTO collection_tokens (payment_id, role, pin, party_name, created_at)
       VALUES (?, 'seller', ?, ?, ?)`
    ).bind(paymentId, sellerPin, payment.seller_name, now),
  ]);

  const tokens = await env.DB.prepare(
    'SELECT * FROM collection_tokens WHERE payment_id = ?'
  ).bind(paymentId).all();
  return json({ ok: true, tokens: tokens.results, reused: false });
}

async function getCollectionTokens(paymentId, request, env) {
  if (!requireAdmin(request, env)) return err('Unauthorized', 401);
  const rows = await env.DB.prepare(
    'SELECT * FROM collection_tokens WHERE payment_id = ?'
  ).bind(paymentId).all();
  return json({ ok: true, tokens: rows.results });
}

// Public — called by the QR link page to show the holder what their token is for.
async function lookupPin(pin, env) {
  const token = await env.DB.prepare(
    `SELECT ct.*, p.item_id, p.amount, p.status AS payment_status,
            i.name AS item_name, i.highest_bidder_name AS buyer_name,
            s.name AS seller_name,
            p.collected_at
     FROM collection_tokens ct
     JOIN payments p ON p.id = ct.payment_id
     JOIN items i ON i.id = p.item_id
     JOIN sellers s ON s.id = i.seller_id
     WHERE ct.pin = ?`
  ).bind(pin).first();
  if (!token) return err('PIN not found', 404);
  return json({
    ok: true,
    role: token.role,
    partyName: token.party_name,
    itemName: token.item_name,
    buyerName: token.buyer_name,
    sellerName: token.seller_name,
    saleAmount: token.amount,
    collected: !!token.collected_at,
    collectedAt: token.collected_at,
  });
}

// Public — either party scanning the other's QR confirms collection.
async function confirmCollection(pin, request, env) {
  const token = await env.DB.prepare(
    'SELECT * FROM collection_tokens WHERE pin = ?'
  ).bind(pin).first();
  if (!token) return err('PIN not found', 404);

  const payment = await env.DB.prepare(
    'SELECT * FROM payments WHERE id = ?'
  ).bind(token.payment_id).first();
  if (!payment) return err('Payment not found', 404);
  if (payment.collected_at) {
    return json({ ok: true, alreadyCollected: true, collectedAt: payment.collected_at });
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE payments SET collected_at = ?, collection_confirmed_by_pin = ? WHERE id = ?`
  ).bind(now, pin, token.payment_id).run();

  return json({ ok: true, alreadyCollected: false, collectedAt: now });
}
