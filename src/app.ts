import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyRequest } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { config, originIsAllowed, readinessChecks } from "./config.js";
import { extractWithAgent, fetchPublicSourceText } from "./extract.js";
import { assessCompletionSource } from "./proof-validation.js";
import {
  getCommitment,
  getPendingCompletionProofCount,
  listCommitments,
} from "./repository.js";
import { bearer, publicSupabase, serviceSupabase } from "./supabase.js";

const dateValue = z
  .string()
  .regex(/^$|^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");
const submissionSchema = z
  .object({
    submissionKind: z.enum(["promise", "proof"]).default("promise"),
    targetCommitmentSlug: z.string().max(220).optional(),
    title: z.string().min(8).max(180),
    promiseText: z.string().min(20).max(10000),
    sourceUrl: z.string().url().or(z.literal("")),
    promisedOn: dateValue,
    deadlineStart: dateValue.default(""),
    deadlineEnd: dateValue.default(""),
    deadlineLabel: z.string().max(160),
    state: z.string().max(80),
    district: z.string().max(80),
    category: z.string().max(80),
    accountableOffice: z.string().max(180),
    submitterName: z.string().max(120).optional(),
    submitterEmail: z.string().email().optional().or(z.literal("")),
    submitAnonymously: z.boolean(),
    mediaAssetId: z.string().uuid().optional(),
    rawText: z.string().max(30000).optional(),
    confidence: z.record(z.string(), z.number()),
    warnings: z.array(z.string()).max(20),
  })
  .refine((value) => Boolean(value.sourceUrl || value.mediaAssetId), {
    message: "A public source URL or uploaded proof is required.",
  })
  .refine(
    (value) =>
      value.submissionKind !== "proof" || Boolean(value.targetCommitmentSlug),
    { message: "Choose the promise this proof belongs to." },
  )
  .refine(
    (value) =>
      !value.deadlineStart ||
      !value.deadlineEnd ||
      value.deadlineStart <= value.deadlineEnd,
    { message: "The completion window end must be on or after its start." },
  );
const decisionSchema = z.object({
  submissionId: z.string().uuid(),
  decision: z.enum(["accepted", "rejected", "needs_info"]),
  note: z.string().min(3).max(1000),
  progressAfter: z.number().int().min(0).max(100).optional(),
  markCompleted: z.boolean().default(false),
});
const profileSchema = z
  .object({
    displayName: z.string().trim().max(120),
    contributorType: z.enum([
      "citizen",
      "government_official",
      "news_reporter",
    ]),
    defaultSubmitAnonymously: z.boolean(),
  })
  .strict()
  .refine(
    (value) => value.defaultSubmitAnonymously || value.displayName.length >= 2,
    { message: "Add a display name before using public credit." },
  );
const allowedMime = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
type Upload = { buffer: Buffer; mimeType: string; name: string };
function matchesDeclaredType(file: Upload) {
  const b = file.buffer;
  return (
    (file.mimeType === "image/jpeg" && b[0] === 0xff && b[1] === 0xd8) ||
    (file.mimeType === "image/png" &&
      b
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (file.mimeType === "image/webp" &&
      b.subarray(0, 4).toString() === "RIFF" &&
      b.subarray(8, 12).toString() === "WEBP") ||
    (file.mimeType === "application/pdf" &&
      b.subarray(0, 5).toString() === "%PDF-")
  );
}

async function multipartInput(request: FastifyRequest) {
  const fields: Record<string, string> = {};
  let file: Upload | undefined;
  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        const buffer = await part.toBuffer();
        file = { buffer, mimeType: part.mimetype, name: part.filename };
      } else fields[part.fieldname] = String(part.value ?? "");
    }
  } catch (error) {
    if (config.logLevel) {
      console.error("Multipart parsing error:", error);
    }
  }
  return { fields, file };
}
async function userFrom(request: FastifyRequest) {
  const token = bearer(request.headers.authorization);
  const service = serviceSupabase();
  if (!token || !service) return null;
  const {
    data: { user },
  } = await service.auth.getUser(token);
  return user ? { user, token, service } : null;
}
export function isPermanentUser(
  user: { is_anonymous?: boolean } | null | undefined,
) {
  return Boolean(user && !user.is_anonymous);
}
async function permanentUserFrom(request: FastifyRequest) {
  const auth = await userFrom(request);
  return auth && isPermanentUser(auth.user) ? auth : null;
}
async function reviewerFrom(request: FastifyRequest) {
  const auth = await permanentUserFrom(request);
  if (!auth) return null;
  const { data } = await auth.service
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  return data && ["reviewer", "admin"].includes(data.role) ? auth : null;
}

export async function buildApp() {
  const app = Fastify({
    logger: config.logLevel ? { level: config.logLevel } : false,
    bodyLimit: 11 * 1024 * 1024,
  });
  await app.register(cors, {
    origin: (origin, callback) => callback(null, originIsAllowed(origin)),
    allowedHeaders: ["content-type", "authorization", "x-cron-secret"],
    methods: ["GET", "PATCH", "POST", "OPTIONS"],
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 },
  });
  app.get("/health", async () => ({ ok: true, service: "vaada-backend" }));
  app.get("/ready", async (_request, reply) => {
    const ok = Object.values(readinessChecks).every(Boolean);
    return reply
      .code(ok ? 200 : 503)
      .send({ ok, service: "vaada-backend", checks: readinessChecks });
  });
  app.get("/v1/promises", async () => ({
    commitments: await listCommitments(),
  }));
  app.get("/v1/promises/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const [commitment, pendingCompletionProofs] = await Promise.all([
      getCommitment(slug),
      getPendingCompletionProofCount(slug),
    ]);
    return commitment
      ? { commitment: { ...commitment, pendingCompletionProofs } }
      : reply.code(404).send({ error: "Promise record not found." });
  });

  app.get("/v1/promises/:slug/proofs", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const supabase = publicSupabase();
    if (!supabase)
      return reply.code(503).send({ error: "Database unavailable." });

    // Get commitment by slug (must be published)
    const { data: commitment, error: commitmentError } = await supabase
      .from("commitments")
      .select("id")
      .eq("slug", slug)
      .not("published_at", "is", null)
      .maybeSingle();

    if (commitmentError || !commitment)
      return reply.code(404).send({ error: "Promise not found." });

    // Get verified proofs for this commitment
    const { data: proofs, error: proofsError } = await supabase
      .from("evidence")
      .select(
        "id,kind,title,source_kind,source_url,media_asset_id,storage_path,media_type,verdict,document_date,reviewed_at,original_filename,size_bytes",
      )
      .eq("commitment_id", commitment.id)
      .in("verdict", ["verified", "contested"])
      .order("document_date", { ascending: false });

    if (proofsError)
      return reply.code(500).send({ error: "Failed to fetch proofs." });

    // Generate signed URLs for media
    const serviceClient = serviceSupabase();
    const proofsWithUrls = await Promise.all(
      (proofs || []).map(async (proof) => {
        if (!proof.storage_path) return proof;

        const { data: signed } = serviceClient
          ? await serviceClient.storage
              .from("proof-media")
              .createSignedUrl(proof.storage_path, 7200)
          : { data: null };

        return {
          ...proof,
          mediaUrl: signed?.signedUrl ?? null,
        };
      }),
    );

    return { proofs: proofsWithUrls };
  });

  app.get("/v1/me/profile", async (request, reply) => {
    const auth = await permanentUserFrom(request);
    if (!auth)
      return reply
        .code(401)
        .send({ error: "Log in to view account settings." });
    const client = publicSupabase(auth.token)!;
    const { data, error } = await client
      .from("profiles")
      .select(
        "role,display_name,contributor_type,default_submit_anonymously,preferences_configured_at,updated_at",
      )
      .eq("id", auth.user.id)
      .maybeSingle();
    if (error) {
      if (config.logLevel) {
        console.error("Profile fetch error:", error);
      }
      return reply
        .code(503)
        .send({ error: `Account settings fetch failed: ${error.message}` });
    }
    if (!data) {
      if (config.logLevel) {
        console.warn("Profile not found for user:", auth.user.id);
      }
      return reply
        .code(404)
        .send({ error: "Profile not found. Please complete account setup." });
    }
    return {
      profile: {
        email: auth.user.email ?? "",
        authenticationProvider:
          auth.user.app_metadata?.provider === "google" ? "google" : "email",
        role: data.role,
        displayName: data.display_name ?? "",
        contributorType: data.contributor_type,
        defaultSubmitAnonymously: data.default_submit_anonymously,
        preferencesConfiguredAt: data.preferences_configured_at,
        updatedAt: data.updated_at,
      },
    };
  });
  app.patch("/v1/me/profile", async (request, reply) => {
    const auth = await permanentUserFrom(request);
    if (!auth)
      return reply
        .code(401)
        .send({ error: "Log in to update account settings." });
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: parsed.error.issues[0]?.message ?? "Check the account settings.",
      });
    const client = publicSupabase(auth.token)!;
    const { data, error } = await client.rpc("update_my_profile", {
      p_display_name: parsed.data.displayName,
      p_contributor_type: parsed.data.contributorType,
      p_default_submit_anonymously: parsed.data.defaultSubmitAnonymously,
    });
    if (error)
      return reply
        .code(400)
        .send({ error: "We could not save your account settings." });
    const row = Array.isArray(data) ? data[0] : data;
    if (!row)
      return reply
        .code(503)
        .send({ error: "Account settings are temporarily unavailable." });
    return {
      profile: {
        email: auth.user.email ?? "",
        authenticationProvider:
          auth.user.app_metadata?.provider === "google" ? "google" : "email",
        role: row.role,
        displayName: row.display_name ?? "",
        contributorType: row.contributor_type,
        defaultSubmitAnonymously: row.default_submit_anonymously,
        preferencesConfiguredAt: row.preferences_configured_at,
        updatedAt: row.updated_at,
      },
    };
  });

  app.post(
    "/v1/extract",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const auth = await permanentUserFrom(request);
      if (!auth)
        return reply
          .code(401)
          .send({ error: "Log in before using assisted extraction." });
      const { fields, file } = await multipartInput(request);
      const sourceUrl = (fields.sourceUrl ?? "").trim();
      const rawText = (fields.rawText ?? "").trim();
      if (!sourceUrl && !rawText && !file)
        return reply
          .code(400)
          .send({ error: "Add a source URL, pasted text, or an image/PDF." });
      if (sourceUrl && !z.string().url().safeParse(sourceUrl).success)
        return reply
          .code(400)
          .send({ error: "Add a valid public source URL." });
      if (
        file &&
        (!allowedMime.has(file.mimeType) || !matchesDeclaredType(file))
      )
        return reply.code(415).send({
          error: "The file contents must be a genuine JPEG, PNG, WebP or PDF.",
        });
      let sourceText = rawText;
      if (!sourceText && sourceUrl) {
        try {
          sourceText = await fetchPublicSourceText(sourceUrl);
        } catch (error) {
          if (!file)
            return reply.code(422).send({
              error:
                error instanceof Error
                  ? error.message
                  : "Could not read the source.",
            });
        }
      }
      try {
        const result = await extractWithAgent({
          sourceUrl,
          rawText: sourceText,
          file,
        });
        return {
          ...result,
          notice:
            "Extracted fields are suggestions. Review the original source before submission.",
        };
      } catch (error) {
        return reply.code(422).send({
          error: error instanceof Error ? error.message : "Extraction failed.",
        });
      }
    },
  );

  app.post(
    "/v1/uploads/proof",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const auth = await permanentUserFrom(request);
      if (!auth)
        return reply.code(401).send({
          error: "Log in with Google or email before uploading evidence.",
        });
      const { fields, file } = await multipartInput(request);
      if (!file)
        return reply
          .code(400)
          .send({ error: "Choose an image or PDF. No file was received." });
      if (!file.mimeType)
        return reply.code(400).send({ error: "File mime type is missing." });
      if (!allowedMime.has(file.mimeType) || !matchesDeclaredType(file))
        return reply.code(415).send({
          error: "The file contents must be a genuine JPEG, PNG, WebP or PDF.",
        });
      const kindValue = (fields.kind ?? "").trim().toLowerCase();
      if (!kindValue)
        return reply.code(400).send({
          error: 'Specify proof kind: "promise_source" or "completion_proof".',
        });
      const kind = z
        .enum(["promise_source", "completion_proof"])
        .safeParse(kindValue);
      if (!kind.success)
        return reply.code(400).send({
          error: `Invalid proof kind "${kindValue}". Use "promise_source" or "completion_proof".`,
        });
      const extension: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "application/pdf": "pdf",
      };
      const assetId = randomUUID();
      const year = new Date().getUTCFullYear();
      const storagePath = `${auth.user.id}/${kind.data}/${year}/${assetId}.${extension[file.mimeType]}`;
      const sha256 = createHash("sha256").update(file.buffer).digest("hex");
      const uploaded = await auth.service.storage
        .from("proof-media")
        .upload(storagePath, file.buffer, {
          contentType: file.mimeType,
          upsert: false,
          metadata: { sha256, ownerId: auth.user.id, kind: kind.data },
        });
      if (uploaded.error)
        return reply
          .code(400)
          .send({ error: `Storage upload failed: ${uploaded.error.message}` });

      // Use public client with user JWT for RLS-compliant insert
      const publicClient = publicSupabase(auth.token);
      if (!publicClient)
        return reply.code(503).send({ error: "Database client unavailable." });

      const { data: asset, error } = await publicClient
        .from("media_assets")
        .insert({
          id: assetId,
          owner_id: auth.user.id,
          bucket_id: "proof-media",
          storage_path: storagePath,
          kind: kind.data,
          original_filename: file.name.slice(0, 255),
          mime_type: file.mimeType,
          size_bytes: file.buffer.length,
          sha256,
          status: "pending",
        })
        .select("id,kind,original_filename,mime_type,size_bytes,sha256,status")
        .single();
      if (error) {
        await auth.service.storage.from("proof-media").remove([storagePath]);
        return reply
          .code(400)
          .send({ error: `Database error: ${error.message}` });
      }
      return reply.code(201).send({
        asset: {
          id: asset.id,
          kind: asset.kind,
          originalName: asset.original_filename,
          mimeType: asset.mime_type,
          sizeBytes: asset.size_bytes,
          sha256: asset.sha256,
          status: asset.status,
        },
      });
    },
  );

  app.post("/v1/submissions", async (request, reply) => {
    const parsed = submissionSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: parsed.error.issues[0]?.message ?? "Check the required fields.",
      });
    const auth = await permanentUserFrom(request);
    if (!auth)
      return reply
        .code(401)
        .send({ error: "Log in with Google or email before submitting." });
    const supabase = publicSupabase(auth.token)!;
    const value = parsed.data;
    let target: Record<string, unknown> | null = null;
    if (value.submissionKind === "proof") {
      const result = await supabase
        .from("commitments")
        .select(
          "id,slug,title,detail,state,district,category,accountable_office,status",
        )
        .eq("slug", value.targetCommitmentSlug)
        .maybeSingle();
      if (result.error || !result.data)
        return reply
          .code(404)
          .send({ error: "That promise record could not be found." });
      target = result.data as Record<string, unknown>;
      if (target.status === "fulfilled")
        return reply
          .code(409)
          .send({ error: "This promise is already recorded as completed." });
      if (value.sourceUrl && !value.mediaAssetId) {
        let sourceText = "";
        try {
          sourceText = await fetchPublicSourceText(value.sourceUrl);
        } catch {
          return reply.code(422).send({
            error:
              "We could not read that proof link. Upload an image or PDF instead.",
          });
        }
        const assessment = assessCompletionSource(
          {
            title: String(target.title),
            detail: String(target.detail),
            state: String(target.state),
            district: String(target.district ?? ""),
            accountableOffice: String(target.accountable_office ?? ""),
          },
          sourceText,
        );
        if (!assessment.relevant)
          return reply.code(422).send({
            error:
              "This link does not clearly match the selected promise and a completion update. Check the link or upload proof for human review.",
          });
      }
    }
    if (value.mediaAssetId) {
      const { data: asset } = await auth.service
        .from("media_assets")
        .select("id,owner_id,kind,status")
        .eq("id", value.mediaAssetId)
        .eq("owner_id", auth.user.id)
        .maybeSingle();
      const expected =
        value.submissionKind === "proof"
          ? "completion_proof"
          : "promise_source";
      if (!asset || asset.status !== "pending" || asset.kind !== expected)
        return reply.code(400).send({
          error:
            "That upload is unavailable, already attached, or belongs to another account.",
        });
    }
    const { data, error } = await supabase
      .from("submissions")
      .insert({
        submission_kind: value.submissionKind,
        target_commitment_id: target?.id ?? null,
        title: value.title,
        promise_text: value.promiseText,
        source_url: value.sourceUrl || null,
        media_asset_id: value.mediaAssetId ?? null,
        promised_on: value.promisedOn || null,
        deadline_start:
          value.submissionKind === "promise"
            ? value.deadlineStart || null
            : null,
        deadline:
          value.submissionKind === "promise" ? value.deadlineEnd || null : null,
        deadline_label:
          value.submissionKind === "promise"
            ? value.deadlineLabel || null
            : null,
        state: String(target?.state ?? value.state),
        district: String(target?.district ?? value.district) || null,
        category: String(target?.category ?? value.category),
        accountable_office:
          String(target?.accountable_office ?? value.accountableOffice) || null,
        submitter_name: value.submitAnonymously
          ? null
          : value.submitterName || null,
        submitter_email: value.submitAnonymously
          ? null
          : value.submitterEmail || null,
        submit_anonymously: value.submitAnonymously,
        raw_text: value.rawText || null,
        ai_confidence: value.confidence,
        ai_warnings: value.warnings,
        status: "queued",
      })
      .select("id,status,created_at")
      .single();
    return error
      ? reply.code(400).send({ error: "We could not save this submission." })
      : reply.code(201).send({ submission: data });
  });

  app.get("/v1/me/submissions", async (request, reply) => {
    const auth = await permanentUserFrom(request);
    if (!auth)
      return reply.code(401).send({
        error: "Log in with Google or email to view private receipts.",
      });
    const supabase = publicSupabase(auth.token)!;
    const { data, error } = await supabase
      .from("submissions")
      .select("id,title,state,status,created_at,review_note")
      .order("created_at", { ascending: false });
    return error
      ? reply.code(400).send({ error: error.message })
      : { submissions: data ?? [] };
  });

  app.get("/v1/review/submissions", async (request, reply) => {
    const auth = await reviewerFrom(request);
    if (!auth)
      return reply.code(403).send({ error: "Reviewer access required." });
    const promise = (request.query as { promise?: string }).promise;
    let query = auth.service
      .from("submissions")
      .select(
        "*,target_commitment:commitments!submissions_target_commitment_id_fkey(id,slug,title,status,progress)",
      )
      .eq("status", "queued");
    if (promise) {
      const { data: target } = await auth.service
        .from("commitments")
        .select("id")
        .eq("slug", promise)
        .maybeSingle();
      if (target) query = query.eq("target_commitment_id", target.id);
    }
    const { data, error } = await query.order("created_at", {
      ascending: true,
    });
    if (error) return reply.code(400).send({ error: error.message });
    const submissions = await Promise.all(
      (data ?? []).map(async (item) => {
        if (!item.proof_path) return item;
        const { data: signed } = await auth.service.storage
          .from("proof-media")
          .createSignedUrl(item.proof_path, 300);
        return { ...item, proof_url: signed?.signedUrl ?? null };
      }),
    );
    return { submissions };
  });
  app.post("/v1/review/submissions", async (request, reply) => {
    const auth = await reviewerFrom(request);
    if (!auth)
      return reply.code(403).send({ error: "Reviewer access required." });
    const parsed = decisionSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Decision and note are required." });
    const client = publicSupabase(auth.token)!;
    const { data, error } = await client.rpc("review_submission", {
      p_submission_id: parsed.data.submissionId,
      p_decision: parsed.data.decision,
      p_note: parsed.data.note,
      p_progress_after: parsed.data.progressAfter ?? null,
      p_mark_completed: parsed.data.markCompleted,
    });
    return error
      ? reply.code(400).send({ error: error.message })
      : { result: data };
  });

  app.get("/v1/evidence/:id/file", async (request, reply) => {
    const service = serviceSupabase();
    if (!service)
      return reply
        .code(503)
        .send({ error: "Verified proof storage is not configured." });
    const { id } = request.params as { id: string };
    const { data, error } = await service
      .from("evidence")
      .select("storage_path,verdict,commitment:commitments!inner(published_at)")
      .eq("id", id)
      .maybeSingle();
    const commitment = Array.isArray(data?.commitment)
      ? data.commitment[0]
      : data?.commitment;
    if (
      error ||
      !data?.storage_path ||
      data.verdict !== "verified" ||
      !commitment?.published_at
    )
      return reply.code(404).send({ error: "Verified proof was not found." });
    const { data: signed } = await service.storage
      .from("proof-media")
      .createSignedUrl(data.storage_path, 60);
    return signed?.signedUrl
      ? reply.redirect(signed.signedUrl)
      : reply
          .code(503)
          .send({ error: "Proof file is temporarily unavailable." });
  });

  app.post("/v1/agents/ingest", async (request, reply) => {
    if (
      !config.cronSecret ||
      request.headers["x-cron-secret"] !== config.cronSecret
    )
      return reply.code(401).send({ error: "Agent authorization required." });
    const service = serviceSupabase();
    if (!service)
      return reply
        .code(503)
        .send({ error: "Candidate storage is not configured." });
    const parsed = z
      .object({ sourceUrls: z.array(z.string().url()).min(1).max(20) })
      .safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "Provide 1–20 public source URLs." });
    const results = [];
    for (const sourceUrl of parsed.data.sourceUrls) {
      try {
        const rawText = await fetchPublicSourceText(sourceUrl);
        const { draft, mode } = await extractWithAgent({ sourceUrl, rawText });
        const { data, error } = await service
          .from("ingest_candidates")
          .upsert(
            {
              source_url: sourceUrl,
              source_text: rawText,
              extracted_draft: draft,
              extraction_mode: mode,
              status: "candidate",
            },
            { onConflict: "source_url" },
          )
          .select("id,status")
          .single();
        results.push(
          error
            ? { sourceUrl, error: error.message }
            : { sourceUrl, candidate: data },
        );
      } catch (error) {
        results.push({
          sourceUrl,
          error: error instanceof Error ? error.message : "Agent failed.",
        });
      }
    }
    return {
      results,
      publication: "none",
      notice: "Candidates remain private until human review.",
    };
  });
  return app;
}
