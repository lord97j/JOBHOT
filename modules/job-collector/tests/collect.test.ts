// The harness around the site's ATS adapters: what one run reads, what it stores through the engine's
// own material entrance, and what it refuses to do — a second page, a body from a page it did not fetch,
// a request with the collection valve off. The adapters' own request shapes get their own files; the
// adapter here is a stub, so these rules are tested without a network.
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { identityKeyForUrl } from "@aihot/backend/lib/url";
import { collectDueJobs, dateValue, MAX_PER_RUN, plainText, requestJson, runCollection, type JobAdapter, type JobPosting, type RequestJson } from "../collect.ts";

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// A fixed clock: the timeline rules compare against the run's time, so the tests own it instead of
// depending on the day they happen to run.
const NOW = new Date("2026-10-14T04:00:00Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

after(async () => { await stopBoss(); await closeDb(); });

async function source(id: string, opts: { enabled?: boolean; intervalMinutes?: number } = {}) {
  await sql`INSERT INTO sources(id,name,kind,tier,participation_mode,interval_minutes,enabled,cursor)
    VALUES(${id}, ${id}, 'external', 'T1', 'editorial', ${opts.intervalMinutes ?? 60}, ${opts.enabled ?? true}, '{}')`;
  return id;
}

/** The stub adapter: a page of postings, and the requests the run made to read it. */
function stub(page: () => Promise<{ postings: JobPosting[]; total: number | null }>, opts: { sourceId: string; order?: JobAdapter["order"]; body?: JobAdapter["body"] }) {
  const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
  const request: RequestJson = async (url, o) => {
    calls.push({ url, method: o?.method ?? "GET", body: o?.body });
    return page();
  };
  const adapter: JobAdapter = { sourceId: opts.sourceId, order: opts.order ?? "unverified", list: async () => page(), body: opts.body };
  return { adapter, calls, request };
}

const posting = (over: Partial<JobPosting> & { url: string; title: string }): JobPosting =>
  ({ publishedAt: new Date(NOW.getTime() - 3600_000), body: "职责：写招聘站。", raw: {}, ...over });

test("one article per job, although the jobs share one page", async () => {
  const id = await source(`harness-${unique()}`);
  const urls = ["aaa", "bbb"].map((f) => `https://app.mokahr.com/social-recruitment/zhihu/78336#/job/${f}`);
  const { adapter: a, request } = stub(async () => ({ postings: urls.map((url, i) => posting({ url, title: `岗位 ${i}` })), total: null }), { sourceId: id });

  const run = await runCollection(a, { request, now: at(0) });
  assert.equal(run.status, "ok");
  assert.equal(run.created, 2, "the fragment is part of the job's identity");
  const rows = await sql<{ identity_key: string; url: string }[]>`SELECT identity_key, url FROM articles WHERE source_id=${id}`;
  const expected = urls.map((url) => identityKeyForUrl(url, { keepFragment: true })!);
  assert.deepEqual(rows.map((r) => r.identity_key).sort(), expected.sort());
  assert.equal(new Set(rows.map((r) => r.identity_key)).size, 2, "without the fragment both jobs would collapse into one");
  assert.ok(rows.every((r) => r.url.includes("#/job/")), "the original link keeps the fragment");
});

test("the same page again creates nothing, and the body it stored is queued for the engine", async () => {
  const id = await source(`harness-${unique()}`);
  const { adapter: a, request } = stub(async () => ({ postings: [posting({ url: "https://boards.example.com/jobs/1", title: "后端工程师", body: "职责：\n1. 写服务" })], total: null }), { sourceId: id });

  const first = await runCollection(a, { request, now: at(0) });
  assert.equal(first.created, 1);
  const [stored] = await sql<{ id: string; body_status: string; body_text: string; processing_queued_at: Date | null; backfill: boolean; backfill_reason: string }[]>`
    SELECT id, body_status, body_text, processing_queued_at, backfill, backfill_reason FROM articles WHERE source_id=${id}`;
  assert.equal(stored!.body_status, "ok", "the listing carried the job's own description");
  assert.match(stored!.body_text, /写服务/);
  assert.ok(stored!.processing_queued_at, "confirmed material goes to the engine's processing queue");
  assert.equal(stored!.backfill, true, "a source's first window is history, like any first import");
  assert.equal(stored!.backfill_reason, "first-import");

  const second = await runCollection(a, { request, now: at(61) });
  assert.equal(second.status, "ok");
  assert.equal(second.created, 0);
  assert.equal(second.revised, 0, "an unchanged job is not a new revision");
  const rows = await sql<{ id: string }[]>`SELECT id FROM articles WHERE source_id=${id}`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.id, stored!.id);
});

test("a job the listing leaves without a body is kept for the next run, not stored empty", async () => {
  const id = await source(`harness-${unique()}`);
  let detail = false;
  const { adapter: a, request } = stub(async () => ({ postings: [posting({ url: "https://talent.example.com/apply?pid=7", title: "前端工程师", body: "" })], total: null }),
    { sourceId: id, body: async () => (detail ? "工作职责：负责前端。" : "") });

  const first = await runCollection(a, { request, now: at(0) });
  assert.equal(first.status, "ok");
  assert.equal(first.bodyPending, 1);
  assert.equal(first.created, 0, "no body yet, so nothing is stored under it");
  assert.equal((await sql`SELECT 1 FROM articles WHERE source_id=${id}`).length, 0);

  detail = true;
  const second = await runCollection(a, { request, now: at(61) });
  assert.equal(second.created, 1, "the next run completes it");
  const [row] = await sql<{ body_status: string }[]>`SELECT body_status FROM articles WHERE source_id=${id}`;
  assert.equal(row!.body_status, "ok");
});

test("a stored body is not fetched again, and a listing without one still refreshes the record", async () => {
  const id = await source(`harness-${unique()}`);
  let details = 0;
  const { adapter: a, request } = stub(async () => ({ postings: [posting({ url: "https://talent.example.com/apply?pid=9", title: "算法工程师", body: "" })], total: null }),
    { sourceId: id, body: async () => { details += 1; return "工作职责：训练模型。"; } });

  assert.equal((await runCollection(a, { request, now: at(0) })).created, 1);
  assert.equal((await runCollection(a, { request, now: at(61) })).status, "ok");
  assert.equal(details, 1, "the second run reuses the stored body");
  const [row] = await sql<{ body_status: string; body_text: string }[]>`SELECT body_status, body_text FROM articles WHERE source_id=${id}`;
  assert.equal(row!.body_status, "ok");
  assert.match(row!.body_text, /训练模型/, "re-reporting without a body must not blank the stored one");
});

test("a listing that fails records the failure and leaves the source alone", async () => {
  const id = await source(`harness-${unique()}`);
  const { adapter: a, request } = stub(async () => { throw new Error("HTTP 503"); }, { sourceId: id });

  const run = await runCollection(a, { request, now: at(0) });
  assert.equal(run.status, "failed");
  assert.match(run.reason!, /503/);
  const [row] = await sql<{ cursor: { jobCollector?: { lastError?: string; lastRunAt?: string } } }[]>`SELECT cursor FROM sources WHERE id=${id}`;
  assert.match(row!.cursor.jobCollector!.lastError!, /503/, "the operator sees it on the source");
  assert.ok(row!.cursor.jobCollector!.lastRunAt, "a failed run still counts as this source's run");
});

test("the source's interval gates the next run, and a paused source is left alone", async () => {
  const id = await source(`harness-${unique()}`, { intervalMinutes: 60 });
  let lists = 0;
  const { adapter: a, request } = stub(async () => { lists += 1; return { postings: [], total: null }; }, { sourceId: id });

  assert.equal((await runCollection(a, { request, now: at(0) })).status, "ok");
  assert.equal((await runCollection(a, { request, now: at(5) })).reason, "not-due");
  assert.equal(lists, 1, "a run inside the source's interval makes no request");
  assert.equal((await runCollection(a, { request, now: at(61) })).status, "ok");
  assert.equal(lists, 2);

  const paused = await source(`harness-${unique()}`, { enabled: false });
  const other = stub(async () => { throw new Error("must not be called"); }, { sourceId: paused });
  assert.equal((await runCollection(other.adapter, { request: other.request, now: at(0) })).reason, "paused");
});

test("collection off makes no request at all", async () => {
  const id = await source(`harness-${unique()}`);
  const { adapter: a, request } = stub(async () => { throw new Error("must not be called"); }, { sourceId: id });
  const before = process.env.COLLECT_ENABLED;
  process.env.COLLECT_ENABLED = "false";
  try {
    assert.deepEqual(await collectDueJobs([a], { request, now: at(0) }), { skipped: "collect-disabled", sources: [] });
  } finally {
    process.env.COLLECT_ENABLED = before;
  }
});

test("the window is the first page and at most a hundred jobs", async () => {
  const id = await source(`harness-${unique()}`);
  const many = Array.from({ length: MAX_PER_RUN + 1 }, (_, i) => posting({ url: `https://window.example.com/jobs/${i}`, title: `岗位 ${i}` }));
  const { adapter: a, request } = stub(async () => ({ postings: many, total: 211 }), { sourceId: id });

  const run = await runCollection(a, { request, now: at(0) });
  assert.equal(run.received, MAX_PER_RUN + 1);
  assert.equal(run.accepted, MAX_PER_RUN);
  assert.equal(run.truncated, true, "the upstream has more than this run's window");
  assert.equal(run.created, MAX_PER_RUN);
  assert.equal((await sql`SELECT 1 FROM articles WHERE source_id=${id}`).length, MAX_PER_RUN);
});

test("the page's own order is recorded, not assumed", async () => {
  const id = await source(`harness-${unique()}`);
  const sorted = [3, 2, 1].map((d) => posting({ url: `https://boards.example.com/jobs/s${d}`, title: `岗位 ${d}`, publishedAt: new Date(`2026-10-1${d}T00:00:00Z`) }));
  const first = stub(async () => ({ postings: sorted, total: null }), { sourceId: id, order: "publishedAt-desc" });
  const run = await runCollection(first.adapter, { request: first.request, now: at(0) });
  assert.equal(run.orderExpected, "publishedAt-desc");
  assert.equal(run.orderConfirmed, true);

  const scrambled = stub(async () => ({ postings: [sorted[1]!, sorted[0]!, sorted[2]!], total: null }), { sourceId: id, order: "publishedAt-desc" });
  const second = await runCollection(scrambled.adapter, { request: scrambled.request, now: at(61) });
  assert.equal(second.status, "ok", "an unordered page is a recorded fact, not a failed run");
  assert.equal(second.orderConfirmed, false);
});

test("a page ordered by another clock is checked against that claim, and is not publish-time newest", async () => {
  const id = await source(`harness-${unique()}`);
  // Ordered by the day the position opened (descending), with a newer publication below an older one.
  const opened = [
    posting({ url: "https://boards.example.com/jobs/o1", title: "岗位 O1", publishedAt: new Date("2026-10-14T09:40:00Z"), orderAt: new Date("2026-10-13T16:00:00Z") }),
    posting({ url: "https://boards.example.com/jobs/o2", title: "岗位 O2", publishedAt: new Date("2026-09-24T03:49:00Z"), orderAt: new Date("2026-09-23T16:00:00Z") }),
    posting({ url: "https://boards.example.com/jobs/o3", title: "岗位 O3", publishedAt: new Date("2026-10-13T07:25:00Z"), orderAt: new Date("2026-09-23T16:00:00Z") }),
  ];
  const { adapter: a, request } = stub(async () => ({ postings: opened, total: null }), { sourceId: id, order: "orderAt-desc" });
  const run = await runCollection(a, { request, now: at(0) });
  assert.equal(run.orderExpected, "orderAt-desc");
  assert.equal(run.orderConfirmed, true, "its own claim (the opening day, descending) holds");

  const shuffled = stub(async () => ({ postings: [opened[1]!, opened[0]!, opened[2]!], total: null }), { sourceId: `harness-${unique()}`, order: "orderAt-desc" });
  assert.equal((await runCollection(shuffled.adapter, { request: shuffled.request, now: at(0) })).orderConfirmed, false);
});

test("an interface whose order is unverified says so", async () => {
  const id = await source(`harness-${unique()}`);
  const { adapter: a, request } = stub(async () => ({ postings: [posting({ url: "https://boards.example.com/jobs/x", title: "岗位 X" })], total: null }), { sourceId: id, order: "unverified" });
  const run = await runCollection(a, { request, now: at(0) });
  assert.equal(run.orderExpected, "unverified");
  assert.equal(run.orderConfirmed, false, "nothing verifies the order, so the run does not claim the newest hundred");
});

test("a date-only listing value is that day's start in the sources' own zone, not UTC midnight", () => {
  // The engine drops a publication time more than an hour ahead of the discovery (materials.ts:82) and
  // never recomputes it against a later discovery, so reading "2026-10-15" as UTC midnight (eight hours
  // after Beijing midnight, i.e. in the future for the first seven hours of the Beijing day) loses the
  // job permanently. A value that carries its own zone is left exactly as printed.
  assert.equal(dateValue("2026-10-15")!.toISOString(), "2026-10-14T16:00:00.000Z");
  assert.equal(dateValue("2026-10-14")!.toISOString(), "2026-10-13T16:00:00.000Z");
  assert.equal(dateValue("2026-10-15T09:40:07.000Z")!.toISOString(), "2026-10-15T09:40:07.000Z");
  assert.equal(dateValue("2026-10-15T09:40:07+08:00")!.toISOString(), "2026-10-15T01:40:07.000Z");
  assert.equal(dateValue("  2026-10-15  ")!.toISOString(), dateValue("2026-10-15")!.toISOString());
  assert.equal(dateValue("not a date"), null, "an interface's stray value must not invent a publication time");
  assert.equal(dateValue(null), null);
});

test("an HTML description is decoded once, and numeric entities are read", () => {
  assert.equal(plainText("<p>R&amp;D 工程师</p>"), "R&D 工程师");
  assert.equal(plainText("&amp;lt;script&amp;gt;"), "&lt;script&gt;", "decoding once must not feed the next entity");
  assert.equal(plainText("&#x4E2D;&#25991;"), "中文", "a numeric entity is a character, not a literal");
  assert.equal(plainText("A&nbsp;B"), "A B");
  assert.equal(plainText("&unknown; &amp;"), "&unknown; &", "only known entities are decoded");
  assert.equal(plainText("<p>第一行</p><p>第二行</p>"), "第一行\n第二行", "a block's end keeps its line");
  assert.equal(plainText("职责：<br>1. 写服务<br/>2. 写测试"), "职责：\n1. 写服务\n2. 写测试", "a line break stays a line break");
});

test("a source this module does not own is skipped, not invented", async () => {
  const { adapter: a, request } = stub(async () => { throw new Error("must not be called"); }, { sourceId: `missing-${unique()}` });
  assert.equal((await runCollection(a, { request, now: at(0) })).reason, "missing");
});

test("the module reaches the interface through the engine's guarded fetch", async () => {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.url?.startsWith("/bad")) { res.writeHead(503); res.end("nope"); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const wasAllowed = config.allowPrivateNetworkFetch;
  config.allowPrivateNetworkFetch = true;
  try {
    assert.deepEqual(await requestJson(`${base}/good`), { ok: true });
    await assert.rejects(() => requestJson(`${base}/bad`), /503/);
    await requestJson(`${base}/good`, { method: "POST", body: "positionId=7" });
    // The engine's listing fetch tries a transient 5xx once more; a POST carries a body and is not repeated.
    assert.deepEqual(seen, ["GET /good", "GET /bad", "GET /bad", "POST /good"]);
  } finally {
    config.allowPrivateNetworkFetch = wasAllowed;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
