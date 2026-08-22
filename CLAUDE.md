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

### App.jsx and the module layout

`src/App.jsx` (~2,200 lines) is now just the layout shell and the app-level state
it owns: the root `App` component, the route table, auth/profile state, the
pending-submission queue and its handlers, the jutsu catalog route, and the
modal wiring. Everything else has its own module.

There used to be a trap here worth knowing about, because its fingerprints are
still in the git history: several components existed **twice** — an inline copy
in App.jsx that the app actually rendered, and a same-named file under
`src/components/` that nothing imported. The copies drifted, and the dead ones
went stale in ways that would have broken things had anyone started importing
them (`constants/catalog.js` had lost the `jutsu_type` and bloodline slot
fields, `ui/RankLogo.jsx` predated the grader/reviewer migration and had no
grader tier, `utils/helpers.jsx` still carried a `sendDiscordLog` that attached
a chat transcript and a Google Doc PDF long after both were removed). That is
resolved: every one of those is now a single module, populated from the version
that was actually running. **There are no unimported duplicate components left
— if you find yourself adding a second copy of something, don't.**

Where things live:

| Path | What |
| :--- | :--- |
| `pages/RosterPage.jsx` | roster |
| `pages/BloodlinesPage.jsx` | `/bloodlines` view + its charts (lazy — owns the recharts bundle) |
| `pages/MembersPage.jsx` | `/members` board + `MemberWorkThreadInput` |
| `pages/InboxPage.jsx` | Inbox tab (`inbox*` identifiers match the file name) |
| `pages/GradingPage.jsx` | Grading/Upgrade Requests (see below) |
| `pages/HistoryPage.jsx` | Work Log + Audit Log panels |
| `components/features/` | `JutsuCard` (+`JutsuDocRankPicker`), `FilterBar` (+`FilterBarPanel`), `SessionListCart`, `AddSubmissionMenu`, `ReviewChat`, `RecentChatActivity`, `PendingJutsuCard`, `CharacterSheetModal`, `JutsuSheetModal`, `JutsuHistoryModal`, `SheetKit` |
| `components/modals/` | `AdminForm`, `SystemTools`, `OCSubmissionModal`, `StatelessSubmission`, `SlotsViewModal`, `CatalogManagement`, `JutsuStatsModal` |
| `components/layout/` | `UserMenu`, `RouteGates` (`NoAccess` / `SignedOutNotice`) |
| `components/ui/` | `Icon`, `RankLogo`, `ProfileAvatar`, `Dropdowns`, `SlotsEditor`, `ConfirmButton`, `UpdateBanner` |
| `constants/catalog.js` | `STORAGE`, `SHUTDOWN_AT`, natures/ranks/specializations, `STATIC_SEED`, `MANAGE_TABLES` — the single source of truth |
| `utils/helpers.jsx` | small pure helpers + `renderDiscordMarkdown` |
| `utils/discordLog.js` | `sendDiscordLog` (the only copy) |
| `utils/loadDb.js` | `normalizeDB` + `loadDB` |

**Code splitting:** `BloodlinesPage` and the four admin/staff modals
(`AdminForm`, `SystemTools`, `CatalogManagement`, `OCSubmissionModal`,
`StatelessSubmission`) are `lazy()` behind their own `Suspense` boundary —
they are not needed on first paint, and BloodlinesPage in particular keeps
recharts out of the main bundle. Keep new heavy, on-demand surfaces lazy too.

**No test suite:** the only safety net is `npm run build` plus driving the real
UI. Note that dev mode (no Supabase) leaves whole branches unrendered — an
empty `profilesList` means the member board's rows never paint — so a clean
route-level smoke test does not prove a data-dependent path works. Mount the
component against realistic data when you touch one.

### Routing and the navigation shell

Navigation is the URL — there is no `tab` state any more. `main.jsx` wraps the app in
`<BrowserRouter>`; `App.jsx` is the layout shell (banner, header, section switcher, catalog
tab bar, filter chrome, modals) wrapping one `<Routes>` block. `netlify.toml` already rewrites
`/*` → `/index.html`, so deep links resolve on the deployed site.

| Path | Renders | Gate |
| :--- | :--- | :--- |
| `/` | jutsu catalog (inline in App.jsx) | public |
| `/bloodlines` | `BloodlinesPage` (lazy) | public |
| `/roster` | `RosterPage` | public |
| `/grading` | `GradingPage` | signed in |
| `/history` | → redirects to `/history/work-log` | — |
| `/history/work-log` | `WorkStatsPage`, via `HistoryPage` | reviewer+ |
| `/history/audit-log` | `AuditLogPanel`, via `HistoryPage` | admin+ |
| `/inbox` | `InboxPage` — queue + review chats | signed in |
| `/submissions` | → redirects to `/inbox` | — |
| `/members` | `MembersPage` | admin+ |
| anything else | → redirects to `/` | — |

Two navs, deliberately: the **section switcher** (dark strip in the header) spans every page,
while the **catalog tab bar** (Jutsus / Bloodlines / Inbox) and the jutsu `FilterBar`/`FilterBarPanel`
render only on the catalog routes — that scoping is what keeps the satellite pages from
inheriting the database's chrome. Inbox rides along in the tab bar (not the FilterBar) because
it needs no jutsu filter chrome, just the tab strip. The green Submit menu (Jutsu/Battlemode,
OC, Summon, Custom Item) lives in the persistent header but only renders while `isCatalog` is
true (Jutsus/Bloodlines/Inbox) — filing a new entry only makes sense from the Database section,
not from Roster/Grading/History/Members. `tab` still
exists as a *derived* value (`pathname` → `'jutsus'`/`'bloodlines'`/`'inbox'`/…) because the
catalog's filter and row-expand logic reads it in many places.

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
- A sheet can also be created **before** the character is on the roster, keyed by the OC's proposed name: `PendingJutsuCard`'s "Character Sheet" button opens the same `CharacterSheetModal` against a pending Character submission's name. `handleApprovePending` (`src/App.jsx`) hard-blocks approval of any `type: 'Character'` pending entry until `fetchCharacterSheetByName()` finds a sheet and `sheetHasContent()` is true — this applies to the admin-instant-approve path below too, not just staff review.
- `roster_entries` / `roster_squads` also carry an `owner_id` (`supabase/add-roster-owner-tracking.sql`), set by `roster-auto-insert.mjs` from the *original submitter*, not the approver (`created_by`/`approved_by` stay the approver). `fetchMyOcCount()` sums a player's approved `owner_id` rows plus their other in-flight Character submissions to auto-calculate "which OC is this for you?" in `OCSubmissionModal` — no longer self-reported. Rows approved before that migration have `owner_id = null` and are invisible to the count.
- Four `personal` fields in the sheet are computed, not typed in: **Submitted by** (`fetchProfileById(ownerId)`'s Discord username, live — not frozen at save time), **Character slot** (`ocSlotLabel()`, frozen into the sheet the first time it's saved so a later 4th OC doesn't retroactively relabel an earlier one), **Threat level** (`computeThreatLevel()` — averages the 4 stat ranks Chakra Level/Control, Speed, Strength on an F=E=0…S=5 scale, rounds half-down, maps back to a letter; blank until all four stats are set), and **Village / Shinobi rank / Clan-KKG**, whose *starting* value is auto-selected from `prefill` (supplied by `OCSubmissionModal`'s own "Character Sheet" button while composing a new submission, or by `PendingJutsuCard` for one still awaiting review — both pass the OC's own creation-entry data, and it's only ever applied once, to a brand-new sheet) but stays a normal editable field afterward. `ownerIdHint` (set by the same two callers, from the submitter's own id) keeps "Submitted by" and a staff-created sheet's `owner_id` pointed at the actual player instead of whichever staff member is filling it in; a sheet started from the Roster page has no such hint and falls back to attributing itself to whoever clicks "create." Both `prefill` and `ownerIdHint` are consumed once by the load effect / a one-shot autofill effect, each writing via a functional `setSheet` update so the two can't race and clobber each other regardless of which one's async data (owner profile, live OC count) resolves first.

- Passing `prefill` also means "this is a creation flow": when no saved sheet is found, the modal drops straight into edit mode instead of showing the *No character sheet yet / Create sheet* empty state. That empty state renders none of the prefilled fields, which is why the prefill repeatedly looked broken when it was in fact working — the values were behind a screen nobody clicked through. Cancel in that same state closes the modal rather than falling back to the empty state (there is no saved version to revert to).
- Both sheet modals (`CharacterSheetModal`, `JutsuSheetModal`) render **full-screen** — `fixed inset-0` with an opaque background, a sticky header carrying the close button, and content capped at `max-w-6xl`/`max-w-5xl` so long lines stay readable on wide displays. There is no backdrop left to click, so both close on **Escape** as well; the character sheet ignores Escape while editing so a stray keypress can't discard a half-filled sheet.
- The Techniques/Battle mode lists no longer take free-text jutsu names: `JutsuPicker` (inside `CharacterSheetModal.jsx`) searches the live jutsu catalog (`jutsus` prop — threaded down from `App.jsx`'s `db.jutsus` via `RosterPage`/`PendingJutsuCard`/`OCSubmissionModal`) and only ever renders the *empty* state; once a slot is filled the row draws itself. A filled row is the jutsu name plus its nature/specialization/bloodline/origin read straight back off the catalog row — picking is the whole interaction, there is nothing else to type. **Rank is the one exception**: it stays a control, but only for jutsus that exist at more than one rank, since which rank the character learned is a real per-character fact the catalog can't answer and the rank limits quoted in that section are counted against it. Approved?/Doc-link columns are gone (a jutsu in the database is by definition approved, and it has its own sheet). Battle mode slots are filtered to Battlemode-type jutsus whose `bm_tier` matches that exact slot (Primary/Secondary/Tertiary). There is no PvE slots table any more (removed outright, including `LIMITS.pveSlots` and `techniques.pve` from the sheet shape).

The character sheet's look comes from `src/components/features/SheetKit.jsx` — the cream-paper/ink-black/hanko-stamp "parchment" primitives (`Field`, `Section`, `Table`, `Text`, `Choice`, `Area`, `Link`, `SheetShell`, `HankoStamp`, plus the color tokens). **Only `CharacterSheetModal` imports it.** `JutsuSheetModal` deliberately does not: it defines its own `Field`/`Section`/`Text`/`Area` and is styled to match JutsuCard (white cards, slate-50 insets, indigo accents) rather than the parchment document look — see the comment at the top of that file. So editing SheetKit changes the character sheet only, and the two sheets are *not* meant to look identical.

### Jutsu sheets (the in-database jutsu write-up)

The Google Doc a jutsu submission used to link to (NARP Jutsu Template — image, description, step-by-step mechanics, restrictions, multi-rank stat/skill scaling) is now captured directly in the app, same principle as the character sheet:

- `jutsus.sheet` (jsonb, default `{}`) holds it — no separate table, since a jutsu row already *is* the record (unlike characters, which have no dedicated row). `pending_jutsus.data.sheet` carries it through the review queue; `approve_pending_jutsu()` writes it (and `jutsu_type`/`pve`, which the RPC had been silently dropping since those columns were added — fixed in the same migration) to `jutsus` on approval.
- `src/constants/jutsuSheet.js` — the shape: `emptyJutsuSheet()`, `normalizeJutsuSheet()`, `jutsuSheetHasContent()`.
- `src/components/features/JutsuSheetModal.jsx` — fully controlled (`sheet` + `onChange`, no internal save/load). `AdminFormModal` folds it into `fd._sheet` alongside the rest of the jutsu form; `JutsuCard`'s "Sheet" button opens the same component read-only, fed straight from the jutsu row.
- Fields the original doc template also had — a top-level Mechanics category, Casting Category, and two Combat Type selects — are deliberately left out: there's no existing taxonomy for them in this app. Add them as staff-editable tag lists (same pattern as `jutsu_type_tags`) if that's ever wanted.
- The jutsu form's old "Doc Link" field is gone; `jutsus.link` (and `bloodlines.link`, untouched) stay as columns for backward compatibility with old data but are no longer editable from the UI.

### Jutsu review history (moved off Discord)

The review chat transcript no longer ships to Discord — that entire webhook logging pipeline (`send-discord-log.mjs`, `reviewer-work-log.mjs`, `reviewer-ping.mjs`) was removed outright once the community moved off Discord Forums, along with the thread-ID and webhook-URL config it depended on (see "Discord notifications" below). Instead, on a plain-jutsu approval, `handleApprovePending` saves the transcript straight to `jutsu_review_history` (`jutsu_id`, `operation`, `transcript`, `submitted_by`, `reviewed_by`) via `saveJutsuReviewHistory`. RLS restricts the table to `is_reviewer_or_above()` (graders — Character-only reviewers — can't see it). `JutsuHistoryModal`, opened from the clock icon on `JutsuCard` (reviewer+ only), is the read side. Denials aren't stored — there's no resulting jutsu to attach them to.

### RP grading & upgrade credits (Phase 1)

The two Discord-manual workflows — RP grading (`#rp-grading-submission`) and character upgrades (the "My Character Upgrade Area") — run through the site now, while the human read step stays on Discord (graders open the thread link to read the RP). Core model: **a graded RP is a single-use credit** — one credit minted per participating character, tagged with the eligible uses the grader approved; spending it on one upgrade consumes it whole.

- **Pipeline:** player submits an RP → Gate 1 (grader) approves → credits minted → player attaches credits to an upgrade request → Gate 2 (reviewer) approves → the sheet is auto-updated (revert available to reviewer+). Slice-of-Life-only RPs mint no credit.
- `supabase/add-rp-grading-upgrades.sql` — tables (`rp_submissions`, `rp_participants`, `rp_credits`, `upgrade_requests`, plus `character_sheets.credit_multiplier` for the v2 Elite Jōnin passive), RLS, and the atomic SECURITY DEFINER functions: `grade_rp_submission()` (blocks self-grading by site account or Discord ID), `approve_upgrade_request()` (blocks self-OC approval and malformed targets; requires a logged `override_reason` for insufficient credits / weekly cap), `reject_upgrade_request()`, `revert_upgrade()` (restores `before_value`, refunds credits), and `current_upgrade_cycle_key()` / `approved_upgrades_this_cycle()`.
- **Weekly cap:** 2 approved upgrades per character per cycle, counted at approval time, keyed by ISO week evaluated in `America/New_York` (`'2026-W34'`). `currentCycleKey()` in `src/constants/upgradeRules.js` must produce the same string as the SQL function — both are tested against each other; change them together.
- `src/constants/upgradeRules.js` — cost tables (jutsu by rank 1/2/3; stat by level reached 1/1/2/3/4; skill by band 1/2/3/4; dojutsu on its own band table), machine-readable `RANK_CAPS` (the prose `RANK_LIMITS` in characterSheet.js, structured), the target builders (`{ label, tag, path, new_value }` — `path` is the jsonb path `approve_upgrade_request()` writes), and `computeUpgradeWarnings()`. **Warnings never block** — the reviewer approves past them with a logged override reason; only self-grading/self-approval/spent-credit/malformed-target checks are hard server-side blocks.
- `src/pages/GradingPage.jsx` — the "Grading/Upgrade Requests" page at `/grading` (lazy-loaded): wallet (per-OC ledger + cycle usage), submit-RP form, grading queue (grader+), upgrade queue (reviewer+, with the warning panel and revert). Verdict DMs reuse `discord-dm.mjs`; the queue-alert pings this page used to send via `reviewer-ping.mjs` are gone along with the rest of the webhook system (see "Discord notifications" below).

- Upgrade targets write into the sheet's existing structured fields (`stats.*` ranks, `skills.*` percentages, `limited.dojutsu_skill`, the whole `techniques.jutsu` array for learning/dropping a jutsu) — no new sheet schema was needed.
- **Explicitly deferred to v2:** OOC promotions, stat-ceiling increases, character-slot expansion, private multi-specialty jutsu, and the Elite Jōnin path that grants `credit_multiplier = 2`.

### Discord notifications

The webhook/Discord-Forum-thread side of the review workflow was removed once the community stopped using Discord Forums: `reviewer-ping.mjs` (new-submission alerts, the second-reviewer-needed ping, RP/upgrade queue alerts), `send-discord-log.mjs` (the approval/denial embed log), and `reviewer-work-log.mjs` (per-reviewer work-log embeds) are all deleted, along with the client code that called them and the `second_approval_ping_count`/`last_second_approval_ping_at` "Ping Team" button on a pending item. None of it had a replacement — it's just gone. What remains is bot-token DMs to individual Discord users (`discord-dm.mjs` for claim/approve/deny notices to the submitter, `nudge-reviewer.mjs` for the Final Step reviewer nudge), which don't need a guild ID, thread ID, or webhook URL at all. The in-app Work Log page's stats (`logWorkAction()`) are unaffected — they never depended on Discord and are no longer gated behind a reviewer having a `work_thread_id` set (that field only ever mattered for the now-deleted work-log webhook post; it's still on `profiles` and editable from the Member Board, but nothing reads it anymore — a candidate for a future cleanup).

`submission_controls.discord_notifications_paused` (owner-toggleable from System Tools) now only mutes `nudge-reviewer.mjs`, checked server-side the same way as before. `discord-dm.mjs` was never gated by this flag and still isn't.

### Discord role mapping

System Tools' "Discord Role Mapping" panel picks Admin/Reviewer/Grader role IDs from a live dropdown (`discord-guild-roles.mjs`, admin-gated, calls `GET /guilds/{id}/roles` with `DISCORD_BOT_TOKEN`) instead of an operator hand-typing a snowflake. It writes into the same `webhook_config` rows (`discord_admin_role_id`, `discord_reviewer_role_id`, `discord_grader_role_id`) that `discord-login.js` and `sync-discord-roles.js` already read (DB config wins over the `DISCORD_*_ROLE_ID` env vars — see "Permission model" below); `discord_oc_staff_role_id` stays as a read-side legacy fallback for old Discord role assignments made before the grader/reviewer migration, but the picker no longer writes it. Needs `VITE_DISCORD_GUILD_ID` and `DISCORD_BOT_TOKEN` set, and the bot invited to the server, before it can list anything — until then it shows a "not configured" error rather than a raw crash. The `discord_guild_id` / `discord_ping_thread_id` webhook_config rows the old free-text panel wrote are gone; `discord_guild_id` was already dead (stored, never read by anything) even before this.

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
- Character (OC) submissions from admin+ skip the second-approval queue too: `OCSubmissionModal` auto-approves its own insert immediately after `submitPendingJutsu` (via `handleApprovePending`'s `itemOverride` param, since `pendingJutsus` never contains your own submissions). Exception: a bloodline reservation request (`needsReservation`) always stays queued, since a reservation is inherently a waiting period. The character-sheet-before-approval rule above still applies — an admin submission without a sheet yet is left pending rather than force-approved.
- Admins can only flip users between `user`/`grader`/`reviewer`; only the owner manages admins. Role changes are audit-logged in `role_change_log`.
- Roles can also be synced from Discord guild roles via the `sync-discord-roles` function (only when a fresh `provider_token` exists — a plain page reload deliberately skips the sync so a failed Discord lookup can't downgrade anyone). Which Discord role maps to which site tier is set from System Tools' Discord Role Mapping panel (see below) — that DB config wins over the `DISCORD_ADMIN_ROLE_ID`/`DISCORD_REVIEWER_ROLE_ID`/`DISCORD_GRADER_ROLE_ID` env vars, which are only the fallback.
- **The app never grants Discord roles.** Role flow is inbound only: Discord guild roles → site tier (`discord-login.js`, `sync-discord-roles.js`). The old OC-approval automation that handed out Has Character / village / rank / Councilor / OC-count roles has been removed — reviewers assign every Discord role by hand.
- **Summon and Custom Item submissions are currently paused** (`submission_controls.summon_paused` / `custom_item_paused`) — their forms only ever captured a mandatory Google Doc link and nothing else, and that requirement is gone server-wide. Proper in-app sheets for these (same treatment as jutsus/characters) are a future update; the form code (`StatelessSubmissionModal` in App.jsx) is untouched and ready to re-enable once that ships.
- **Storage Calculator** (System Tools, admin+): `get_storage_stats()` (`supabase/add-storage-stats.sql`, SECURITY DEFINER, checks the caller's own role and raises if not admin+) reports row counts and byte sizes for Jutsu vs. Battlemode (split out of the same `jutsus` table), Bloodlines, Roster, and Character Sheets — both an estimated per-row data size (`pg_column_size()`) and the real on-disk table size (`pg_total_relation_size()`, indexes included). `fetchStorageStats()` in `lib/supabase.js` calls it via `.rpc()`.

### Database migrations

`supabase/*.sql` are incremental patch scripts, run manually in the Supabase SQL Editor — there is no migration runner. The full base schema (`schema.sql` referenced by the README) is **not in this repo**; only the incremental `add-*.sql` / trigger scripts are. When changing the schema, add a new idempotent SQL file here, and keep client code tolerant of the column not existing yet (see the `42703` fallback in `fetchMyProfile`).

**Deploy coupling:** `migrate-roles-grader-reviewer.sql` and `add-rp-grading-upgrades.sql` (in that order) must be run **together with** deploying the client code that uses the new role names — the pre-migration client checks for `staff`, so running the SQL first breaks its gates, and deploying the code first leaves it checking for roles that don't exist yet. Old SQL files that mention `staff` are applied history; the migration file recreated everything they defined, so don't edit them.

### Netlify functions (netlify/functions/)

Server-side code using the `SUPABASE_SERVICE_ROLE_KEY` — anything that must bypass RLS or hold secrets lives here, never in client code:

- `sync-discord-roles.js` — recompute a user's role from their Discord guild roles
- `discord-guild-roles.mjs` — admin-gated; lists the configured guild's roles (`DISCORD_BOT_TOKEN`) for the System Tools role-mapping dropdown
- `send-chat-push.mjs` / `send-test-push.mjs` — Web Push (VAPID) delivery for review-chat messages
- `discord-dm.mjs` — bot-token DM to a single Discord user; used for claim/approve/deny notices to submitters and the Final Step reviewer nudge (`nudge-reviewer.mjs`, which checks `submission_controls.discord_notifications_paused` first)
- `ensure-profile.mjs` — profile bootstrap
- `dev-login.js` — password sign-in as a dev account, hard-gated behind `EXPERIMENTAL_MODE=true` in Netlify env

### Netlify edge functions (netlify/edge-functions/)

- `inject-env.ts` — injects `window.__SUPABASE_CONFIG__` into every HTML response
- `serve-markdown.ts` — requests with `Accept: text/markdown` get the live catalog rendered as Markdown (for AI agents/crawlers) instead of the SPA shell

Edge functions run on Deno (`deno.lock`); regular functions run on Node.

### PWA / Web Push

`vite-plugin-pwa` in `injectManifest` mode with a hand-written service worker at `src/sw.js` (Workbox precache + NetworkFirst for `*.supabase.co` + the `push`/`notificationclick` handlers). `netlify.toml` sets `Cache-Control: max-age=0` on `/sw.js` — keep it that way or clients stop updating. Push requires the four `VAPID_*` / `VITE_VAPID_PUBLIC_KEY` env vars (see `.env.example`); `VAPID_PRIVATE_KEY` is server-only and must never get a `VITE_` prefix.

**Update banner:** `registerType: 'prompt'` (not `'autoUpdate'`) — a new service worker installs in the background but does not take over on its own. `src/pwaUpdate.js` registers it, polls `registration.update()` every 30 minutes and on tab-focus (the browser otherwise only checks on navigation, so a tab left open across a deploy would never notice), and exposes `onNeedRefresh` to a tiny subscriber list. `UpdateBanner` (`src/components/ui/UpdateBanner.jsx`, mounted in `main.jsx` next to `<App>`) shows "A new version is available" with a Refresh button wired to `applyPWAUpdate()`, which posts `SKIP_WAITING` to the waiting worker (handled in `sw.js`) and reloads once it takes control. This exists because two separate "the site is missing features I built" reports both turned out to be a stale build sitting silently in an already-open tab — `autoUpdate` never surfaced that anything was wrong.

## Conventions and gotchas

- Env vars exposed to the browser must be prefixed `VITE_`; everything else is server-only. Secrets (service role key, VAPID private key) live only in Netlify env vars and are read only by functions.
- Console logging uses the `[NARP]` prefix (e.g. `[NARP] submitPendingJutsu failed`).
- Review-chat system messages are ordinary `pending_chats` rows with a marker prefix: `[SYSTEM_FINAL_STEP]` (OC final-approval block) and `[SYSTEM_JOIN]` (reviewer joined the chat — also serves as join-state persistence: anyone with a message in a thread counts as having entered it). `fetchChatOverview`/`fetchRecentChats` filter out `[SYSTEM_JOIN]` so joins don't affect turn/unread logic.
- The README's setup guide is the authoritative operational doc (Supabase/Discord/Netlify wiring, env-var table, troubleshooting). There is no consolidated base `schema.sql` in this repo — only incremental `add-*.sql` patch scripts plus `auth-trigger.sql`/`submission-queue-updates.sql` — so standing up a brand-new Supabase project requires a schema-only export from an existing deployment first (see the README's "Run the schema" section).
- `netlify.toml` routes every non-asset path to `index.html` (SPA) and runs `serve-markdown` on all paths; asset caching is immutable, so filenames must stay hashed (Vite default).
- The owner email is hardcoded in the Supabase `handle_new_user()` trigger (see `supabase/auth-trigger.sql` and README).
