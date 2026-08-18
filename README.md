# SARP Database

A jutsu reference database for a text-based Naruto roleplay Discord server. Players browse jutsus, filter them in detail, build a personal "session list" they can paste into Discord, and (for the right roles) edit the catalog directly from the browser. Bloodlines remain as filter values but live behind the admin panel; limited specs were moved to a separate site.

Built on React + Vite, styled with Tailwind, backed by Supabase (Postgres + Discord Auth + Row-Level Security), deployed on Netlify.

---

## Table of contents

1. [Permission model](#permission-model)
2. [Step 1 — Local checkout](#step-1--local-checkout)
3. [Step 2 — Create the Supabase project](#step-2--create-the-supabase-project)
4. [Step 3 — Set up Discord OAuth](#step-3--set-up-discord-oauth)
5. [Step 4 — Connect Discord to Supabase](#step-4--connect-discord-to-supabase)
6. [Step 5 — Push the repo to GitHub](#step-5--push-the-repo-to-github)
7. [Step 6 — Deploy to Netlify](#step-6--deploy-to-netlify)
8. [Step 7 — Connect Netlify to Supabase via the official extension](#step-7--connect-netlify-to-supabase-via-the-official-extension)
9. [Step 8 — Finish the redirect URL handshake](#step-8--finish-the-redirect-url-handshake)
10. [Step 9 — First sign-in (you're auto-promoted to owner)](#step-9--first-sign-in)
11. [Step 10 — Add admins, reviewers, and graders via the whitelist](#step-10--add-admins-reviewers-and-graders-via-the-whitelist)
12. [Pages and links](#pages-and-links)
13. [The pending approval workflow](#the-pending-approval-workflow)
14. [The env-var reference](#the-env-var-reference)
15. [Troubleshooting](#troubleshooting)

---

## Permission model

The site has five tiers. Anyone (signed in or not) can browse the jutsu catalog — these tiers only gate editing and management.

| Tier         | Browse jutsus | Edit jutsus     | Grade RPs (Gate 1) | Approve upgrades (Gate 2) | Manage bloodlines | Manage roles         | Manage whitelist        |
| :----------- | :------------ | :-------------- | :----------------- | :------------------------ | :---------------- | :------------------- | :---------------------- |
| **User**     | ✓ read-only   | —               | —                  | —                         | —                 | —                    | —                       |
| **Grader**   | ✓             | — (OC review only) | ✓               | —                         | —                 | —                    | —                       |
| **Reviewer** | ✓             | ✓ via approval  | ✓                  | ✓                         | —                 | —                    | —                       |
| **Admin**    | ✓             | ✓ direct        | ✓                  | ✓                         | ✓ direct          | User↔Grader↔Reviewer | Grader/Reviewer entries |
| **Owner**    | ✓             | ✓ direct        | ✓                  | ✓                         | ✓ direct          | Anything             | Anything                |

**Key rules baked into the database (not just the UI):**

- **The catalog, bloodlines and roster are public.** Everything else needs a sign-in or a role — see [Pages and links](#pages-and-links).
- **Slot tracking moved off-site.** Bloodline and limited-spec slot tracking lives on a separate website now. Jutsus still track their own Limited slots (with the view-slots eye icon for users to see who holds them).
- **Reviewers can't directly edit jutsus.** Their inserts, edits, and deletes go to a `pending_jutsus` queue and need a second person to approve.
- **Anyone who isn't the submitter can approve.** Another Reviewer is enough — it doesn't have to be an admin. Admins bypass approval for their own changes.
- **Graders are OC + RP specialists.** They can review Character submissions and grade RPs (minting upgrade credits), but not jutsu submissions or upgrade requests.
- **Reviewers cannot touch bloodlines at all.** Admin+ only.
- **Only the Owner can promote/demote Admins.** Admins can only flip people between User, Grader, and Reviewer.
- **Grading and upgrade approvals are conflict-guarded.** A grader who participated in an RP can't grade it, and a reviewer can't approve an upgrade for their own OC — enforced in the database functions, not just hidden in the UI.
- **The first owner is granted via the whitelist, not a hardcoded email.** Before your first sign-in, insert your own email into the `whitelist` table with `role = 'owner'`; `ensure-profile` (and the `handle_new_user` trigger's whitelist check) consumes that row on your first login and deletes it.

---

## Step 1 — Local checkout

You need **Node 18 or newer**. Check with `node -v`.

```bash
git clone <your-fork-url> sarp-database
cd sarp-database
npm install
npm run dev
```

The dev server runs at `http://localhost:5173`. Without Supabase env vars yet, the app boots on seed data and shows a "Dev: User / Dev: Admin" toggle in the header — useful for testing the UI without a backend. (Dev mode only has two effective tiers; the full five-tier system needs Supabase.)

---

## Step 2 — Create the Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up.
2. Click **New Project**.
   - **Name**: anything (`narp-db` is fine).
   - **Database password**: generate a strong one and save it in a password manager.
   - **Region**: pick the one closest to most of your players.
   - **Pricing plan**: Free.
3. Click **Create new project** and wait ~1–2 minutes.

### Run the schema

> **Note:** this repo does not contain a single consolidated base schema file. `supabase/` only has incremental `add-*.sql` patch scripts (plus `auth-trigger.sql` and `submission-queue-updates.sql`) that assume the base tables (`jutsus`, `bloodlines`, `specializations`, `profiles`, `whitelist`, `pending_jutsus`, `role_change_log`, and more added since) already exist. There is no documented run order and no fully self-contained way to stand up a brand-new Supabase project from this repo alone. If you're forking this project, get a schema-only export (Supabase dashboard → **Database** → **Backups**, or `supabase db dump --schema public`) from an existing deployment first, or ask the maintainer for one — then layer any `add-*.sql` files newer than that export on top, oldest to newest by git history.

1. Click **SQL Editor** in the left nav.
2. Click **New query**, paste in your base schema export, and **Run** it.
3. Open a new query, paste in `supabase/auth-trigger.sql`, and **Run** it. This creates the `handle_new_user()` trigger that copies each new Discord sign-in into `profiles` (checking `whitelist` for a pre-assigned role).
4. Apply any remaining `supabase/add-*.sql` files that aren't already reflected in your base export, each in its own query.

Quick sanity check: click **Table Editor** in the left nav and confirm `jutsus`, `bloodlines`, `specializations`, `profiles`, `whitelist`, `pending_jutsus`, and `role_change_log` are all present with a `username` column on `profiles`.

### Grab your two credentials

1. Click the gear icon (⚙️ **Project Settings**) in the left nav.
2. Click **API**.
3. Copy:
   - **Project URL** (looks like `https://abcdefghijkl.supabase.co`)
   - **anon public** key (long string starting with `eyJ...`)

---

## Step 3 — Set up Discord OAuth

Discord OAuth is quick — one application, one secret.

### 3a. Create a Discord application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications).
2. Click **New Application**, name it (`SARP Database` is fine), accept the terms, **Create**.
3. In the left nav, open **OAuth2**.
4. Copy the **Client ID** and, under **Client Secret**, click **Reset Secret** → **Copy**. Keep these handy for Step 4.

### 3b. Add the redirect URL

1. Still under **OAuth2**, find **Redirects** → **Add Redirect**.
2. Paste your Supabase callback URL (`https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`). You'll get the exact value in Step 4 — come back and paste it here once you have it.
3. **Save Changes**.

> The `email` and `identify` scopes (which the app relies on) are requested automatically by Supabase — no extra configuration needed.

---

## Step 4 — Connect Discord to Supabase

1. Supabase dashboard → **Authentication → Providers**.
2. Find **Discord**, click it.
3. Toggle **Enable Sign in with Discord** on.
4. Paste your **Client ID** and **Client Secret** from Step 3a.
5. **Copy the Callback URL** Supabase shows you (`https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`) — paste it back into Discord's **Redirects** list (Step 3b).
6. **Save**.

---

## Step 5 — Push the repo to GitHub

```bash
cd sarp-database
git init
git add .
git commit -m "Initial commit"
```

Create an empty repository on GitHub (no README), then:

```bash
git remote add origin git@github.com:your-username/sarp-database.git
git branch -M main
git push -u origin main
```

---

## Step 6 — Deploy to Netlify

1. [app.netlify.com](https://app.netlify.com) → sign in with GitHub.
2. **Add new site → Import an existing project → GitHub** → pick your repo.
3. Netlify auto-detects Vite (build: `npm run build`, publish: `dist`). These are also in `netlify.toml`.
4. Don't add env vars yet — the extension does it next.
5. **Deploy site**.

After the build, copy your site URL (`https://something-12345.netlify.app`). You'll register it as a redirect target in Step 8.

---

## Step 7 — Connect Netlify to Supabase via the official extension

1. Netlify → your team → **Extensions** in the left nav (or `app.netlify.com/teams/<your-team>/extensions`).
2. Search **Supabase** → click it → **Install**.
3. Open your site → **Project configuration → General**. There's a new **Supabase** section.
4. Click **Connect**, authorize via OAuth, return.
5. **Supabase project**: pick the one you made in Step 2. **Framework**: pick **Vite** if available, otherwise **Custom** with prefix `VITE_`.
6. **Save**.

This auto-creates `VITE_SUPABASE_DATABASE_URL` and `VITE_SUPABASE_ANON_KEY` in your site's environment variables.

Env-var changes don't auto-rebuild. **Deploys → Trigger deploy → Deploy site.** Wait for the build to finish.

---

## Step 8 — Finish the redirect URL handshake

Two small fix-ups to make sign-in actually work.

### 8a. Confirm Supabase's callback URL is in Discord

1. **Discord Developer Portal → your application → OAuth2 → Redirects**.
2. Make sure the Supabase callback URL from Step 4 (`https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`) is listed.
3. **Save Changes**.

### 8b. Tell Supabase what URLs to redirect back to

1. Supabase → **Authentication → URL Configuration**.
2. **Site URL**: your Netlify URL.
3. **Redirect URLs** → add each:
   - `https://your-site.netlify.app`
   - `https://your-site.netlify.app/**`
   - `http://localhost:5173`
   - `http://localhost:5173/**`
4. **Save**.

---

## Step 9 — First sign-in

1. Open your deployed site.
2. Click **Sign in with Discord** in the top-right.
3. Authorize the app with your Discord account.
4. On your very first sign-in you'll be asked to **choose a username** before you can use the site. Pick one (3–20 characters, letters/numbers/underscores) — it's how you'll appear to the review team and other members.

If you inserted your email into `whitelist` with `role = 'owner'` before this sign-in (see [Permission model](#permission-model)), you'll come back as the **owner** automatically — you should see your role badge say `owner`, plus a **System Tools** button in the header and a **Manage Users & Whitelist** option in your avatar dropdown.

If you forgot that step and signed in as a plain `user`, the simplest fix: in the SQL Editor, run `update public.profiles set role = 'owner' where email = 'you@example.com';` with your own email, then sign out and back in.

---

## Step 10 — Add admins, reviewers, and graders via the whitelist

This is your day-to-day workflow for granting access.

1. Click your avatar → **Manage Users & Whitelist**.
2. Click the **Whitelist** sub-tab.
3. Type someone's Gmail address, pick **grader**, **reviewer**, or **admin**, click **Add**.
4. Tell them to sign in to the site with Discord. As soon as they do, they'll have the role you whitelisted them with. No manual approval, no waiting.

If they already signed in once as a `user` before being whitelisted, no problem — adding them to the whitelist also retroactively updates their role.

To revoke: remove their whitelist entry, then in the **People** tab change their role to `user`. They keep their Discord account but lose all privileges. (Their pending submissions auto-cancel on demotion.)

> **Admins see a filtered view.** Admins can only see User, Grader, and Reviewer profiles, and grader/reviewer-level whitelist entries. Owner sees everything. Owner is the only one who can demote an Admin or remove an admin whitelist entry.

---

## Pages and links

Every section has its own address, so you can link someone straight to it:

| Link | What it is | Who can open it |
| :--- | :--- | :--- |
| `/` | The jutsu catalog | anyone |
| `/bloodlines` | Bloodline list | anyone |
| `/roster` | Village roster | anyone |
| `/grading` | Grading & Upgrade Requests — submit RPs, spend credits, review the queues | signed in |
| `/combat` | Combat Tracker — create/join a turn-by-turn battle, declare techniques, watch the turn log | signed in |
| `/history/work-log` | Review throughput per person | reviewers+ |
| `/history/audit-log` | Role-change history | admins+ |
| `/submissions` | Your submissions and review chats — and the green **Submit** button for filing a new entry | signed in |
| `/members` | Member board | admins+ |

The dark strip under the site title switches between these; the Jutsus/Bloodlines tabs and the
jutsu filter bar only appear on the catalog itself. Opening a page you don't have access to
tells you so rather than bouncing you back to the catalog.

---

## The pending approval workflow

When a **Reviewer** edits a jutsu (insert, edit, or delete), it doesn't go live immediately — it lands in the **Pending** tab as a submission waiting for a second pair of eyes.

The flow:

1. The reviewer fills out the Add/Edit form and clicks **Submit for Approval**. An amber banner in the form makes this obvious before they click.
2. The entry appears in the **Pending** tab (only reviewers+ can see this tab — regular users don't even know it exists).
3. Any *other* Reviewer or any Admin can hit **Approve** — at which point the change applies to the live jutsus table.
4. The submitter cannot approve their own submission. They can **Cancel** it, which deletes the pending entry. To make changes, they have to cancel and start over (no inline editing of pending entries).

**Admins skip the queue entirely.** When an admin clicks Save in the form, it writes directly to the database. They can still view/approve/cancel anyone's pending entries.

**Approval is atomic.** A Postgres function called `approve_pending_jutsu()` applies the operation in a single transaction and removes the pending row. If two people somehow approve at once, the second one finds no pending entry and harmlessly errors out.

**Edge cases the function handles:**

- Pending update on a jutsu that was directly deleted by an admin → raises `"The jutsu this update targets no longer exists. Cancel and resubmit."`
- Pending delete on a jutsu that was already deleted → silently succeeds (the pending row is just removed).

### Sync Data button (Admin+ only)

In **System Tools → Synchronization**, there's a **Sync data** button. It re-fetches the catalog and pending list from the database.

It's only really needed when *another* admin made changes you want to see locally — the app already auto-refreshes after your own approvals, saves, and deletes. It's gated to Admin+ so we don't burn read quota with regular users hammering refresh.

### Audit log

In **System Tools → Audit Log → View log**, there's a list of every role change ever made — who got promoted/demoted, by whom, and when. Useful if there's ever drama in the group and you need to retrace a decision.

---

## The env-var reference

| Variable                       | Required | Set by                                  | What it is                                              |
| :----------------------------- | :------: | :-------------------------------------- | :------------------------------------------------------ |
| `VITE_SUPABASE_URL`            | yes¹     | manual                                  | Your Supabase project URL.                              |
| `VITE_SUPABASE_DATABASE_URL`   | yes¹     | Supabase Netlify extension              | Same thing, different name. Either is accepted.         |
| `VITE_SUPABASE_ANON_KEY`       | yes      | manual or extension                     | Anon public key. Safe to ship in the client bundle — RLS does the security work. |
| `VITE_VAPID_PUBLIC_KEY`        | for push | manual                                  | Web Push public (VAPID) key. Shipped to the browser — safe to expose. Build scope. |
| `VAPID_PUBLIC_KEY`             | for push | manual                                  | Same public key, read by the Netlify push function. Functions scope.    |
| `VAPID_PRIVATE_KEY`            | for push | manual (**secret**)                     | Web Push private (VAPID) key. **Server-only secret** — never prefix with `VITE_`. |
| `VAPID_SUBJECT`                | for push | manual                                  | A `mailto:` contact for the push service, e.g. `mailto:you@example.com`. |

¹ Only one of the two URL variables is needed. If both are set, `VITE_SUPABASE_URL` wins.

### Push notifications (the bell icon)

The site can send real OS-level push notifications when a new message is posted
in a submission's review chat — delivered to the recipient's phone or desktop
even when the site is closed. This uses the standard Web Push API.

To enable it:

1. Generate a VAPID keypair once: `npx web-push generate-vapid-keys`.
2. Set the four `VAPID_*` / `VITE_VAPID_PUBLIC_KEY` vars above (same public key in
   both `VITE_VAPID_PUBLIC_KEY` and `VAPID_PUBLIC_KEY`). Mark `VAPID_PRIVATE_KEY`
   as a secret in Netlify, then trigger a fresh deploy so the build picks them up.
3. Each user clicks the **bell icon** in the header and accepts the browser
   permission prompt. Their device is then stored in the `push_subscriptions`
   table and will receive pushes.

**iPhone / iOS:** Apple only allows web push for sites that have been **installed
to the Home Screen** (Add to Home Screen / "Install app") on iOS 16.4+. Android
Chrome and all desktop browsers work directly in the browser tab. This is an
Apple platform limitation, not a bug in the app.

For local dev: put them in a `.env` file at the repo root (gitignored — see `.env.example`).

The `VITE_` prefix is mandatory — Vite only exposes prefixed vars to client code. That's a security feature, not a bug.

---

## Troubleshooting

**"Sign in with Discord" button opens Discord then bounces back to a blank page.**
The redirect URL handshake (Step 8) is incomplete. Check:
- Supabase's callback URL is in Discord's **OAuth2 → Redirects** list (`<ref>.supabase.co/auth/v1/callback`)
- Your Netlify URL is in Supabase's "Redirect URLs" list with the `/**` wildcard variant
- The **Discord** provider is enabled in Supabase (**Authentication → Providers**) with a valid Client ID and Secret

**I signed in as the owner email but my role says `user`.**
Either (a) you didn't whitelist your email with `role = 'owner'` before signing in, or (b) the trigger didn't fire because you ran the schema *after* signing in. Fix: in Supabase SQL Editor, run `UPDATE profiles SET role = 'owner' WHERE email = 'your@email.com';` — that's the one-time bootstrap.

**Whitelist add says "Only the owner can whitelist admins."**
You're signed in as an admin, not the owner. Admins can only add Grader and Reviewer entries. Only the owner can grant admin-level access.

**A Reviewer's edit isn't showing up in the Jutsus tab.**
That's by design — it's in the Pending tab waiting for a second approval. Click the Pending tab and hit Approve. (Or, if you're the original submitter, ask another Reviewer or any Admin to approve.)

**"Permission denied" when trying to change a role.**
Owners can change anyone. Admins can only flip people between user, grader, and reviewer. If you're trying to promote someone to admin or demote an admin and you're not the owner, that's blocked at the database level.

**Edits work locally but not on the deployed site.**
Env vars aren't reaching the production build. Check Netlify's environment variables and trigger a fresh deploy.

**The Pending tab is empty but I just submitted something.**
Check the browser console for `[NARP] submitPendingJutsu failed`. Usually means your role is `user`, not `reviewer` — reviewer submissions go to pending, user submissions are blocked entirely. Get the owner to whitelist you as a reviewer.

**I demoted a Reviewer to User and their pending submissions disappeared.**
By design — `cleanup_pending_on_demotion` trigger cancels their pending entries automatically when they lose team privileges. Otherwise they'd be ghost submissions from someone who can no longer resubmit.

**I enabled the bell but no push notifications arrive.**
Work down this list:
- Open the browser console after clicking the bell. `VITE_VAPID_PUBLIC_KEY is not set` means the build is missing the public VAPID key — set the env vars and redeploy.
- Confirm a row exists for your user in the `push_subscriptions` table (Supabase → Table editor). No row means the subscribe step failed (keys missing, permission denied, or service worker not registered).
- Check the `send-chat-push` function logs in Netlify. `VAPID not configured` (HTTP 500) means the server-side `VAPID_*` vars are missing. `sent=0` means there were no saved subscriptions for the recipients.
- On iPhone, the site must be installed to the Home Screen first (see the push notifications section above).

---

## Project structure

```
sarp-database/
├── README.md                   ← this file
├── CLAUDE.md                   ← guidance for AI coding agents working in this repo
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── netlify.toml                ← Netlify build config + SPA redirect
├── index.html
├── .env.example
├── .gitignore
├── supabase/                   ← incremental `add-*.sql` patch scripts, run manually (see "Run the schema" above)
├── netlify/
│   ├── functions/              ← Node serverless functions (service-role access, Discord webhooks/DM, push)
│   └── edge-functions/         ← Deno edge functions (env injection, markdown rendering for crawlers)
└── src/
    ├── main.jsx
    ├── index.css
    ├── App.jsx                 ← most of the UI + business logic (production)
    ├── lib/
    │   └── supabase.js         ← Supabase client + data layer + auth + RPC
    ├── pages/                  ← RosterPage, InboxPage, WorkStatsPage
    ├── components/             ← feature/modal/layout/ui components imported by App.jsx and the pages above
    ├── constants/              ← catalog + character/jutsu sheet shape constants
    ├── hooks/
    └── utils/
```

---

## License

Personal/community use. Not affiliated with the Naruto IP — fan project.
