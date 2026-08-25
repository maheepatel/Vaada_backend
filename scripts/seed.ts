import { createClient } from "@supabase/supabase-js";
import { commitments } from "../src/seed.js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before seeding.");

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

for (const item of commitments) {
  const { data: commitment, error } = await supabase.from("commitments").upsert({
    slug: item.slug, title: item.title, detail: item.detail, state: item.state, state_slug: item.stateSlug,
    district: item.district, district_slug: item.districtSlug, locality: item.locality ?? null,
    category: item.category, status: item.status, promised_on: item.promisedOn, deadline: item.deadline,
    deadline_label: item.deadlineLabel, progress: item.progress, beneficiaries: item.beneficiaries,
    accountable_office: item.accountableOffice, accountable_person: item.accountablePerson ?? null,
    published_at: new Date().toISOString(), updated_at: new Date(`${item.lastReviewedAt}T00:00:00Z`).toISOString(),
  }, { onConflict: "slug" }).select("id").single();
  if (error || !commitment) throw error ?? new Error(`Could not seed ${item.slug}`);

  await supabase.from("evidence").delete().eq("commitment_id", commitment.id);
  await supabase.from("timeline_events").delete().eq("commitment_id", commitment.id);
  if (item.evidence.length) {
    const { error: evidenceError } = await supabase.from("evidence").insert(item.evidence.map((entry) => ({
      commitment_id: commitment.id, kind: entry.kind, title: entry.title, source_kind: entry.sourceKind,
      source_url: entry.sourceUrl, quote: entry.quote ?? null, direction: entry.direction ?? null,
      verdict: entry.verdict, document_date: entry.documentDate, reviewed_at: entry.reviewedAt ?? null,
    })));
    if (evidenceError) throw evidenceError;
  }
  if (item.timeline.length) {
    const { error: timelineError } = await supabase.from("timeline_events").insert(item.timeline.map((entry) => ({
      commitment_id: commitment.id, event_date: entry.date, title: entry.title, detail: entry.detail, event_type: entry.type,
    })));
    if (timelineError) throw timelineError;
  }
}

console.log(`Seeded ${commitments.length} source-backed promise records.`);
