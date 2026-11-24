# Cooking with your Mom

A week of dinners, one shopping list, and every recipe walked through step by step, with "Mama" answering questions while you cook.

**Try it:** https://cookingwithyourmom.zouthrock.com (free, phone or laptop). On a phone, use Share → Add to Home Screen.

## What it does

- Plans the week for the people at your table: goals, allergies, kitchen gear, time, budget.
- One shopping list, grouped by aisle, with estimated prices.
- Cook mode: one step per screen, timers, and Mama on call.
- Import a recipe from a link or a video.
- Meals for pets, drink pairings (21+), and a shared community table.
- Works without signal: save the week, check things off, and it syncs when you are back.

Each account has its own week, list and settings. Server reads and writes use the signed-in user's id, and a tab left open on another account is refused. The community table is the one shared place, by design.

## Stack

Next.js 16, React 19, Clerk (accounts), Neon Postgres, Vercel Blob, Anthropic (plans and Mama), Gemini (images), and a small Node service in `services/extract` that reads recipe videos.

## Run it yourself

You need Node 22+, pnpm, and your own keys. Nothing here connects to the hosted app's data.

```bash
pnpm install
cp .env.local.example .env.local   # fill in your own keys
node scripts/db/migrate.mjs        # creates the tables in your database
pnpm dev
```

Checks: `npx next typegen && npx tsc --noEmit` and `pnpm test`.

## Notes

- This is a snapshot of the app's code. Internal docs and deployment files are not included, so some comments point to files that are not here.
- `data/kroger-products.json` ships with one example entry; build your own product map under Kroger's API terms.
- Set `WELCOME_FROM`, `WELCOME_REPLY_TO` and the `USER_AGENT` contact in `src/lib/places` before sending mail or calling OpenStreetMap.
- No license has been chosen: the code is here to read and try. Photos, clips and brand marks belong to their owners.
- Nutrition and pet information is not medical or veterinary advice.
