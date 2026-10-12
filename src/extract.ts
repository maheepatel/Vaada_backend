import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { config } from "./config.js";
import type { ExtractedDraft } from "./types.js";

// OpenAI's strict Structured Outputs mode requires every object in the schema
// to enumerate a fixed set of properties with additionalProperties:false. A
// free-form z.record(...) has no fixed key set, so OpenAI rejects it with:
// "Object schema at `properties/confidence` must set `additionalProperties:
// false`". Enumerate the exact fields we score instead of using a dictionary.
const ConfidenceSchema = z
  .object({
    title: z.number().min(0).max(1),
    promiseText: z.number().min(0).max(1),
    promisedOn: z.number().min(0).max(1),
    deadlineStart: z.number().min(0).max(1),
    deadlineEnd: z.number().min(0).max(1),
    deadlineLabel: z.number().min(0).max(1),
    state: z.number().min(0).max(1),
    district: z.number().min(0).max(1),
    category: z.number().min(0).max(1),
    accountableOffice: z.number().min(0).max(1),
  })
  .strict();
const DraftSchema = z.object({
  title: z.string(),
  promiseText: z.string(),
  promisedOn: z.string(),
  deadlineStart: z.string(),
  deadlineEnd: z.string(),
  deadlineLabel: z.string(),
  state: z.string(),
  district: z.string(),
  category: z.string(),
  accountableOffice: z.string(),
  confidence: ConfidenceSchema,
  warnings: z.array(z.string()),
});
const states = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];
const categories: Record<string, string[]> = {
  Education: ["school", "student", "classroom", "college", "teacher"],
  Water: ["water", "pipeline", "tap", "irrigation"],
  Health: ["hospital", "clinic", "health", "bed", "doctor"],
  Infrastructure: ["road", "bridge", "rail", "highway", "building"],
  Jobs: ["job", "employment", "apprentice", "skill"],
  Transport: ["bus", "metro", "transport", "railway", "airport"],
  Agriculture: ["farmer", "agriculture", "crop", "mandi"],
  Housing: ["housing", "homes", "houses", "resettlement"],
};
const months = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return "";
  return date.toISOString().slice(0, 10);
}

// The form's <input type="date"> and the submission schema both need
// YYYY-MM-DD, but a model reading a press release returns "12 March 2025".
// Convert deterministically here instead of trusting the model's formatting.
// Returns "" when the value is not a single unambiguous calendar date.
export function normalizeDate(value: string) {
  const text = value.trim().replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return isoDate(+match[1], +match[2], +match[3]);
  match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (match) return isoDate(+match[3], +match[2], +match[1]); // Indian DD/MM/YYYY
  match = text.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
  if (match) {
    const month = months.findIndex((name) =>
      name.startsWith(match![2].toLowerCase().slice(0, 3)),
    );
    return month < 0 ? "" : isoDate(+match[3], month + 1, +match[1]);
  }
  match = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (match) {
    const month = months.findIndex((name) =>
      name.startsWith(match![1].toLowerCase().slice(0, 3)),
    );
    return month < 0 ? "" : isoDate(+match[3], month + 1, +match[2]);
  }
  return "";
}

export function normalizeDraft(draft: ExtractedDraft): ExtractedDraft {
  const warnings = [...draft.warnings];
  const promisedOn = normalizeDate(draft.promisedOn);
  let deadlineStart = normalizeDate(draft.deadlineStart);
  const deadlineEnd = normalizeDate(draft.deadlineEnd);
  if (draft.promisedOn && !promisedOn)
    warnings.push(
      `Promise date "${draft.promisedOn}" could not be read as one exact date. Please enter it.`,
    );
  if (deadlineStart && deadlineEnd && deadlineStart > deadlineEnd) {
    warnings.push("The stated completion window was reversed and was cleared.");
    deadlineStart = "";
  }
  const stateName = states.find(
    (name) => name.toLowerCase() === draft.state.trim().toLowerCase(),
  );
  const label = draft.deadlineLabel.trim();
  return {
    ...draft,
    promisedOn,
    deadlineStart,
    deadlineEnd,
    // A bare connective such as "by" is not a timeframe.
    deadlineLabel: /^(by|before|within|in|on|till|until)\.?$/i.test(label)
      ? ""
      : label,
    state: stateName ?? draft.state.trim(),
    district: draft.district.replace(/\s+district$/i, "").trim(),
    warnings,
  };
}

const privateHost =
  /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i;

function publicHttpsUrl(value: string, base?: URL) {
  const url = new URL(value, base);
  if (url.protocol !== "https:" || privateHost.test(url.hostname))
    throw new Error("Only public HTTPS sources can be read.");
  return url;
}
export async function fetchPublicSourceText(value: string) {
  let url = publicHttpsUrl(value);
  let response: Response | undefined;
  for (let hop = 0; hop < 4; hop++) {
    response = await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": "VaadaSourceReviewer/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    if (!location) throw new Error("The source redirect was incomplete.");
    url = publicHttpsUrl(location, url);
  }
  if (!response || (response.status >= 300 && response.status < 400))
    throw new Error("The source redirected too many times.");
  if (!response.ok)
    throw new Error(
      `Source returned ${response.status}. Upload a screenshot or paste the text instead.`,
    );
  const contentType = response.headers.get("content-type") ?? "";
  if (!/(text|json|xml|html)/i.test(contentType))
    throw new Error(
      "This source is not readable text. Upload the document instead.",
    );
  const text = (await response.text()).slice(0, 200000);
  return text
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30000);
}

export function heuristic(sourceUrl: string, rawText: string): ExtractedDraft {
  const clean = rawText.replace(/\s+/g, " ").trim();
  const lower = clean.toLowerCase();
  const state = states.find((name) => lower.includes(name.toLowerCase())) ?? "";
  const category =
    Object.entries(categories).find(([, words]) =>
      words.some((word) => lower.includes(word)),
    )?.[0] ?? "Governance";
  const date =
    clean.match(
      /\b(20\d{2}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]+\s+20\d{2})\b/,
    )?.[1] ?? "";
  const deadline =
    clean.match(/(?:by|before|within)\s+([^.;]{3,60})/i)?.[0] ?? "";
  const office =
    clean.match(
      /\b((?:Department|Ministry|Directorate|Municipal Corporation|Office)\s+of\s+[A-Z][A-Za-z& ,'-]{2,100})/,
    )?.[1] ?? "";
  return {
    title:
      clean.split(/[.!?]/)[0]?.slice(0, 140) ||
      "Public promise awaiting a clear title",
    promiseText: clean,
    sourceUrl,
    promisedOn: normalizeDate(date),
    deadlineStart: "",
    deadlineEnd: "",
    deadlineLabel: deadline,
    state,
    district: "",
    category,
    accountableOffice: office,
    // Same keys as the AI path so the form can rely on one shape.
    confidence: {
      title: clean ? 0.82 : 0.2,
      promiseText: clean ? 0.6 : 0.1,
      promisedOn: normalizeDate(date) ? 0.76 : 0.12,
      deadlineStart: 0,
      deadlineEnd: 0,
      deadlineLabel: deadline ? 0.72 : 0.12,
      state: state ? 0.86 : 0.18,
      district: 0,
      category: 0.68,
      accountableOffice: office ? 0.72 : 0.12,
    },
    warnings: [
      ...(!state ? ["State was not clear in the supplied source."] : []),
      ...(!date ? ["Promise date needs confirmation."] : []),
      ...(!deadline
        ? ["No stated deadline was detected. Do not invent one."]
        : []),
    ],
  };
}

export async function extractWithAgent(input: {
  sourceUrl: string;
  rawText: string;
  file?: { buffer: Buffer; mimeType: string; name: string };
}): Promise<{ draft: ExtractedDraft; mode: "ai" | "heuristic" }> {
  if (!config.openaiKey) {
    if (input.file && !input.rawText)
      throw new Error("Image/PDF reading needs OPENAI_API_KEY.");
    return {
      draft: heuristic(input.sourceUrl, input.rawText),
      mode: "heuristic",
    };
  }
  const base64Content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `Extract one concrete public promise from the supplied source. Preserve exact facts. Use empty strings for absent facts. Never infer truth or completion.
Formatting rules:
- promisedOn, deadlineStart and deadlineEnd must be ISO dates (YYYY-MM-DD), or "" if the source does not state one exact date. Convert "12 March 2025" to "2025-03-12". Never guess a missing day or month.
- deadlineEnd is the latest stated completion date; deadlineStart only if the source states an earliest date.
- deadlineLabel is the exact timeframe wording from the source (for example "by 31 December 2025" or "within 24 to 72 hours"), or "".
- state is the Indian state or union territory name only; district is the district name without the word "district".
- promiseText is the promise as worded in the source, not a paraphrase.
Source URL: ${input.sourceUrl || "none"}\n\nSource text:\n${input.rawText || "Inspect the attached file."}`,
    },
  ];
  if (input.file) {
    const base64 = input.file.buffer.toString("base64");
    if (input.file.mimeType.startsWith("image/")) {
      base64Content.push({
        type: "image_url",
        image_url: {
          url: `data:${input.file.mimeType};base64,${base64}`,
          detail: "high",
        },
      });
    } else if (input.file.mimeType === "application/pdf") {
      // Previously PDFs were accepted by the upload check but silently never
      // sent to the model, so a PDF-only extraction came back empty.
      base64Content.push({
        type: "file",
        file: {
          filename: input.file.name.replace(/[^\w.-]+/g, "_") || "source.pdf",
          file_data: `data:application/pdf;base64,${base64}`,
        },
      });
    }
  }
  const client = new OpenAI({ apiKey: config.openaiKey });
  let response;
  try {
    const responseFormat = zodResponseFormat(
      DraftSchema,
      "vaada_promise_draft",
    );
    const response_: any = await client.chat.completions.parse({
      model: config.openaiModel,
      messages: [
        {
          role: "user" as const,
          content: base64Content as unknown as any,
        },
      ],
      response_format: responseFormat,
    });
    response = response_;
  } catch (error) {
    if (error instanceof Error)
      throw new Error(`OpenAI extraction failed: ${error.message}`);
    throw error;
  }
  const parsed = response.choices[0]?.message.parsed;
  if (!parsed)
    throw new Error("The extraction agent could not create a safe draft.");
  return {
    draft: normalizeDraft({ ...parsed, sourceUrl: input.sourceUrl }),
    mode: "ai",
  };
}
