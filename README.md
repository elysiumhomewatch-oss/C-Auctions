# Consignment Auctions — Backend Skeleton

Part 1 only for now (deploy steps) — this is just the API + database + image
storage. No public/admin pages yet.

## What you need first

1. A **Backblaze B2** account (backblaze.com — no card required) with:
   - One **private** bucket created
   - An application key scoped to that bucket (Account → App Keys → Add a New
     Application Key)
   - Note down: `keyID`, `applicationKey`, the bucket's **Bucket ID** and
     **Bucket Name** (all visible on the bucket's page in the B2 dashboard)

## Deploy steps (Git Bash)

```bash
cd worker

# 1. Create the D1 database
npx wrangler d1 create consignment-auctions
# ⚠ copy the database_id it prints into wrangler.toml (REPLACE_WITH_ID_FROM_D1_CREATE)

# 2. Load the schema
npx wrangler d1 execute consignment-auctions --remote --file=../db/schema.sql

# 3. Set secrets (you'll be prompted to paste each value)
npx wrangler secret put ADMIN_KEY
npx wrangler secret put B2_KEY_ID
npx wrangler secret put B2_APP_KEY
npx wrangler secret put B2_BUCKET_ID
npx wrangler secret put B2_BUCKET_NAME

# To generate a strong ADMIN_KEY instead of typing one:
#   ADMIN_KEY=$(openssl rand -hex 24)
#   echo "Save this now — you will need it: $ADMIN_KEY"
#   echo "$ADMIN_KEY" | npx wrangler secret put ADMIN_KEY

# 4. Deploy
npx wrangler deploy
```

Wrangler will print your Worker's URL, e.g.
`https://consignment-auctions-api.<your-subdomain>.workers.dev`

## Quick smoke test

```bash
# Should return {"ok":true,"config":{}}
curl https://consignment-auctions-api.<your-subdomain>.workers.dev/api/config

# Create a seller (replace YOUR_ADMIN_KEY)
curl -X POST https://consignment-auctions-api.<your-subdomain>.workers.dev/api/sellers \
  -H "Authorization: Bearer YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Seller","phone":"27831234567"}'
```

## API reference (current)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/config` | — | Get public config values |
| POST | `/api/config` | admin | Set config values (bulk key/value) |
| POST | `/api/sellers` | admin | Add a seller |
| GET | `/api/sellers` | admin | List sellers |
| GET | `/api/sellers/:id` | — | Get one seller |
| POST | `/api/auctions` | admin | Create an auction/event |
| GET | `/api/auctions` | — | List auctions |
| GET | `/api/auctions/:id/items` | — | List items in an auction |
| POST | `/api/items` | admin | Add an item |
| PATCH | `/api/items/:id` | admin | Edit an item |
| POST | `/api/items/:id/bid` | — | Place a bid |
| POST | `/api/items/:id/close` | admin | Close bidding, create payment record if sold |
| POST | `/api/images` | admin | Upload an image (multipart `file` field) → returns `imageKey` |
| GET | `/api/images/:key` | — | Stream an image from B2 |

Not built yet: payments (PayFast), payouts, public/admin frontend pages,
per-item delivery cost display. That's the next session.
