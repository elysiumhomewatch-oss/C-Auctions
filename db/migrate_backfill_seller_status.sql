-- Backfill: set status = 'active' for any sellers added before the status column existed
UPDATE sellers SET status = 'active' WHERE status IS NULL;
