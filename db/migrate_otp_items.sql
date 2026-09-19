-- Migration: seller OTP sessions + item submission requests
-- Run with:
--   npx wrangler d1 execute consignment-auctions --remote --file=db/migrate_otp_items.sql

-- OTP table: one active OTP per seller phone at a time
CREATE TABLE IF NOT EXISTS seller_otps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT NOT NULL,
  otp         TEXT NOT NULL,           -- 6-digit string
  expires_at  TEXT NOT NULL,           -- ISO timestamp, 10 min from creation
  used        INTEGER DEFAULT 0        -- 1 once consumed
);
CREATE INDEX IF NOT EXISTS idx_otps_phone ON seller_otps(phone);

-- Item submission requests from sellers
CREATE TABLE IF NOT EXISTS item_requests (
  id            TEXT PRIMARY KEY,      -- IRQ-xxxxxxxxxx
  seller_id     TEXT NOT NULL REFERENCES sellers(id),
  name          TEXT NOT NULL,
  description   TEXT,
  image_key     TEXT,                  -- B2 key after upload
  min_price     REAL NOT NULL,         -- what the seller wants minimum
  notes         TEXT,                  -- any extra notes from seller
  status        TEXT DEFAULT 'pending', -- pending | approved | rejected
  reject_reason TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  reviewed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_item_requests_seller ON item_requests(seller_id);
CREATE INDEX IF NOT EXISTS idx_item_requests_status ON item_requests(status);
