# Vaada full-stack authentication and media setup

Use one Supabase project for Vaada Web and the standalone Vaada API. The public website reads published records without login. Google or verified email login is required for AI extraction, submissions, proof uploads and private receipts. Reviewer routes require an explicit database role.

## 1. Install the database

For a new Supabase project, open **SQL Editor**, paste all of `supabase/schema.sql`, and run it once.

If the earlier Vaada schema was already installed, do not rerun the baseline. Run only:

`supabase/migrations/202608270001_permanent_auth_media_assets.sql`

In **Project Settings → Data API** use:

- Enable Data API: on
- Automatically expose new tables: off
- Enable automatic RLS: on

The SQL explicitly enables RLS and creates the required policies.

## 2. Configure Supabase Auth

In **Authentication → Providers**:

- Email: on
- Google: on after adding the Google web Client ID and Client Secret
- Anonymous Sign-Ins: off
- Skip Google nonce checks: off
- Allow Google users without email: off

In **Authentication → URL Configuration**:

- Site URL: `https://vaada-frontend.vercel.app`
- Redirect URL: `https://vaada-frontend.vercel.app/**`
- Local redirect URL: `http://localhost:3000/**`

In Google Cloud, the authorized JavaScript origins are the Vercel origin and `http://localhost:3000`. The authorized redirect URI is the exact Supabase callback URL shown on the Google provider page.

## 3. Deploy the backend on Render

Create a Web Service from `maheepatel/Vaada_backend`.

- Runtime: Node
- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Health check path: `/health`

Set these Render environment variables:

```text
NODE_VERSION=22
PORT=10000
HOST=0.0.0.0
LOG_LEVEL=info
CORS_ORIGINS=https://vaada-frontend.vercel.app
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
OPENAI_API_KEY=YOUR_SERVER_ONLY_OPENAI_KEY
OPENAI_EXTRACTION_MODEL=gpt-5-mini
CRON_SECRET=GENERATE_A_LONG_RANDOM_VALUE
```

Never put the service-role key, OpenAI key or cron secret in GitHub, Vercel frontend variables or any `NEXT_PUBLIC_` value.

After deployment, open `https://YOUR_RENDER_SERVICE/health`. It must return:

```json
{"ok":true,"service":"vaada-backend"}
```

## 4. Connect Vercel

In **Vercel → Vaada_frontend → Settings → Environment Variables**, add for Production and Preview:

```text
VAADA_API_URL=https://YOUR_RENDER_SERVICE
NEXT_PUBLIC_VAADA_API_URL=https://YOUR_RENDER_SERVICE
NEXT_PUBLIC_VAADA_APP_URL=https://YOUR_FUTURE_APP_LINK
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

Redeploy the latest frontend commit after saving the variables.

## 5. Create a reviewer

First sign up normally through Vaada. In Supabase **Authentication → Users**, copy that account's UUID. Run:

```sql
update public.profiles
set role = 'reviewer'
where id = 'PASTE_AUTH_USER_UUID';
```

Use a separate citizen account for submissions. A reviewer cannot approve their own submission unless the account is explicitly an admin.

## 6. Media workflow

1. A permanent user uploads a JPEG, PNG, WebP or PDF up to 10 MB.
2. The backend verifies the real file signature, computes SHA-256 and writes the binary to the private `proof-media` bucket.
3. `media_assets` records the private owner, purpose, original name, MIME type, byte size, hash and lifecycle state.
4. A promise-source image is linked as `promise_source`; completion evidence is linked as `completion_proof`.
5. The submission remains private while queued.
6. Reviewer acceptance publishes promise-source media as `receipt` evidence or completion media as `proof` evidence.
7. Public pages receive no storage path. The API checks that evidence is verified and its promise is published, then issues a short-lived signed URL.

## 7. Required workflow tests

Use two accounts: one citizen and one reviewer.

1. Logged-out browsing works; Record and Submit Proof show a login message.
2. `/submit` and `/my-logs` redirect logged-out users to `/login`.
3. Google login returns to the originally requested route.
4. Email signup requires confirmation; password login and email link login work.
5. A citizen can submit a promise with an original letter image and receives a private receipt.
6. The citizen cannot open `/review`.
7. The reviewer sees the queued source, accepts it, and the public promise page displays the original letter.
8. The citizen submits a completion image against that promise.
9. The reviewer accepts it with progress below 100; the detail page shows progress proof.
10. The reviewer later marks it complete; Completed and the promise detail page display the verified proof image.
11. A rejected upload never appears publicly.
12. Another citizen cannot read the first citizen's receipts or media metadata.

Run local automated validation in both repositories before deployment:

```bash
npm test
```
