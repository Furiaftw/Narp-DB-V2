# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A jutsu reference database for a text-based Naruto roleplay Discord server. React 18 + Vite SPA, styled with Tailwind, backed by Supabase (Postgres + Discord OAuth + Row-Level Security), deployed on Netlify with serverless functions and edge functions. Ships as an installable PWA with Web Push notifications.

## Commands

```bash
npm install
npm run dev        # Vite dev server at http://localhost:5173
npm run build      # production build to dist/
npm run preview    # serve the production build locally
```

There is no test suite and no linter configured. Verification is manual: run the dev server and exercise the UI.

- **Local dev without a backend:** with no Supabase env vars set, the app boots into dev mode — seed data, localStorage persistence, and a "Dev: User / Dev: Admin" role toggle in the header. Good for UI work; auth, the pending queue, whitelist, and push cannot be tested this way.
- **Local dev with a backend:** copy `.env.example` to `.env` and fill in `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.
- Netlify functions and edge functions do not run under `npm run dev` — they need `netlify dev` or a deploy.
- `node scripts/generate-icons.mjs` regenerates the PWA icons in `public/icons/`.

## Architecture

### The App.jsx monolith — and the trap next to it

`src/App.jsx` (~5,500 lines) contains most of the UI and business logic: the root `App` component, tab routing, data loading, dev-mode fallback, and many components defined inline (JutsuCard, FilterBar, SessionListCart, PendingJutsuCard, AdminFormModal, SystemToolsModal, UserMenu, AuditLogModal, and more).

**Important:** `src/components/` contains extracted copies of several of those same components (`features/JutsuCard.jsx`, `features/FilterBar.jsx`, `features/SessionCart.jsx`, `features/PendingCard.jsx`, `modals/AdminForm.jsx`, `modals/SystemTools.jsx`, `layout/UserMenu.jsx`, `NotificationBell.jsx`) that are **not imported by anything** — App.jsx uses its own inline versions. Editing those files has no effect on the running app. Before touching a component, check what actually imports it.

What App.jsx *does* import from elsewhere:
- `src/pages/RosterPage.jsx` — bloodline roster tab
- `src/pages/MessagesPage.jsx` — messages inbox tab
- `src/components/features/ReviewChat.jsx` and `RecentChatActivity.jsx`
- `src/components/ErrorBoundary.jsx` (via `main.jsx`)
- `src/hooks/useIsDesktop.js`, `src/utils/helpers.jsx`
- `src/components/ui/Icon.jsx` (used transitively by the pages/features above)

Catalog constants (natures, ranks, specializations, etc.) are duplicated between App.jsx and `src/constants/catalog.js`; the inline copies in App.jsx are what the main app uses.

Main tabs (state variable `tab` in App): `jutsus`, `pending`, `roster`, `messages`, plus `bloodlines`/`members` views reachable through admin surfaces.

### Data layer: src/lib/supabase.js

All Supabase access goes through this one module — auth (Discord OAuth + dev login), profiles, whitelist, the pending-jutsus queue, review chats, realtime subscriptions (`subscribeToDatabaseChanges`), webhook config, submission controls, and push subscriptions. Jutsu rows are mapped between DB shape and app shape via `fromRowJutsu` / `buildJutsuPayload` — if you add or rename a jutsu column, update both.

Supabase config resolves in this order:
1. `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (build-time, `.env` or Netlify env)
2. `VITE_SUPABASE_DATABASE_URL` (set by the Netlify Supabase extension)
3. `window.__SUPABASE_CONFIG__` — injected at request time by the `inject-env` edge function from unprefixed `SUPABASE_DATABASE_URL` / `SUPABASE_ANON_KEY` env vars
4. `vite.config.js` also maps unprefixed `SUPABASE_*` vars into the build if the `VITE_` ones are absent

If none resolve, `isSupabaseConfigured()` is false and the app runs in dev mode.

### Permission model (enforced in Postgres, not just UI)

Four tiers: `user` → `staff` → `admin` → `owner`. RLS policies and SQL functions are the real gate; the UI only mirrors them.

- Anyone can browse jutsus. Staff edits (insert/update/delete) go to the `pending_jutsus` queue and need approval from someone other than the submitter. Admin+ writes directly.
- Approval is atomic via the `approve_pending_jutsu()` Postgres RPC.
- Roster changes use a double-approval flow (`supabase/add-roster-approval.sql`).
- Admins can only flip users between `user`/`staff`; only the owner manages admins. Role changes are audit-logged in `role_change_log`.
- Roles can also be synced from Discord guild roles via the `sync-discord-roles` function (only when a fresh `provider_token` exists — a plain page reload deliberately skips the sync so a failed Discord lookup can't downgrade anyone).

### Database migrations

`supabase/*.sql` are incremental patch scripts, run manually in the Supabase SQL Editor — there is no migration runner. The full base schema (`schema.sql` referenced by the README) is **not in this repo**; only the incremental `add-*.sql` / trigger scripts are. When changing the schema, add a new idempotent SQL file here, and keep client code tolerant of the column not existing yet (see the `42703` fallback in `fetchMyProfile`).

### Netlify functions (netlify/functions/)

Server-side code using the `SUPABASE_SERVICE_ROLE_KEY` — anything that must bypass RLS or hold secrets lives here, never in client code:

- `sync-discord-roles.js` — recompute a user's role from their Discord guild roles
- `send-chat-push.mjs` / `send-test-push.mjs` — Web Push (VAPID) delivery for review-chat messages
- `discord-dm.mjs`, `send-discord-log.mjs`, `nudge-reviewer.mjs`, `reviewer-ping.mjs`, `reviewer-work-log.mjs` — Discord webhook/DM notifications around the review workflow
- `ensure-profile.mjs` — profile bootstrap
- `dev-login.js` — password sign-in as a dev account, hard-gated behind `EXPERIMENTAL_MODE=true` in Netlify env

### Netlify edge functions (netlify/edge-functions/)

- `inject-env.ts` — injects `window.__SUPABASE_CONFIG__` into every HTML response
- `serve-markdown.ts` — requests with `Accept: text/markdown` get the live catalog rendered as Markdown (for AI agents/crawlers) instead of the SPA shell

Edge functions run on Deno (`deno.lock`); regular functions run on Node.

### PWA / Web Push

`vite-plugin-pwa` in `injectManifest` mode with a hand-written service worker at `src/sw.js` (Workbox precache + NetworkFirst for `*.supabase.co` + the `push`/`notificationclick` handlers). `netlify.toml` sets `Cache-Control: max-age=0` on `/sw.js` — keep it that way or clients stop updating. Push requires the four `VAPID_*` / `VITE_VAPID_PUBLIC_KEY` env vars (see `.env.example`); `VAPID_PRIVATE_KEY` is server-only and must never get a `VITE_` prefix.

## Conventions and gotchas

- Env vars exposed to the browser must be prefixed `VITE_`; everything else is server-only. Secrets (service role key, VAPID private key) live only in Netlify env vars and are read only by functions.
- Console logging uses the `[NARP]` prefix (e.g. `[NARP] submitPendingJutsu failed`).
- The README's setup guide is the authoritative operational doc (Supabase/Discord/Netlify wiring, env-var table, troubleshooting), but parts of its "Project structure" section are stale — e.g. `App.claude-preview.jsx` and `supabase/schema.sql` do not exist in this repo.
- `netlify.toml` routes every non-asset path to `index.html` (SPA) and runs `serve-markdown` on all paths; asset caching is immutable, so filenames must stay hashed (Vite default).
- The owner email is hardcoded in the Supabase `handle_new_user()` trigger (see `supabase/auth-trigger.sql` and README).
