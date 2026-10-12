# 🚨 URGENT: DO THIS NOW TO FIX THE UPLOAD ERROR

## The Problem

You're getting **"Database error: permission denied for table media_assets"** because the backend is using the WRONG CLIENT TYPE to insert data.

## The Solution (3 Simple Steps)

### ✅ Step 1: Deploy the Backend (5 minutes)

```bash
# In your project folder
git add -A
git commit -m "fix: use public client for media_assets RLS compliance"
git push origin main
```

Wait for Onrender to finish deploying (watch your Onrender dashboard).

---

### ✅ Step 2: Apply Database Migration (2 minutes)

**Go here:** https://app.supabase.com/project/nlbqvxupzjxkhilpcifo/sql/new

**Copy this file contents:** `supabase/migrations/202608300005_fix_rls_policies.sql`

**Paste into SQL editor and click RUN**

The migration will:

- Drop old conflicting policies
- Create new policies for media_assets
- Allow users to upload and manage their own media

---

### ✅ Step 3: Test Image Upload

Try uploading an image again:

```bash
curl -X POST https://vaada-backend.onrender.com/v1/uploads/proof \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@image.jpg" \
  -F "kind=completion_proof"
```

**Expected Result:**

```json
{
  "asset": {
    "id": "...",
    "kind": "completion_proof",
    "originalName": "image.jpg",
    "status": "pending"
  }
}
```

If you see this: **✅ UPLOAD WORKS!**

---

## The Other Error: "This source type not supported"

This error is coming from your **FRONTEND**, not the backend.

**Quick Fix:**

1. Open your frontend code
2. Search for: "This source type" or "Twitter/X"
3. Find the URL validation code
4. Remove domain restrictions (or add news domains like `freepressjournal.in`)

The backend will accept ANY public HTTPS URL and extract text from it.

---

## Timeline

- **Step 1:** 5 min (push to git)
- **Step 2:** 2 min (run SQL)
- **Step 3:** 2 min (test)

**Total: ~10 minutes to fix everything**

---

## If It Still Doesn't Work

1. Check Onrender logs: https://dashboard.render.com/
2. Verify migration ran: Supabase > SQL Editor > Migrations tab
3. Make sure you're using a valid JWT token in the test
4. Check your OpenAI API key is set in .env

Then message me with any errors you see.
