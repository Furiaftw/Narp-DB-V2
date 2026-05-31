# NARP Database

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
11. [Step 10 — Add admins and staff via the whitelist](#step-10--add-admins-and-staff-via-the-whitelist)
12. [The pending approval workflow](#the-pending-approval-workflow)
13. [The env-var reference](#the-env-var-reference)
14. [Troubleshooting](#troubleshooting)

---

## Permission model

The site has four tiers. Anyone (signed in or not) can browse the jutsu catalog — these tiers only gate editing and management.

| Tier      | Browse jutsus | Edit jutsus     | Manage bloodlines | Manage roles | Manage whitelist |
| :-------- | :------------ | :-------------- | :-------------------------------- | :----------- | :--------------- |
| **User**  | ✓ read-only   | —               | —                                 | —            | —                |
| **Staff** | ✓             | ✓ via approval  | —                                 | —            | —                |
| **Admin** | ✓             | ✓ direct        | ✓ direct                          | User↔Staff   | Staff entries    |
| **Owner** | ✓             | ✓ direct        | ✓ direct                          | Anything     | Anything         |

**Key rules baked into the database (not just the UI):**

- **Only one public tab: Jutsus.** Bloodlines are managed inside System Tools — they populate the bloodline-name dropdown in jutsu filters but don't have their own browse view.
- **Slot tracking moved off-site.** Bloodline and limited-spec slot tracking lives on a separate website now. Jutsus still track their own Limited slots (with the view-slots eye icon for users to see who holds them).
- **Staff can't directly edit jutsus.** Their inserts, edits, and deletes go to a `pending_jutsus` queue and need a second person to approve.
- **Anyone who isn't the submitter can approve.** Another Staff is enough — it doesn't have to be an admin. Admins bypass approval for their own changes.
- **Staff cannot touch bloodlines at all.** Admin+ only.
- **Only the Owner can promote/demote Admins.** Admins can only flip people between User and Staff.
- **The owner email is hardcoded.** `grisales4000@gmail.com` gets the owner role automatically on first sign-in, and the trigger re-asserts it on every sign-in to prevent accidental SQL lockouts. To change it, edit one string in `supabase/schema.sql` and re-run.

---

## Step 1 — Local checkout

You need **Node 18 or newer**. Check with `node -v`.

```bash
git clone <your-fork-url> narp-database
cd narp-database
npm install
npm run dev
```

The dev server runs at `http://localhost:5173`. Without Supabase env vars yet, the app boots on seed data and shows a "Dev: User / Dev: Admin" toggle in the header — useful for testing the UI without a backend. (Dev mode only has two effective tiers; the full four-tier system needs Supabase.)

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

1. Click **SQL Editor** in the left nav.
2. Click **New query**.
3. Open `supabase/schema.sql` from this repo, copy the whole thing, paste it into the SQL Editor.

   **If your owner email isn't `grisales4000@gmail.com`**, find the `owner_email := 'grisales4000@gmail.com'` line in the `handle_new_user()` function (and the matching one in the `on conflict` clause), replace with your email, then run.

4. Click **Run**.
5. Open a new query, paste in `supabase/add-username.sql`, and **Run** it too. This adds the `username` column that every member is prompted to choose on their first sign-in.

Quick sanity check: click **Table Editor** in the left nav. You should see seven tables — `jutsus`, `bloodlines`, `specializations`, `profiles`, `whitelist`, `pending_jutsus`, `role_change_log`. The `profiles` table should now have a `username` column.

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
2. Click **New Application**, name it (`NARP Database` is fine), accept the terms, **Create**.
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
cd narp-database
git init
git add .
git commit -m "Initial commit"
```

Create an empty repository on GitHub (no README), then:

```bash
git remote add origin git@github.com:your-username/narp-database.git
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
4. On your very first sign-in you'll be asked to **choose a username** before you can use the site. Pick one (3–20 characters, letters/numbers/underscores) — it's how you'll appear to staff and other members.

If your email matches the hardcoded one in `handle_new_user()`, you'll come back as the **owner** automatically — you should see your role badge say `owner`, plus a **System Tools** button in the header and a **Manage Users & Whitelist** option in your avatar dropdown.

If you forgot to change the hardcoded email in the schema before running it, the simplest fix: edit `supabase/schema.sql`, re-run the whole thing (it's idempotent), then sign out and sign back in.

---

## Step 10 — Add admins and staff via the whitelist

This is your day-to-day workflow for granting access.

1. Click your avatar → **Manage Users & Whitelist**.
2. Click the **Whitelist** sub-tab.
3. Type someone's Gmail address, pick **staff** or **admin**, click **Add**.
4. Tell them to sign in to the site with Discord. As soon as they do, they'll have the role you whitelisted them with. No manual approval, no waiting.

If they already signed in once as a `user` before being whitelisted, no problem — adding them to the whitelist also retroactively updates their role.

To revoke: remove their whitelist entry, then in the **People** tab change their role to `user`. They keep their Discord account but lose all privileges. (Their pending submissions auto-cancel on demotion.)

> **Admins see a filtered view.** Admins can only see User and Staff profiles, and Staff-level whitelist entries. Owner sees everything. Owner is the only one who can demote an Admin or remove an admin whitelist entry.

---

## The pending approval workflow

When **Staff** edits a jutsu (insert, edit, or delete), it doesn't go live immediately — it lands in the **Pending** tab as a submission waiting for a second pair of eyes.

The flow:

1. Staff member fills out the Add/Edit form and clicks **Submit for Approval**. An amber banner in the form makes this obvious before they click.
2. The entry appears in the **Pending** tab (only Staff+ can see this tab — regular users don't even know it exists).
3. Any *other* Staff member or any Admin can hit **Approve** — at which point the change applies to the live jutsus table.
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

¹ Only one of the two URL variables is needed. If both are set, `VITE_SUPABASE_URL` wins.

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
Either (a) you didn't update the email in `handle_new_user()` before running the schema, or (b) the trigger didn't fire because you ran the schema *after* signing in. Fix: in Supabase SQL Editor, run `UPDATE profiles SET role = 'owner' WHERE email = 'your@email.com';` — that's the one-time bootstrap.

**Whitelist add says "Only the owner can whitelist admins."**
You're signed in as an admin, not the owner. Admins can only add Staff entries. Only the owner can grant admin-level access.

**A Staff member's edit isn't showing up in the Jutsus tab.**
That's by design — it's in the Pending tab waiting for a second approval. Click the Pending tab and hit Approve. (Or, if you're the original submitter, ask another Staff or any Admin to approve.)

**"Permission denied" when trying to change a role.**
Owners can change anyone. Admins can only flip people between user and staff. If you're trying to promote someone to admin or demote an admin and you're not the owner, that's blocked at the database level.

**Edits work locally but not on the deployed site.**
Env vars aren't reaching the production build. Check Netlify's environment variables and trigger a fresh deploy.

**The Pending tab is empty but I just submitted something.**
Check the browser console for `[NARP] submitPendingJutsu failed`. Usually means your role is `user`, not `staff` — staff submissions go to pending, user submissions are blocked entirely. Get the owner to whitelist you as staff.

**I demoted a Staff to User and their pending submissions disappeared.**
By design — `cleanup_pending_on_demotion` trigger cancels their pending entries automatically when they lose staff privileges. Otherwise they'd be ghost submissions from someone who can no longer resubmit.

---

## Project structure

```
narp-database/
├── README.md                   ← this file
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── netlify.toml                ← Netlify build config + SPA redirect
├── index.html
├── .env.example
├── .gitignore
├── App.claude-preview.jsx      ← single-file version for Claude artifact preview (not used by build)
├── supabase/
│   ├── schema.sql              ← run once in Supabase SQL Editor
│   └── add-username.sql        ← run once to add the username column
└── src/
    ├── main.jsx
    ├── index.css
    ├── App.jsx                 ← all UI + business logic (production)
    └── lib/
        └── supabase.js         ← Supabase client + data layer + auth + RPC
```

### About `App.claude-preview.jsx`

This is a single-file copy of `src/App.jsx` with all Supabase imports replaced by inline no-op stubs. It exists because Claude's artifact runtime can only resolve a fixed allowlist of imports (`react`, `lucide-react`, `recharts`, etc.) — it can't load `./lib/supabase`. With the stubs, `isSupabaseConfigured()` returns false and the app boots into dev mode (localStorage + seed data + role toggle), so you can preview/debug the UI inside Claude without a backend.

**The build (`npm run build` / Netlify) does NOT use this file.** It uses `src/App.jsx`. The preview file exists purely for in-Claude debugging — paste it into a Claude artifact and iterate.

**What you can test from the preview:** all jutsu UI flows, the view-slots eye-icon button on Limited jutsus, the catalog management modal for bloodlines, the dev role toggle (Dev: User / Dev: Admin), filters, sorting, session-list cart, personal tags.

**What you can't test:** Discord sign-in, the pending-approval workflow, the whitelist, the audit log. These need a real Supabase backend — deploy to Netlify to test those.

**Keeping the two files in sync:** any structural change you make in `src/App.jsx` should be mirrored to `App.claude-preview.jsx`. The only intentional difference is the import block at the top.

---

## License

Personal/community use. Not affiliated with the Naruto IP — fan project.
