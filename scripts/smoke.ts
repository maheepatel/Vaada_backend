// End-to-end smoke test against the REAL Supabase + OpenAI configured in the
// environment:  sign in -> AI extract from image -> upload -> submit ->
// reviewer sees it -> accept -> public page lists it -> image is served back.
//
// It WRITES to the configured database, so it refuses to run without
// --confirm-live. Everything it creates (temp user, submission, promise,
// evidence, uploaded file) is labelled SMOKE TEST and deleted in `finally`.
//
//   node --env-file=.env --import tsx scripts/smoke.ts --confirm-live
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildApp } from "../src/app.js";
import { publicSupabase, serviceSupabase } from "../src/supabase.js";

if (!process.argv.includes("--confirm-live")) {
  console.error("Refusing to run: this writes to the configured database. Re-run with --confirm-live.");
  process.exit(2);
}
const service = serviceSupabase();
const anon = publicSupabase();
if (!service || !anon) throw new Error("Supabase is not configured.");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}
function multipart(fields: Record<string, string>, file?: { name: string; type: string; data: Buffer }) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (file) form.set("file", new File([new Uint8Array(file.data)], file.name, { type: file.type }));
  return new Response(form);
}
async function post(app: Awaited<ReturnType<typeof buildApp>>, url: string, token: string, body: Response) {
  return app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${token}`, "content-type": body.headers.get("content-type")! },
    payload: Buffer.from(await body.arrayBuffer()),
  });
}

const app = await buildApp();
const email = `smoke-${randomUUID()}@vaada-smoke.example.com`;
const password = `Smoke-${randomUUID()}`;
let userId = "";
let commitmentId = "";
let submissionId = "";
const storagePaths: string[] = [];

try {
  const image = await readFile(new URL("../tests/fixtures/promise-notice.png", import.meta.url));
  const sha = createHash("sha256").update(image).digest("hex");

  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  check("create temp user", !created.error, created.error?.message);
  userId = created.data.user?.id ?? "";
  const session = await anon.auth.signInWithPassword({ email, password });
  const token = session.data.session?.access_token ?? "";
  check("sign in", Boolean(token), session.error?.message);
  if (!token) throw new Error("cannot continue without a session");

  // 0. backend can reach every table
  const ready = await app.inject({ method: "GET", url: "/ready/db" });
  check("/ready/db: service role reaches all tables + private bucket", ready.statusCode === 200, ready.body);

  // 1. AI extraction from an image
  const extract = await post(app, "/v1/extract", token, multipart({ sourceUrl: "", rawText: "" }, { name: "notice.png", type: "image/png", data: image }));
  const extracted = extract.json();
  check("POST /v1/extract (image)", extract.statusCode === 200 && extracted.mode === "ai", `${extract.statusCode} ${extract.statusCode === 200 ? extracted.mode : extract.body}`);
  const draft = extracted.draft ?? {};
  check("extracted dates are YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(draft.promisedOn) && /^\d{4}-\d{2}-\d{2}$/.test(draft.deadlineEnd), `${draft.promisedOn} / ${draft.deadlineEnd}`);
  check("extracted state/category read from the image", draft.state === "Rajasthan" && draft.category === "Education", `${draft.state} / ${draft.category}`);

  // 2. upload to storage + media_assets
  const upload = await post(app, "/v1/uploads/proof", token, multipart({ kind: "promise_source" }, { name: "notice.png", type: "image/png", data: image }));
  const asset = upload.json().asset;
  check("POST /v1/uploads/proof", upload.statusCode === 201 && Boolean(asset?.id), `${upload.statusCode} ${upload.statusCode === 201 ? "" : upload.body}`);
  check("stored sha256 matches the file", asset?.sha256 === sha);
  if (!asset?.id) throw new Error("upload failed");
  const row = await service.from("media_assets").select("storage_path,status").eq("id", asset.id).single();
  check("media_assets row exists and is pending", row.data?.status === "pending", row.error?.message);
  if (row.data?.storage_path) storagePaths.push(row.data.storage_path);

  // 3. submit the promise with the uploaded file attached
  const submit = await app.inject({
    method: "POST",
    url: "/v1/submissions",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: {
      submissionKind: "promise", title: `SMOKE TEST ${draft.title ?? "promise"}`.slice(0, 170), promiseText: draft.promiseText ?? "SMOKE TEST promise text that is long enough.",
      sourceUrl: "", promisedOn: draft.promisedOn ?? "", deadlineStart: draft.deadlineStart ?? "", deadlineEnd: draft.deadlineEnd ?? "", deadlineLabel: draft.deadlineLabel ?? "",
      state: draft.state || "Rajasthan", district: draft.district ?? "", category: draft.category || "Education", accountableOffice: draft.accountableOffice ?? "",
      submitAnonymously: true, mediaAssetId: asset.id, confidence: draft.confidence ?? {}, warnings: draft.warnings ?? [],
    },
  });
  submissionId = submit.json().submission?.id ?? "";
  check("POST /v1/submissions (with uploaded image)", submit.statusCode === 201, `${submit.statusCode} ${submit.statusCode === 201 ? "" : submit.body}`);
  const attached = await service.from("media_assets").select("status").eq("id", asset.id).single();
  check("upload is marked attached", attached.data?.status === "attached", attached.error?.message);

  // 4. reviewer queue shows it with a working signed image URL
  const promote = await service.from("profiles").update({ role: "admin" }).eq("id", userId);
  check("temp user promoted to reviewer", !promote.error, promote.error?.message);
  const queue = await app.inject({ method: "GET", url: "/v1/review/submissions", headers: { authorization: `Bearer ${token}` } });
  const queued = (queue.json().submissions ?? []).find((item: { id: string }) => item.id === submissionId);
  check("GET /v1/review/submissions lists it", queue.statusCode === 200 && Boolean(queued), `${queue.statusCode}`);
  if (queued?.proof_url) {
    const bytes = Buffer.from(await (await fetch(queued.proof_url)).arrayBuffer());
    check("reviewer signed URL returns the original image bytes", createHash("sha256").update(bytes).digest("hex") === sha);
  } else check("reviewer queue item has proof_url", false);

  // 5. accept -> public record
  const decide = await app.inject({
    method: "POST", url: "/v1/review/submissions",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: { submissionId, decision: "accepted", note: "SMOKE TEST acceptance" },
  });
  commitmentId = decide.json().result?.commitment_id ?? "";
  check("POST /v1/review/submissions accepted", decide.statusCode === 200 && Boolean(commitmentId), `${decide.statusCode} ${decide.statusCode === 200 ? "" : decide.body}`);

  // 6. public site can list the promise + its evidence image and fetch the bytes
  const slugRow = await service.from("commitments").select("slug").eq("id", commitmentId).single();
  const detail = await app.inject({ method: "GET", url: `/v1/promises/${slugRow.data?.slug}` });
  const evidence = detail.json().commitment?.evidence?.[0];
  check("public promise lists evidence with hasMedia", detail.statusCode === 200 && evidence?.hasMedia === true, `${detail.statusCode}`);
  const file = await app.inject({ method: "GET", url: `/v1/evidence/${evidence?.id}/file` });
  check("GET /v1/evidence/:id/file redirects to a signed URL", file.statusCode === 302 && Boolean(file.headers.location), `${file.statusCode}`);
  check("image response may be embedded cross-origin", file.headers["cross-origin-resource-policy"] === "cross-origin", String(file.headers["cross-origin-resource-policy"]));
  if (file.headers.location) {
    const res = await fetch(String(file.headers.location));
    const bytes = Buffer.from(await res.arrayBuffer());
    check("public image bytes identical to what was uploaded", res.status === 200 && res.headers.get("content-type") === "image/png" && createHash("sha256").update(bytes).digest("hex") === sha);
  }
  const proofs = await app.inject({ method: "GET", url: `/v1/promises/${slugRow.data?.slug}/proofs` });
  check("GET /v1/promises/:slug/proofs returns a mediaUrl", proofs.statusCode === 200 && Boolean(proofs.json().proofs?.[0]?.mediaUrl), `${proofs.statusCode}`);

  // 7. security regression: a normal user must not be able to make themselves admin
  const regular = await service.auth.admin.createUser({ email: `smoke-${randomUUID()}@vaada-smoke.example.com`, password, email_confirm: true });
  const regularEmail = regular.data.user?.email ?? "";
  const regularSession = await anon.auth.signInWithPassword({ email: regularEmail, password });
  const attack = publicSupabase(regularSession.data.session?.access_token);
  const escalate = await attack!.from("profiles").update({ role: "admin" }).eq("id", regular.data.user?.id ?? "").select();
  const after = await service.from("profiles").select("role").eq("id", regular.data.user?.id ?? "").single();
  check("a signed-in user cannot set their own role to admin", after.data?.role === "citizen" && (Boolean(escalate.error) || (escalate.data ?? []).length === 0), `role=${after.data?.role}`);
  if (regular.data.user?.id) await service.auth.admin.deleteUser(regular.data.user.id);
} catch (error) {
  failures++;
  console.error("ABORTED:", error instanceof Error ? error.message : error);
} finally {
  // Remove everything this run (and any earlier aborted run) created. Order
  // matters because of foreign keys: submissions -> commitments (+evidence) ->
  // media_assets -> users. Only rows labelled SMOKE TEST or owned by the
  // @vaada-smoke.example.com test users are touched.
  const users = (await service.auth.admin.listUsers({ perPage: 1000 })).data.users.filter((u) => u.email?.endsWith("@vaada-smoke.example.com"));
  const userIds = users.map((u) => u.id);
  const note = (what: string, error: { message: string } | null) => { if (error) { failures++; console.error(`CLEANUP FAILED (${what}): ${error.message}`); } };
  const subs = await service.from("submissions").select("id").or(`title.like.SMOKE TEST%${userIds.length ? ",user_id.in.(" + userIds.join(",") + ")" : ""}`);
  const subIds = (subs.data ?? []).map((r) => r.id);
  const assets = userIds.length ? await service.from("media_assets").select("storage_path").in("owner_id", userIds) : { data: [] as { storage_path: string }[] };
  const paths = [...new Set([...storagePaths, ...(assets.data ?? []).map((r) => r.storage_path)])];
  if (subIds.length) {
    note("audit_events", (await service.from("audit_events").delete().in("entity_id", subIds)).error);
    note("submissions", (await service.from("submissions").delete().in("id", subIds)).error);
  }
  note("commitments", (await service.from("commitments").delete().like("title", "SMOKE TEST%")).error); // cascades evidence + timeline
  if (userIds.length) {
    note("audit_events(actor)", (await service.from("audit_events").delete().in("actor_id", userIds)).error);
    note("media_assets", (await service.from("media_assets").delete().in("owner_id", userIds)).error);
    for (const id of userIds) note("auth user", (await service.auth.admin.deleteUser(id)).error);
  }
  if (paths.length) note("storage", (await service.storage.from("proof-media").remove(paths)).error);
  await app.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed. Test data removed.");
  process.exit(failures ? 1 : 0);
}
