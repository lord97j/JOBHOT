// 汽车之家's own recruitment API (talent.autohome.com.cn). Read 2026-10-14:
//
//   POST .../getPositionList?currentPage=1&pageSize=1000&targetId=&work_place=&func_cat_id=&dept_id=&search=
//     → { returnObject: { list: [{ id, name, publicShowTime, workCityShow, … }], count } }   (newest first)
//   POST .../getPositionDetail   body: positionId=<id>
//     → { returnObject: { detail, requirement } }
//
// Sorting was measured, not assumed: on 2026-10-14 the list came back strictly by publicShowTime —
// the day the position went public, which is the publication time this run stores — newest first
// (10-14 … 10-13 … down to 2025-11-19). So here, unlike Moka, `currentPage=1` really is the newest
// window by publication time, and the run re-checks that order on every read (SourceRun.orderConfirmed).
//
// The list carries no description, so each job of the page costs one request of its own — a body per
// job, NOT pagination: the ids come from the page just read and currentPage stays 1. The job's own link
// is the application form; the description lives only behind that per-job request.
import { dateValue, plainText, type JobAdapter, type JobPosting } from "./collect.ts";
import { collapseWhitespace } from "@aihot/backend/lib/text";

const LIST_URL = "https://talent.autohome.com.cn/api/officialPosition/getPositionList";
const DETAIL_URL = "https://talent.autohome.com.cn/api/officialPosition/getPositionDetail";

// One page, as large as the interface accepts: the run takes its first hundred jobs and never asks for
// another page (`currentPage` never moves, no offset is advanced).
//
// `pageSize` is the interface's own cap, not the run's window (`collect.ts` MAX_PER_RUN): asking for a
// thousand lets the answer itself show that the board holds more than this run keeps, while the run still
// stores only the newest hundred. The two numbers are independent on purpose — raising the window must not
// silently change the request the interface is asked to answer.
const PAGE_QUERY = "?currentPage=1&pageSize=1000&targetId=&work_place=&func_cat_id=&dept_id=&search=";

interface AutohomeItem {
  id?: number;
  code?: string;
  name?: string;
  publicShowTime?: string;
  deptShow?: string;
  workCityShow?: string;
  funcCatShow?: string;
  salaryShow?: string;
  targetShow?: string;
  needNum?: number;
  update_time?: string;
}

function toPosting(item: AutohomeItem): JobPosting {
  return {
    url: `https://talent.autohome.com.cn/recruit-delivery.html?pid=${item.id}`,
    title: collapseWhitespace(item.name ?? ""),
    // A date-only listing value: read as that day's start, like the engine's own date parsing.
    publishedAt: dateValue(item.publicShowTime),
    body: "", // 职责与要求 come from this job's own detail request (adapter.body below)
    raw: { positionId: item.id, code: item.code, department: item.deptShow, city: item.workCityShow,
      role: item.funcCatShow, salary: item.salaryShow, target: item.targetShow, openings: item.needNum, updatedAt: item.update_time },
  };
}

export const AUTOHOME: JobAdapter = {
  sourceId: "ext-autohome",
  // The list's own publication time, descending — the only claim under which this window is "the newest".
  order: "publishedAt-desc",
  async list(request) {
    const page = await request(LIST_URL + PAGE_QUERY, { method: "POST" }) as
      { returnObject?: { list?: AutohomeItem[]; count?: number } } | null;
    const items = Array.isArray(page?.returnObject?.list) ? page.returnObject.list : [];
    const total = page?.returnObject?.count;
    return { postings: items.flatMap((item) => (item.id === undefined ? [] : [toPosting(item)])), total: typeof total === "number" ? total : null };
  },
  // One request for one job's description — the difference between this and a page turn is the argument:
  // the id comes from the page this run just read, and no page number is involved.
  async body(posting, request) {
    const answer = await request(DETAIL_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `positionId=${encodeURIComponent(String(posting.raw.positionId))}`,
    }) as { returnObject?: { detail?: string; requirement?: string } } | null;
    const got = answer?.returnObject;
    return plainText([got?.detail, got?.requirement].filter(Boolean).join("\n"));
  },
};
