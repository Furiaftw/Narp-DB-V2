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

`src/App.jsx` (~5,900 lines) is the layout shell plus most of the UI and business logic: the root `App` component, the route table, data loading, dev-mode fallback, and many components defined inline (JutsuCard, FilterBar, SessionListCart, PendingJutsuCard, AdminFormModal, SystemToolsModal, UserMenu, and more). The jutsu catalog, bloodlines view and member board are still inline here — they are the routes that stayed put; everything else lives in `src/pages/`.

**Important:** `src/components/` contains extracted copies of several of those same components (`features/JutsuCard.jsx`, `features/FilterBar.jsx`, `modals/AdminForm.jsx`, `modals/SystemTools.jsx`, `layout/UserMenu.jsx`) that are **not imported by anything** — App.jsx uses its own inline versions. Editing those files has no effect on the running app. Before touching a component, check what actually imports it. (The equivalent dead copies of SessionCart, PendingCard, and NotificationBell, plus the dead `modals/StatelessForm.jsx`, have been deleted outright rather than left to bit-rot.)

What App.jsx *does* import from elsewhere:
- `src/pages/RosterPage.jsx` — roster page
- `src/pages/InboxPage.jsx` — Submissions page (file name kept; `inbox*` identifiers throughout are historical)
- `src/pages/GradingPage.jsx` — Grading/Upgrade Requests page (see "RP grading & upgrade credits" below)
- `src/pages/HistoryPage.jsx` — History page: Work Log + Audit Log panels
- `src/components/features/ReviewChat.jsx` and `RecentChatActivity.jsx`
- `src/components/ErrorBoundary.jsx` (via `main.jsx`)
- `src/hooks/useIsDesktop.js`, `src/utils/helpers.jsx`
- `src/components/ui/Icon.jsx` (used transitively by the pages/features above)

Catalog constants (natures, ranks, specializations, etc.) are duplicated between App.jsx and `src/constants/catalog.js`; the inline copies in App.jsx are what the main app uses.

### Routing and the navigation shell

Navigation is the URL — there is no `tab` state any more. `main.jsx` wraps the app in
`<BrowserRouter>`; `App.jsx` is the layout shell (banner, header, section switcher, catalog
tab bar, filter chrome, modals) wrapping one `<Routes>` block. `netlify.toml` already rewrites
`/*` → `/index.html`, so deep links resolve on the deployed site.

| Path | Renders | Gate |
| :--- | :--- | :--- |
| `/` | jutsu catalog (inline in App.jsx) | public |
| `/bloodlines` | bloodlines view (inline) | public |
| `/roster` | `RosterPage` | public |
| `/grading` | `GradingPage` | signed in |
| `/history` | → redirects to `/history/work-log` | — |
| `/history/work-log` | `WorkStatsPage`, via `HistoryPage` | reviewer+ |
| `/history/audit-log` | `AuditLogPanel`, via `HistoryPage` | admin+ |
| `/submissions` | `InboxPage` — queue + review chats + the green Submit menu | signed in |
| `/inbox` | → redirects to `/submissions` | — |
| `/members` | member board (inline) | admin+ |
| anything else | → redirects to `/` | — |

Two navs, deliberately: the **section switcher** (dark strip in the header) spans every page,
while the **catalog tab bar** (Jutsus / Bloodlines) and the jutsu `FilterBar`/`FilterBarPanel`
render only on the catalog routes — that scoping is what keeps the satellite pages from
inheriting the database's chrome. `tab` still exists as a *derived* value (`pathname` →
`'jutsus'`/`'bloodlines'`/…) because the catalog's filter and row-expand logic reads it in
many places.

Gated routes render a `NoAccess` / `SignedOutNotice` panel rather than redirecting, so a link
shared between staff explains itself instead of silently bouncing.

**Gotcha:** every hook must stay above App's `if (loading) return …` early return. The
route-change effect (filter reset, scroll-to-top) sits with the other effects near the top;
putting it down beside the nav model crashes React with "rendered more hooks than during the
previous render".

### Character sheets (the in-database OC sheet)

The OC sheet that used to live in a Google Doc is now a database record:

- `supabase/add-character-sheets.sql` — the `character_sheets` table. Everything volatile lives in a `data` jsonb column; `character_name`, `village`, `ninja_rank`, `bloodline` are pulled out as columns for querying. `character_name` is uniquely indexed on `lower(btrim(...))`.
- `src/constants/characterSheet.js` — the sheet *shape*: option lists, `emptySheet()`, `normalizeSheet()` (merges a stored sheet over the current shape, so old sheets keep rendering after a section is added), and `computeCU()` (chakra level + control + 5).
- `src/components/features/CharacterSheetModal.jsx` — the whole sheet, view and edit in one component. Section order matches the original doc (人 家 具 力 技 獣 異 限 術 基 趣 歆 画 僀).
- Roster rows are matched to a sheet **by character name** — there is no foreign key from `roster_entries` / `roster_squads`. `RosterPage` fetches a name → sheet index once (`fetchCharacterSheetIndex`) and every name renders through its `CharacterName` component, which opens the sheet on click and keeps the old character-area link as a separate icon.
- Writing is gated by RLS: the owner and grader+ can edit; the owner and admin+ can delete; anyone can read.

Both this and the jutsu sheet below share one visual toolkit — `src/components/features/SheetKit.jsx` — the cream-paper/ink-black/hanko-stamp "parchment" primitives (`Field`, `Section`, `Table`, `Text`, `Choice`, `Area`, `Link`, `SheetShell`, `HankoStamp`, plus the color tokens). Change the look in one place and both sheets stay identical.

### Jutsu sheets (the in-database jutsu write-up)

The Google Doc a jutsu submission used to link to (NARP Jutsu Template — image, description, step-by-step mechanics, restrictions, multi-rank stat/skill scaling) is now captured directly in the app, same principle as the character sheet:

- `jutsus.sheet` (jsonb, default `{}`) holds it — no separate table, since a jutsu row already *is* the record (unlike characters, which have no dedicated row). `pending_jutsus.data.sheet` carries it through the review queue; `approve_pending_jutsu()` writes it (and `jutsu_type`/`pve`, which the RPC had been silently dropping since those columns were added — fixed in the same migration) to `jutsus` on approval.
- `src/constants/jutsuSheet.js` — the shape: `emptyJutsuSheet()`, `normalizeJutsuSheet()`, `jutsuSheetHasContent()`.
- `src/components/features/JutsuSheetModal.jsx` — fully controlled (`sheet` + `onChange`, no internal save/load). `AdminFormModal` folds it into `fd._sheet` alongside the rest of the jutsu form; `JutsuCard`'s "Sheet" button opens the same component read-only, fed straight from the jutsu row.
- Fields the original doc template also had — a top-level Mechanics category, Casting Category, and two Combat Type selects — are deliberately left out: there's no existing taxonomy for them in this app. Add them as staff-editable tag lists (same pattern as `jutsu_type_tags`) if that's ever wanted.
- The jutsu form's old "Doc Link" field is gone; `jutsus.link` (and `bloodlines.link`, untouched) stay as columns for backward compatibility with old data but are no longer editable from the UI.

### Jutsu review history (moved off Discord)

The review chat transcript no longer ships to Discord as a `.txt` webhook attachment (nor does `send-discord-log.mjs` re-export the submitter's Google Doc as a PDF anymore — both removed together, since neither makes sense without a doc link). Instead, on a plain-jutsu approval, `handleApprovePending` saves the transcript straight to `jutsu_review_history` (`jutsu_id`, `operation`, `transcript`, `submitted_by`, `reviewed_by`) via `saveJutsuReviewHistory`. RLS restricts the table to `is_reviewer_or_above()` (graders — Character-only reviewers — can't see it). `JutsuHistoryModal`, opened from the clock icon on `JutsuCard` (reviewer+ only), is the read side. Denials aren't stored — there's no resulting jutsu to attach them to.

### RP grading & upgrade credits (Phase 1)

The two Discord-manual workflows — RP grading (`#rp-grading-submission`) and character upgrades (the "My Character Upgrade Area") — run through the site now, while the human read step stays on Discord (graders open the thread link to read the RP). Core model: **a graded RP is a single-use credit** — one credit minted per participating character, tagged with the eligible uses the grader approved; spending it on one upgrade consumes it whole.

- **Pipeline:** player submits an RP → Gate 1 (grader) approves → credits minted → player attaches credits to an upgrade request → Gate 2 (reviewer) approves → the sheet is auto-updated (revert available to reviewer+). Slice-of-Life-only RPs mint no credit.
- `supabase/add-rp-grading-upgrades.sql` — tables (`rp_submissions`, `rp_participants`, `rp_credits`, `upgrade_requests`, plus `character_sheets.credit_multiplier` for the v2 Elite Jōnin passive), RLS, and the atomic SECURITY DEFINER functions: `grade_rp_submission()` (blocks self-grading by site account or Discord ID), `approve_upgrade_request()` (blocks self-OC approval and malformed targets; requires a logged `override_reason` for insufficient credits / weekly cap), `reject_upgrade_request()`, `revert_upgrade()` (restores `before_value`, refunds credits), and `current_upgrade_cycle_key()` / `approved_upgrades_this_cycle()`.
- **Weekly cap:** 2 approved upgrades per character per cycle, counted at approval time, keyed by ISO week evaluated in `America/New_York` (`'2026-W34'`). `currentCycleKey()` in `src/constants/upgradeRules.js` must produce the same string as the SQL function — both are tested against each other; change them together.
- `src/constants/upgradeRules.js` — cost tables (jutsu by rank 1/2/3; stat by level reached 1/1/2/3/4; skill by band 1/2/3/4; dojutsu on its own band table), machine-readable `RANK_CAPS` (the prose `RANK_LIMITS` in characterSheet.js, structured), the target builders (`{ label, tag, path, new_value }` — `path` is the jsonb path `approve_upgrade_request()` writes), and `computeUpgradeWarnings()`. **Warnings never block** — the reviewer approves past them with a logged override reason; only self-grading/self-approval/spent-credit/malformed-target checks are hard server-side blocks.
- `src/pages/GradingPage.jsx` — the "Grading/Upgrade Requests" page at `/grading` (lazy-loaded): wallet (per-OC ledger + cycle usage), submit-RP form, grading queue (grader+), upgrade queue (reviewer+, with the warning panel and revert). Discord pings reuse `reviewer-ping.mjs` (trigger types `rp_submission` / `upgrade_request`) and verdict DMs reuse `discord-dm.mjs`.

- Upgrade targets write into the sheet's existing structured fields (`stats.*` ranks, `skills.*` percentages, `limited.dojutsu_skill`, the whole `techniques.jutsu` array for learning/dropping a jutsu) — no new sheet schema was needed.
- **Explicitly deferred to v2:** OOC promotions, stat-ceiling increases, character-slot expansion, private multi-specialty jutsu, and the Elite Jōnin path that grants `credit_multiplier = 2`.

### Discord notifications mute

`submission_controls.discord_notifications_paused` (owner-toggleable from System Tools, same switch pattern as the per-type submission gates) is checked **server-side** inside `reviewer-ping.mjs`, `nudge-reviewer.mjs`, `send-discord-log.mjs`, and `reviewer-work-log.mjs` — each queries the row itself and no-ops if muted, rather than trusting client state. Flipping it silences everything: new-submission alerts, the second-reviewer-needed ping, the reviewer nudge DM, and the approval/denial log post.

### Data layer: src/lib/supabase.js

All Supabase access goes through this one module — auth (Discord OAuth + dev login), profiles, whitelist, the pending-jutsus queue, review chats, realtime subscriptions (`subscribeToDatabaseChanges`), webhook config, submission controls, character sheets, the RP grading/upgrade pipeline, and push subscriptions. Jutsu rows are mapped between DB shape and app shape via `fromRowJutsu` / `buildJutsuPayload` — if you add or rename a jutsu column, update both.

Supabase config resolves in this order:
1. `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (build-time, `.env` or Netlify env)
2. `VITE_SUPABASE_DATABASE_URL` (set by the Netlify Supabase extension)
3. `window.__SUPABASE_CONFIG__` — injected at request time by the `inject-env` edge function from unprefixed `SUPABASE_DATABASE_URL` / `SUPABASE_ANON_KEY` env vars
4. `vite.config.js` also maps unprefixed `SUPABASE_*` vars into the build if the `VITE_` ones are absent

If none resolve, `isSupabaseConfigured()` is false and the app runs in dev mode.

### Permission model (enforced in Postgres, not just UI)

Five tiers: `user` → `grader` → `reviewer` → `admin` → `owner`. RLS policies and SQL functions are the real gate; the UI only mirrors them. (The old `staff` role became `reviewer`, and `oc_staff` became `grader` — see `supabase/migrate-roles-grader-reviewer.sql`, which migrated the data, constraints, policies, and helper functions `is_reviewer_or_above()` / `is_grader_or_above()` in one pass. Historical strings still appear in `role_change_log` rows, so label helpers stay tolerant of both.)

- Anyone can browse jutsus. Reviewer edits (insert/update/delete) go to the `pending_jutsus` queue and need approval from someone other than the submitter. Admin+ writes directly. Graders are scoped to Character-type pending entries only, plus RP grading (Gate 1 below).
- Approval is atomic via the `approve_pending_jutsu()` Postgres RPC.
- Roster changes use a double-approval flow (`supabase/add-roster-approval.sql`).
- Admins can only flip users between `user`/`grader`/`reviewer`; only the owner manages admins. Role changes are audit-logged in `role_change_log`.
- Roles can also be synced from Discord guild roles via the `sync-discord-roles` function (only when a fresh `provider_token` exists — a plain page reload deliberately skips the sync so a failed Discord lookup can't downgrade anyone).
- **The app never grants Discord roles.** Role flow is inbound only: Discord guild roles → site tier (`discord-login.js`, `sync-discord-roles.js`). The old OC-approval automation that handed out Has Character / village / rank / Councilor / OC-count roles has been removed — reviewers assign every Discord role by hand.
- **Summon and Custom Item submissions are currently paused** (`submission_controls.summon_paused` / `custom_item_paused`) — their forms only ever captured a mandatory Google Doc link and nothing else, and that requirement is gone server-wide. Proper in-app sheets for these (same treatment as jutsus/characters) are a future update; the form code (`StatelessSubmissionModal` in App.jsx) is untouched and ready to re-enable once that ships.

### Database migrations

`supabase/*.sql` are incremental patch scripts, run manually in the Supabase SQL Editor — there is no migration runner. The full base schema (`schema.sql` referenced by the README) is **not in this repo**; only the incremental `add-*.sql` / trigger scripts are. When changing the schema, add a new idempotent SQL file here, and keep client code tolerant of the column not existing yet (see the `42703` fallback in `fetchMyProfile`).

**Deploy coupling:** `migrate-roles-grader-reviewer.sql` and `add-rp-grading-upgrades.sql` (in that order) must be run **together with** deploying the client code that uses the new role names — the pre-migration client checks for `staff`, so running the SQL first breaks its gates, and deploying the code first leaves it checking for roles that don't exist yet. Old SQL files that mention `staff` are applied history; the migration file recreated everything they defined, so don't edit them.

### Netlify functions (netlify/functions/)

Server-side code using the `SUPABASE_SERVICE_ROLE_KEY` — anything that must bypass RLS or hold secrets lives here, never in client code:

- `sync-discord-roles.js` — recompute a user's role from their Discord guild roles
- `send-chat-push.mjs` / `send-test-push.mjs` — Web Push (VAPID) delivery for review-chat messages
- `discord-dm.mjs`, `send-discord-log.mjs`, `nudge-reviewer.mjs`, `reviewer-ping.mjs`, `reviewer-work-log.mjs` — Discord webhook/DM notifications around the review workflow. The last four each check `submission_controls.discord_notifications_paused` first and no-op if muted (see "Discord notifications mute" above). `send-discord-log.mjs` no longer fetches a Google Doc PDF or attaches a chat transcript `.txt` — it just posts the embed.
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
- Review-chat system messages are ordinary `pending_chats` rows with a marker prefix: `[SYSTEM_FINAL_STEP]` (OC final-approval block) and `[SYSTEM_JOIN]` (reviewer joined the chat — also serves as join-state persistence: anyone with a message in a thread counts as having entered it). `fetchChatOverview`/`fetchRecentChats` filter out `[SYSTEM_JOIN]` so joins don't affect turn/unread logic.
- The README's setup guide is the authoritative operational doc (Supabase/Discord/Netlify wiring, env-var table, troubleshooting). There is no consolidated base `schema.sql` in this repo — only incremental `add-*.sql` patch scripts plus `auth-trigger.sql`/`submission-queue-updates.sql` — so standing up a brand-new Supabase project requires a schema-only export from an existing deployment first (see the README's "Run the schema" section).
- `netlify.toml` routes every non-asset path to `index.html` (SPA) and runs `serve-markdown` on all paths; asset caching is immutable, so filenames must stay hashed (Vite default).
- The owner email is hardcoded in the Supabase `handle_new_user()` trigger (see `supabase/auth-trigger.sql` and README).
