// 知乎's board on Moka: the public jobs API is plaintext JSON, one page per run, and the job's address
// is a fragment route — the identity rule that makes two jobs of one page two articles.
// The response below is a trimmed capture of the live interface (2026-10-14).
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { mokaBoard } from "../moka.ts";
import { runCollection, type RequestJson } from "../collect.ts";

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
// The clock the run uses, after the capture above: a publication time the engine reads as being in the
// future (more than an hour ahead) is not trusted, and the fixture's newest job is 09:40 UTC.
const NOW = new Date("2026-10-14T12:00:00Z");

after(async () => { await stopBoss(); await closeDb(); });

const PAGE = {
  code: 0,
  msg: "ok",
  total: 3,
  jobs: [
    {
      id: "62037720-c0f9-4295-ab36-13523aab609e",
      title: "大模型数据质量分析师",
      status: "open",
      description: "<p>职位描述：</p><p>1、模型对⻬与数据影响分析。</p><p>任职要求：熟悉 SFT/RLHF，有数据处理经验。</p>",
      publishedAt: "2026-10-14T09:40:07.000Z",
      department: { id: "d1", name: "技术中心" },
      locations: [{ id: "l1", name: "北京" }],
      hireMode: "social",
      education: "本科",
    },
    {
      id: "0d1e6d2e-8ef0-4a4a-9d5b-2b2f1f0a7c11",
      title: "资深前端工程师",
      status: "open",
      description: "<p>职位描述：</p><p>负责招聘站的前端。</p>",
      publishedAt: "2026-10-13T06:45:29.000Z",
    },
    // The board lists jobs it carries no description for; nothing may be stored under an empty body.
    { id: "9f0a1c22-1111-2222-3333-444455556666", title: "数据分析师", status: "open", description: "", publishedAt: "2026-10-12T02:00:00.000Z" },
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
  assert.equal(run.orderExpected, "unverified", "the live interface does not order by publish time; the run says so instead of claiming the newest hundred");
  assert.equal(run.truncated, false);
});

test("a job's fragment keeps it apart from its board-mates, and its description is the body", async () => {
  const id = await source(`moka-${unique()}`);
  const run = await runCollection(mokaBoard({ sourceId: id, org: "zhihu", siteId: "78336" }), { request: reading(PAGE), now: NOW });

  assert.equal(run.received, 3);
  assert.equal(run.created, 2, "the job without a description is kept for a later run, not stored empty");
  assert.equal(run.bodyPending, 1);
  const rows = await sql<{ url: string; title: string; body_text: string; body_status: string; excerpt: string | null; published_at: Date }[]>`
    SELECT url, title, body_text, body_status, excerpt, published_at FROM articles WHERE source_id=${id} ORDER BY published_at DESC`;
  assert.deepEqual(rows.map((r) => r.title), ["大模型数据质量分析师", "资深前端工程师"]);
  assert.equal(rows[0]!.url, "https://app.mokahr.com/social-recruitment/zhihu/78336#/job/62037720-c0f9-4295-ab36-13523aab609e");
  assert.match(rows[0]!.body_text, /^职位描述：\n1、模型对⻬与数据影响分析。/);
  assert.match(rows[0]!.body_text, /熟悉 SFT\/RLHF/);
  assert.equal(rows[0]!.body_status, "ok");
  assert.ok(rows[0]!.excerpt && rows[0]!.excerpt.length <= 300);
  assert.equal(rows[0]!.published_at.toISOString(), "2026-10-14T09:40:07.000Z");
});
