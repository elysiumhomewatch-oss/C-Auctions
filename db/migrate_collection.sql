-- Migration: collection QR system
-- Run with:
--   npx wrangler d1 execute consignment-auctions --remote --file=db/migrate_collection.sql

-- New table: one row per party (buyer + seller) per payment
CREATE TABLE IF NOT EXISTS collection_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id  TEXT NOT NULL REFERENCES payments(id),
  role        TEXT NOT NULL CHECK(role IN ('buyer','seller')),
  pin         TEXT NOT NULL UNIQUE,           -- 10-digit numeric string
  party_name  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  used_at     TEXT                            -- set when this PIN is the one scanned
);

CREATE INDEX IF NOT EXISTS idx_collection_tokens_payment ON collection_tokens(payment_id);
CREATE INDEX IF NOT EXISTS idx_collection_tokens_pin     ON collection_tokens(pin);

-- Two new columns on payments to record when/how collection was confirmed
ALTER TABLE payments ADD COLUMN collected_at TEXT;
ALTER TABLE payments ADD COLUMN collection_confirmed_by_pin TEXT;
