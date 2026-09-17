# C-Auctions Admin Panel — install notes

## What's in here
- `pages/admin/` — the admin panel (multi-page: dashboard, sellers, auctions,
  per-auction item management + photo upload + live bids, payments & payouts,
  settings). Drop this whole folder into your existing `pages/` directory so it
  serves at `/admin/` alongside your public site.
- `worker/index.js` — your existing Worker **plus** new routes the admin panel
  needs (see below). This is the full file — replace your current
  `worker/index.js` with it (or diff it against yours if you've since made
  other changes).

## New Worker routes added
Your schema already had `payments` and `payouts` tables, but no routes to use
them — so "close/settle" wasn't actually possible yet. Added:
- `PATCH /auctions/:id` — edit an auction (move draft → live → closed, etc.)
- `GET /items/:id/bids` — bid history for one item
- `GET /payments` (+ `?status=`) — list payments
- `POST /payments/:id/mark-paid` — mark a buyer payment received
- `GET /payouts/pending` — per-seller amounts owed, only counting payments
  that are marked paid and not already in a previous payout
- `POST /payouts` — record a payout to a seller
- `GET /payouts` — payout history
- `POST /payouts/:id/mark-paid` — mark a payout as actually sent

All of this is additive — nothing about your existing tested routes changed.

## Install steps

1. Copy files in:
   ```bash
   cd D:\github\C-Auctions
   cp -r <this-package>/pages/admin pages/admin
   cp <this-package>/worker/index.js worker/index.js
   ```

2. Redeploy the Worker:
   ```bash
   cd D:\github\C-Auctions\worker
   npx wrangler deploy
   ```

3. Redeploy Pages (same command you used for the public site — adjust the
   project path/name if yours differs):
   ```bash
   cd D:\github\C-Auctions
   npx wrangler pages deploy pages --project-name=c-auctions
   ```

4. Visit `https://c-auctions.pages.dev/admin/` and log in with your
   `ADMIN_KEY`.

## Still worth doing (from the handoff doc, unchanged)
- Change `ADMIN_KEY` off the `auctions2026` placeholder before real use —
  `npx wrangler secret put ADMIN_KEY` from the worker directory, then log
  into the admin panel again with the new value.
- Commit & push — this adds more uncommitted files on top of the ones
  already flagged.
- Decide whether to keep or clear the test listing (Weber Kettle Braai etc.)
  — do it from the Auctions page now, no D1 command needed: open the
  September Auction, close the item, or just leave it as a first real test
  of the close/settle flow end to end.

## Notes on the admin panel itself
- Auth: paste your `ADMIN_KEY` on first visit to any admin page; it's stored
  in that browser's localStorage and sent as a Bearer token on every admin
  call. Log out clears it.
- The visual style (warm stone background, teal accents, Space Grotesk +
  Work Sans) is my best match to the direction you described for the public
  site, not pulled from its actual CSS — if you paste me that stylesheet I
  can tighten it to match exactly.
- Status everywhere (auctions, items, payments, payouts) uses the same small
  dot + label so you can scan state at a glance: outline = draft/unsold,
  filled pulsing teal = live/open, filled green = sold/paid, filled clay =
  pending, filled red outline = unsold/cancelled.
- Payout math: a payment only shows up as "owed to seller" once you've
  marked it paid (buyer's money received) — it disappears from that list the
  moment you record a payout covering it, so the same sale can't accidentally
  get paid out twice.
