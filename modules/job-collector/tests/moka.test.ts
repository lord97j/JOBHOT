// 知乎's board on Moka: the public jobs API is plaintext JSON, one page per run, and the job's address
// is a fragment route — the identity rule that makes two jobs of one page two articles.
// The response below is a trimmed capture of the live interface (2026-10-14), including the shape that
// matters most: the array is ordered by `openedAt` (the day the position opened, Beijing midnight),
// while `publishedAt` is not monotone — the third job below opened on the same day as the second one
// but was published three weeks later. That is the measurement behind the adapter's `orderAt-desc`.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { mokaBoard, ZHIHU } from "../moka.ts";
import { runCollection, type RequestJson } from "../collect.ts";

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
// The clock the run uses, after the capture above: a publication time the engine reads as being in the
// future (more than an hour ahead) is not trusted, and the fixture's newest job is 09:40 UTC.
const NOW = new Date("2026-10-14T12:00:00Z");

after(async () => { await stopBoss(); await closeDb(); });

const PAGE = {
  code: 0,
  msg: "ok",
  total: 4,
  jobs: [
    {
      id: "62037720-c0f9-4295-ab36-13523aab609e",
      title: "大模型数据质量分析师",
      status: "open",
      description: "<p>职位描述：</p><p>1、模型对⻬与数据影响分析。</p><p>任职要求：熟悉 SFT/RLHF，有数据处理经验。</p>",
      publishedAt: "2026-10-14T09:40:07.000Z",
      openedAt: "2026-10-13T16:00:00.000Z",
      department: { id: "d1", name: "技术中心" },
      locations: [{ id: "l1", name: "北京" }],
      hireMode: "social",
      education: "本科",
    },
    {
      id: "0d1e6d2e-8ef0-4a4a-9d5b-2b2f1f0a7c11",
      title: "机器学习平台运维工程师",
      status: "open",
      description: "<p>职位描述：</p><p>负责训练平台。</p>",
      publishedAt: "2026-09-24T03:49:12.000Z",
      openedAt: "2026-09-23T16:00:00.000Z",
    },
    {
      id: "2b7c1e44-5555-6666-7777-888899990000",
      title: "AI 数据解决方案工程师",
      status: "open",
      description: "<p>职位描述：</p><p>负责数据解决方案。</p>",
      // Published three weeks after the job above although both opened the same day: the array is not in
      // publication order, and a run must not read it as such.
      publishedAt: "2026-10-13T07:25:53.000Z",
      openedAt: "2026-09-23T16:00:00.000Z",
    },
    // The board lists jobs it carries no description for; nothing may be stored under an empty body.
    { id: "9f0a1c22-1111-2222-3333-444455556666", title: "数据分析师", status: "open", description: "",
      publishedAt: "2026-01-16T03:22:59.000Z", openedAt: "2026-01-02T16:00:00.000Z" },
  ],
};

function reading(body: unknown, calls: string[] = []): RequestJson {
  return async (url) => { calls.push(url); return body; };
}

async function source(id: string) {
  await sql`INSERT INTO sources(id,name,kind,tier,participation_mode,interval_minutes,enabled,cursor)
    VALUES(${id}, ${id}, 'external', 'T1', 'editorial', 60, true, '{}')`;
  return id;
}

test("one page per run: offset stays 0 and the second page is never read", async () => {
  const id = await source(`moka-${unique()}`);
  const calls: string[] = [];
  // Its own board address, so this test's jobs have their own identities (a job's identity is its URL).
  const run = await runCollection(mokaBoard({ sourceId: id, org: "zhihu", siteId: `7833${unique()}` }), { request: reading(PAGE, calls), now: NOW });

  assert.equal(calls.length, 1, "the listing only: Moka's description comes with it");
  const url = new URL(calls[0]!);
  assert.equal(url.searchParams.get("mode"), "social");
  assert.equal(url.searchParams.get("limit"), "100", "the interface's own cap is the run's window");
  assert.equal(url.searchParams.get("offset"), "0");
  const ordered = PAGE.jobs.map((job) => job.openedAt);
  assert.deepEqual([...ordered].sort().reverse(), ordered, "the capture itself is in the interface's order (opening day, newest first)");
  const published = PAGE.jobs.map((job) => job.publishedAt);
  assert.notDeepEqual([...published].sort().reverse(), published, "and that order is NOT the publication order — the capture has an inversion");
  assert.equal(run.orderExpected, "orderAt-desc", "this interface's clock is the opening day, not the publication time");
  assert.notEqual(run.orderExpected, "publishedAt-desc", "so the window is not claimed to be the newest by publication time");
  assert.equal(run.orderConfirmed, true, "the claim itself held: the page really is ordered by openedAt, descending");
  assert.equal(run.truncated, false);
});

test("a job's fragment keeps it apart from its board-mates, its description is the body, and the next run of the same page adds nothing", async () => {
  const id = await source(`moka-${unique()}`);
  const board = mokaBoard({ sourceId: id, org: "zhihu", siteId: "78336" });
  const run = await runCollection(board, { request: reading(PAGE), now: NOW });

  assert.equal(run.received, 4);
  assert.equal(run.created, 3, "the job without a description is kept for a later run, not stored empty");
  assert.equal(run.bodyPending, 1);
  const rows = await sql<{ id: string; url: string; title: string; body_text: string; body_status: string; excerpt: string | null; published_at: Date }[]>`
    SELECT id, url, title, body_text, body_status, excerpt, published_at FROM articles WHERE source_id=${id} ORDER BY published_at DESC`;
  assert.deepEqual(rows.map((r) => r.title), ["大模型数据质量分析师", "AI 数据解决方案工程师", "机器学习平台运维工程师"]);
  assert.equal(rows[0]!.url, "https://app.mokahr.com/social-recruitment/zhihu/78336#/job/62037720-c0f9-4295-ab36-13523aab609e");
  assert.match(rows[0]!.body_text, /^职位描述：\n1、模型对⻬与数据影响分析。/);
  assert.match(rows[0]!.body_text, /熟悉 SFT\/RLHF/);
  assert.equal(rows[0]!.body_status, "ok");
  assert.ok(rows[0]!.excerpt && rows[0]!.excerpt.length <= 300);
  assert.equal(rows[0]!.published_at.toISOString(), "2026-10-14T09:40:07.000Z");

  // The same page again: the fragment is what makes each job its own article, so the second run must find
  // every one of them already stored instead of creating them again under a fresh identity.
  const again = await runCollection(board, { request: reading(PAGE), now: new Date(NOW.getTime() + 61 * 60_000) });
  assert.equal(again.created, 0);
  assert.equal(again.revised, 0);
  assert.equal(again.bodyPending, 1, "the job the board still lists without a description is still waiting, not stored empty");
  const after = await sql<{ id: string }[]>`SELECT id FROM articles WHERE source_id=${id} ORDER BY published_at DESC`;
  assert.equal(after.length, 3);
  assert.deepEqual(after.map((r) => r.id), rows.map((r) => r.id));
});

test("the board's order claim is a measurement", () => {
  // The value below comes from measuring 知乎's interface on 2026-10-14 over all 49 jobs it returned:
  // openedAt descending 49/49; publishedAt diverges (0/49 equal, 19 pairs inverted); none of the twelve
  // time-filter/sort parameters tried changed the set or the order; the other public paths are 404 or an
  // empty success envelope. The claim is a measurement, not a vendor promise, so raising it to
  // "publishedAt-desc" — the claim that lets the window be called "the newest hundred" — must come with a
  // fresh measurement of this interface, not with a later expansion.
  //
  // The claim sits on the one factory every Moka board is built through (moka.ts), because it describes
  // the interface Moka serves for every org, not a company: a new board has no switch of its own to flip,
  // and the only way to upgrade the claim is to change that line — which this assertion makes visible.
  assert.equal(ZHIHU.order, "orderAt-desc");
});
