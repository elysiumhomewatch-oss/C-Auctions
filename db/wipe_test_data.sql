-- Wipe all test/auction data, leave sellers and config intact.
-- Order matters: child tables first, then parents.
PRAGMA defer_foreign_keys = ON;
DELETE FROM seller_otps;
DELETE FROM item_requests;
DELETE FROM payouts;
DELETE FROM collection_tokens;
DELETE FROM payments;
DELETE FROM bids;
DELETE FROM items;
DELETE FROM auctions;
