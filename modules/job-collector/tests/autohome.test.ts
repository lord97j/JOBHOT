// 汽车之家's own recruitment API: the list carries no description, so each job of the page is asked for
// its own detail once. That request fills a body — it is not pagination, and the page number never moves.
// The responses below are trimmed captures of the live interface (2026-10-14).
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { AUTOHOME } from "../autohome.ts";
import { runCollection, type RequestJson } from "../collect.ts";

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const NOW = new Date("2026-10-14T04:00:00Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

after(async () => { await stopBoss(); await closeDb(); });

const list = (ids: number[]) => ({ returnObject: { count: ids.length, list: ids.map((id, i) => ({
  id, code: String(id), name: i === 0 ? "后端开发工程师【2027届校招】" : "前端开发工程师",
  publicShowTime: i === 0 ? "2026-10-14" : "2026-10-13", update_time: "2026-10-14T03:37:22.000+0000",
  workCityShow: "北京", funcCatShow: "技术", deptShow: "智能中心", salaryShow: "18-30K", targetShow: "校招", needNum: 10,
})) } });

const detail = (id: number) => ({ returnObject: { id, detail: `工作职责\n1. 负责 ${id} 号岗位的后端服务。`, requirement: "岗位要求\n1. 本科及以上。" },
  code: 0, status: 1 });

interface Call { url: string; method: string; body: string | undefined; contentType: string | undefined }

function reading(ids: number[], fail: number[] = []) {
  const calls: Call[] = [];
  const request: RequestJson = async (url, opts) => {
    calls.push({ url, method: opts?.method ?? "GET", body: opts?.body, contentType: opts?.headers?.["content-type"] });
    if (!url.includes("getPositionDetail")) return list(ids);
    const id = Number(new URLSearchParams(opts?.body ?? "").get("positionId"));
    if (fail.includes(id)) throw new Error(`HTTP 500 for ${id}`);
    return detail(id);
  };
  return { request, calls };
}

async function source(id: string) {
  await sql`INSERT INTO sources(id,name,kind,tier,participation_mode,interval_minutes,enabled,cursor)
    VALUES(${id}, ${id}, 'external', 'T1', 'editorial', 60, true, '{}')`;
  return id;
}

test("every job of the page gets one detail request of its own, and the page never advances", async () => {
  const id = await source(`autohome-${unique()}`);
  const { request, calls } = reading([47898, 47897]);
  const run = await runCollection({ ...AUTOHOME, sourceId: id }, { request, now: NOW });

  assert.equal(run.orderExpected, "publishedAt-desc", "the live list came back newest by publication time (measured 2026-10-14)");
  assert.equal(run.orderConfirmed, true);
  assert.equal(run.created, 2);
  assert.equal(run.bodyFailures, 0);
  assert.equal(calls.length, 3, "one list and one detail per job — a body, not a second page");
  assert.equal(calls[0]!.method, "POST");
  assert.match(calls[0]!.url, /getPositionList\?currentPage=1&/);
  assert.equal(calls.some((c) => /currentPage=2/.test(c.url)), false);
  assert.deepEqual(calls.slice(1).map((c) => c.body), ["positionId=47898", "positionId=47897"]);
  assert.ok(calls.slice(1).every((c) => c.contentType === "application/x-www-form-urlencoded"), "the detail API wants a form body");

  const [row] = await sql<{ url: string; title: string; body_text: string; published_at: Date }[]>`
    SELECT url, title, body_text, published_at FROM articles WHERE source_id=${id} ORDER BY published_at DESC LIMIT 1`;
  assert.equal(row!.url, "https://talent.autohome.com.cn/recruit-delivery.html?pid=47898");
  assert.equal(row!.title, "后端开发工程师【2027届校招】");
  assert.match(row!.body_text, /^工作职责\n1\. 负责 47898 号岗位的后端服务。\n岗位要求\n1\. 本科及以上。$/);
  assert.equal(row!.published_at.toISOString(), "2026-10-14T00:00:00.000Z", "a date-only listing value is read as that day");
});

test("a job whose detail failed this run is completed by the next one", async () => {
  const id = await source(`autohome-${unique()}`);
  const jobs = [50001, 50002];
  const first = await runCollection({ ...AUTOHOME, sourceId: id }, { request: reading(jobs, [jobs[1]!]).request, now: at(0) });

  assert.equal(first.status, "ok");
  assert.equal(first.created, 1, "the job whose description arrived is stored");
  assert.equal(first.bodyFailures, 1);
  assert.deepEqual(first.bodyErrors, [`https://talent.autohome.com.cn/recruit-delivery.html?pid=${jobs[1]} — HTTP 500 for ${jobs[1]}`],
    "the operator sees which job's description is missing, not only how many");
  assert.equal(first.bodyPending, 1);
  assert.equal((await sql`SELECT 1 FROM articles WHERE source_id=${id}`).length, 1, "the application form is never stored as a body");

  const second = await runCollection({ ...AUTOHOME, sourceId: id }, { request: reading(jobs).request, now: at(61) });
  assert.equal(second.created, 1);
  assert.equal((await sql`SELECT 1 FROM articles WHERE source_id=${id}`).length, 2);
});
