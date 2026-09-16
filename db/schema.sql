-- ═══════════════════════════════════════════════════════════
-- Consignment Auction Platform — D1 Schema (draft v1)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE sellers (
  id            TEXT PRIMARY KEY,          -- e.g. 'SEL-' + random
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,             -- WhatsApp contact, normalized to 27XXXXXXXXX
  email         TEXT,
  payout_method TEXT DEFAULT 'eft',        -- 'eft' | 'payfast_split' (future)
  bank_details  TEXT,                      -- JSON blob: account holder, bank, acc no, branch
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE auctions (
  id            TEXT PRIMARY KEY,          -- one "batch"/event of lots
  name          TEXT NOT NULL,
  status        TEXT DEFAULT 'draft',      -- draft | live | closed
  starts_at     TEXT,
  ends_at       TEXT,                      -- default/global close, informational only
  commission_pct REAL DEFAULT 15.0,        -- your default cut, overridable per item
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE items (
  id              TEXT PRIMARY KEY,
  auction_id      TEXT NOT NULL REFERENCES auctions(id),
  seller_id       TEXT NOT NULL REFERENCES sellers(id),
  name            TEXT NOT NULL,
  description     TEXT,
  image_key       TEXT,                    -- B2 object key, not a public URL
  starting_bid    REAL NOT NULL,            -- shown publicly
  reserve_price   REAL,                     -- hidden; NULL = no reserve, starting_bid is the floor
  current_bid     REAL DEFAULT 0,
  min_increment   REAL DEFAULT 1,
  highest_bidder_id   TEXT,
  highest_bidder_name TEXT,
  status          TEXT DEFAULT 'open',      -- open | closed | sold | unsold | cancelled
  end_date        TEXT,                     -- per-item deadline (as in ElysiumAuctions)
  commission_pct  REAL,                     -- NULL = inherit auction default
  delivery_method TEXT DEFAULT 'pickup',    -- pickup | delivery | either
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE bids (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items(id),
  bidder_id   TEXT NOT NULL,
  bidder_name TEXT NOT NULL,
  amount      REAL NOT NULL,
  placed_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE payments (
  id            TEXT PRIMARY KEY,
  item_id       TEXT NOT NULL REFERENCES items(id),
  amount        REAL NOT NULL,              -- winning bid amount
  commission    REAL NOT NULL,              -- your cut, computed at close
  seller_due    REAL NOT NULL,              -- amount - commission
  gateway       TEXT DEFAULT 'payfast',
  gateway_ref   TEXT,                       -- PayFast payment ID
  status        TEXT DEFAULT 'pending',     -- pending | paid | failed | refunded
  paid_at       TEXT
);

CREATE TABLE payouts (
  id            TEXT PRIMARY KEY,
  seller_id     TEXT NOT NULL REFERENCES sellers(id),
  payment_ids   TEXT NOT NULL,              -- JSON array — one payout can cover several sales
  total_amount  REAL NOT NULL,
  status        TEXT DEFAULT 'pending',     -- pending | paid
  paid_at       TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE config (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX idx_items_auction ON items(auction_id);
CREATE INDEX idx_items_seller  ON items(seller_id);
CREATE INDEX idx_bids_item     ON bids(item_id);
CREATE INDEX idx_payments_item ON payments(item_id);
CREATE INDEX idx_payouts_seller ON payouts(seller_id);
