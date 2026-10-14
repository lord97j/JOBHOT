// The harness the site's ATS adapters run on. It runs inside the worker that called it (the module's
// schedule is executed by apps/worker/src/schedules.ts — no process, scheduler or browser of its own),
// reads one page per source per run, and stores what it finds through the engine's single material
// entrance and processing queue. It never writes articles, analyses or publications itself.
import { upsertMaterial } from "@aihot/backend/content/materials";
import { sql } from "@aihot/backend/db";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { shutdownSignal } from "@aihot/backend/jobs/queue";
import { stripTagMarkup, truncate } from "@aihot/backend/lib/text";
import { identityKeyForUrl } from "@aihot/backend/lib/url";
import { fetchListing } from "@aihot/backend/sources/listing-fetch";
import { FetchError } from "@aihot/backend/sources/types";

/** How an adapter reaches its interface; a test supplies its own, so the tests never leave the machine. */
export interface RequestJson {
  (url: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<unknown>;
}

/** One job as its source lists it, before identity and the timeline rule. */
export interface JobPosting {
  url: string;
  title: string;
  publishedAt: Date | null;
  /** The job's own description as plain text; empty when this source's listing does not carry one. */
  body: string;
  raw: Record<string, unknown>;
}

/** What one run read: the page's postings, and what the interface says it holds in total. */
export interface JobPage {
  postings: JobPosting[];
  total: number | null;
}

/** How an adapter's first page relates to "newest", measured against the live interface (see each adapter). */
export type PageOrder = "newest-first" | "unverified";

export interface JobAdapter {
  sourceId: string;
  order: PageOrder;
  /** The source's newest page. One request, or a fixed set of them for the page's jobs; never a second page. */
  list(request: RequestJson): Promise<JobPage>;
  /** Fills the body of a posting `list` left empty, with the source's own per-job request. */
  body?(posting: JobPosting, request: RequestJson): Promise<string>;
}

/** The accepted window: one page, at most a hundred jobs (the operator's decision; no pagination). */
export const MAX_PER_RUN = 100;
/** How much of the description the site's summary shows. */
const EXCERPT_CHARS = 300;

export interface SourceRun {
  sourceId: string;
  status: "ok" | "skipped" | "failed";
  /** Why a run was skipped or failed: "missing", "paused", "not-due", or the interface's own error. */
  reason?: string;
  /** What the interface returned. */
  received: number;
  /** Distinct jobs of this run's window. */
  accepted: number;
  /** The interface holds more than this run's window; an approved limit, not a source failure. */
  truncated: boolean;
  orderExpected: PageOrder;
  /** Whether this page really came back newest first. */
  orderConfirmed: boolean;
  created: number;
  revised: number;
  /** Jobs left without a description this run; the next run within the window completes them. */
  bodyPending: number;
  bodyFailures: number;
  /** The first five per-job requests that failed, with the job they belong to (the rest are counted above). */
  bodyErrors: string[];
}

interface CollectorState {
  initializedAt?: string;
  lastRunAt: string;
  lastError?: string;
  lastWindow?: Record<string, unknown>;
}

type Cursor = Record<string, unknown> & { jobCollector?: CollectorState };

/** A JSON interface through the engine's guarded fetch: SSRF checks, one deadline, a retry for transient failures. */
export async function requestJson(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<unknown> {
  const res = await fetchListing(url, { method: opts.method, headers: { accept: "application/json", ...opts.headers }, body: opts.body });
  if (res.status < 200 || res.status >= 300) throw new FetchError(`HTTP ${res.status} from ${url}`, res.status);
  return JSON.parse(res.text());
}

/**
 * A source's own rendering → plain text: blocks keep their line, runs of spaces collapse. Adapters use
 * it for a description that arrives as HTML (Moka) and for one that arrives as text (汽车之家).
 */
export function plainText(markup: string): string {
  return stripTagMarkup(markup.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, "\n"))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .split("\n").map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim()).filter(Boolean).join("\n");
}

/** A date the source gave us, or null: an interface's stray value must not invent a publication time. */
export function dateValue(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

const reason = (error: unknown) => String(error instanceof Error ? error.message : error).slice(0, 300);

/** Whether the page really came back newest first; a posting without a date neither proves nor breaks it. */
function newestFirst(postings: readonly JobPosting[]): boolean {
  const times = postings.map((p) => p.publishedAt?.getTime()).filter((t): t is number => t !== undefined);
  return times.every((t, i) => i === 0 || t <= times[i - 1]!);
}

/** The bodies already stored for these jobs, so a second run does not buy the same description twice. */
async function storedBodies(identityKeys: readonly string[]): Promise<Map<string, string>> {
  if (identityKeys.length === 0) return new Map();
  const rows = await sql<{ identity_key: string; body_status: string }[]>`
    SELECT identity_key, body_status FROM articles WHERE identity_key = ANY(${identityKeys as string[]}::text[])`;
  return new Map(rows.map((r) => [r.identity_key, r.body_status]));
}

/** The module's own namespace in the source's cursor: its window and when it last ran. */
async function saveState(sourceId: string, cursor: Cursor | null, jobCollector: CollectorState): Promise<void> {
  await sql`UPDATE sources SET cursor = ${sql.json({ ...(cursor ?? {}), jobCollector } as never)}, updated_at = now() WHERE id = ${sourceId}`;
}

/**
 * One run for one source: read its newest page, keep a job per identity, complete the bodies the listing
 * left out, store through the material entrance and queue what is new or changed. Runs inside the
 * caller's process; the source's interval decides when it runs again.
 */
export async function runCollection(adapter: JobAdapter, opts: { request?: RequestJson; now?: Date } = {}): Promise<SourceRun> {
  const request = opts.request ?? requestJson;
  const now = opts.now ?? new Date();
  const run: SourceRun = { sourceId: adapter.sourceId, status: "ok", received: 0, accepted: 0, truncated: false,
    orderExpected: adapter.order, orderConfirmed: false, created: 0, revised: 0, bodyPending: 0, bodyFailures: 0, bodyErrors: [] };

  const [source] = await sql<{ enabled: boolean; interval_minutes: number; cursor: Cursor | null }[]>`
    SELECT enabled, interval_minutes, cursor FROM sources WHERE id = ${adapter.sourceId}`;
  if (!source) return { ...run, status: "skipped", reason: "missing" };
  if (!source.enabled) return { ...run, status: "skipped", reason: "paused" };
  const state = source.cursor?.jobCollector;
  const last = Date.parse(String(state?.lastRunAt ?? ""));
  if (Number.isFinite(last) && now.getTime() - last < source.interval_minutes * 60_000) return { ...run, status: "skipped", reason: "not-due" };

  let page: JobPage;
  try {
    page = await adapter.list(request);
  } catch (error) {
    if (shutdownSignal.signal.aborted) throw error;
    const failure = reason(error);
    await saveState(adapter.sourceId, source.cursor, { ...state, lastRunAt: now.toISOString(), lastError: failure });
    return { ...run, status: "failed", reason: failure };
  }

  run.received = page.postings.length;
  const window = page.postings.slice(0, MAX_PER_RUN);
  run.truncated = page.postings.length > window.length || (page.total !== null && page.total > window.length);
  run.orderConfirmed = adapter.order === "newest-first" && newestFirst(window);

  // One identity per job. A URL the identity rule cannot read is not a job we can keep; the fragment
  // belongs to the identity (Moka serves one job per fragment of its board page).
  const jobs = new Map<string, { posting: JobPosting; identityKey: string }>();
  for (const posting of window) {
    const identityKey = identityKeyForUrl(posting.url, { keepFragment: true });
    if (identityKey && !jobs.has(identityKey)) jobs.set(identityKey, { posting, identityKey });
  }
  run.accepted = jobs.size;

  const firstWindow = !state?.initializedAt;
  const already = await storedBodies([...jobs.keys()]);
  for (const { posting, identityKey } of jobs.values()) {
    const storedBody = already.get(identityKey) === "ok";
    let body = posting.body;
    if (!body && !storedBody && adapter.body) {
      try {
        body = await adapter.body(posting, request);
      } catch (error) {
        // A shutdown is not a source's failure: the run is abandoned and retried as a whole.
        if (shutdownSignal.signal.aborted) throw error;
        run.bodyFailures += 1;
        if (run.bodyErrors.length < 5) run.bodyErrors.push(`${posting.url} — ${reason(error)}`);
      }
    }
    // A job whose description did not arrive is kept for a later run of the same window instead of being
    // stored under an empty body: the engine's extraction must never be pointed at an application form.
    if (!body && !storedBody) {
      run.bodyPending += 1;
      continue;
    }
    const stored = await upsertMaterial({
      sourceId: adapter.sourceId,
      url: posting.url,
      title: posting.title,
      identityKey,
      publishedAt: posting.publishedAt,
      excerpt: body ? truncate(body, EXCERPT_CHARS) : undefined,
      // Without a body this report refreshes the record only: no field is sent, so the stored body stays.
      bodyText: body || undefined,
      bodyStatus: body ? "ok" : undefined,
      raw: posting.raw,
      via: "job-collector",
      discoveredAt: now,
      backfill: firstWindow ? "first-import" : null,
    });
    if (stored.created) run.created += 1;
    if (stored.revised) run.revised += 1;
    if (stored.created || stored.revised || stored.processingNeeded) await queueProcessing(stored.articleId);
  }

  await saveState(adapter.sourceId, source.cursor, {
    // The first window is history: it is marked only once this run has processed it, so a run that failed
    // half way still reports the next one as the source's first import.
    initializedAt: state?.initializedAt ?? now.toISOString(),
    lastRunAt: now.toISOString(),
    lastWindow: { received: run.received, accepted: run.accepted, truncated: run.truncated, orderConfirmed: run.orderConfirmed,
      created: run.created, revised: run.revised, bodyPending: run.bodyPending, bodyFailures: run.bodyFailures },
  });
  return run;
}

/** The module's scheduled task: every source whose interval has passed, one after another. */
export async function collectDueJobs(adapters: readonly JobAdapter[], opts: { request?: RequestJson; now?: Date } = {}):
  Promise<{ skipped?: "collect-disabled"; sources: SourceRun[] }> {
  // The valve is read again here, not only when the worker started: a task queued before it was turned
  // off must not reach an interface.
  if (process.env.COLLECT_ENABLED !== "true") return { skipped: "collect-disabled", sources: [] };
  const sources: SourceRun[] = [];
  for (const adapter of adapters) sources.push(await runCollection(adapter, opts));
  // One company's outage is that company's: the run is marked failed only when nothing was collected.
  if (sources.length > 0 && sources.every((s) => s.status === "failed")) {
    throw new Error(`job collection: every source failed — ${JSON.stringify(sources)}`);
  }
  return { sources };
}
