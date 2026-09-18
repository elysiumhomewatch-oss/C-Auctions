-- Migration: seller self-registration
-- Run with:
--   npx wrangler d1 execute consignment-auctions --remote --file=db/migrate_seller_status.sql

ALTER TABLE sellers ADD COLUMN status TEXT DEFAULT 'active';
-- Existing sellers are already active — leave them as-is (default applies to new rows only,
-- existing rows keep NULL which we treat as 'active' in all queries).

CREATE INDEX IF NOT EXISTS idx_sellers_status ON sellers(status);
CREATE INDEX IF NOT EXISTS idx_sellers_phone  ON sellers(phone);
