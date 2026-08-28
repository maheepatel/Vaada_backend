# Vaada Backend

The standalone API for both Vaada Web and Vaada Mobile. It owns business rules, AI extraction, proof uploads, reviewer authorization and the Supabase database schema.

## Local setup

```bash
npm install
cp .env.example .env
```

1. Create one Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Enable Email and Google providers under Supabase Auth. Anonymous Sign-Ins are not required and should remain disabled for the production submission workflow.
4. Add the project URL, anon key and service-role key to `.env`.
5. Add an OpenAI API key for image/PDF/link extraction.
6. Seed the founding public register with `npm run db:seed`.
7. Start the API with `npm run dev`.

The local API defaults to `http://localhost:8080`.

## Environment

- `CORS_ORIGINS`: comma-separated deployed website origins.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`: shared Supabase project.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only; never place it in web/mobile repos.
- `OPENAI_API_KEY`: server-only extraction credential.
- `CRON_SECRET`: protects candidate-ingestion jobs.

## Identity and media rules

- Public browsing never requires an account.
- Google or verified email login is required for AI extraction, promise submissions, proof uploads and private receipts.
- “Submit anonymously” hides contributor details from the public record; it does not create an unrecoverable anonymous Auth user.
- Files live in the private `proof-media` bucket. `media_assets` stores ownership, purpose, MIME type, byte size and SHA-256 metadata. Database rows reference assets instead of storing binary data.
- A promise-source upload publishes as `receipt` evidence; a completion upload publishes as `proof` evidence only after reviewer acceptance.

## Deploy

Deploy this repository as a Node.js service on Railway, Render, Fly.io or another container/Node host. Use `npm run build` as the build command, `npm start` as the start command, and expose the platform-provided `PORT`.

After deployment, set its URL in both frontend projects and add the website origin to `CORS_ORIGINS`. `/health` confirms that the Node process is alive. `/ready` must return HTTP 200 with every check set to `true` before testing authentication, uploads or AI extraction.

## Validation

```bash
npm run typecheck
npm test
npm run build
```

Security and product rules are documented in `docs/`.
