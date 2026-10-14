// 知乎's board on Moka (app.mokahr.com). The site's own module endpoint returns an encrypted payload,
// but Moka's public jobs API is plaintext JSON and needs no key. Read 2026-10-14:
//
//   GET https://api.mokahr.com/v1/jobs/zhihu?mode=social&limit=100&offset=0
//     → { jobs: [{ id, title, description, publishedAt, status, … }], total }
//
// Two things the job's address decides: it is a fragment route (the board's address plus #/job/<id>,
// verified in a browser on 2026-10-14 — the fragment is the only address Moka serves for one job), and
// the description arrives with the listing, so no per-job request is needed.
//
// The order this interface hands out is NOT the publication time. Measured on 知乎's board, 2026-10-14,
// over all 49 jobs it returned:
//
//   • the array is ordered by `openedAt`, descending, 49 of 49 (openedAt is that day's Beijing midnight,
//     so the array is "the day the position opened, newest day first"; within one day it is not sorted);
//   • it is not ordered by `publishedAt`: 0 of 49 agreed with openedAt, and 19 pairs invert (a position
//     opened on an old day can be published yesterday and sit below a newer one);
//   • no time filter or sort parameter changes the set or the order — publishedAfter, publishedBefore,
//     startTime, endTime, updatedAfter, publishedAtStart, createTimeStart, dateFrom, dateTo, from, to,
//     timeRange, publishedAtSort and the orderBy/sort/sortBy/order combinations were each tried, and every
//     answer was the same 49 jobs in the same order;
//   • /v1/orgs/<org>/jobs and /v1/jobs?orgId=… are 404, and /v1/jobs/<org>/social answers with a success
//     envelope carrying no jobs array, so there is no second public entry with a time-ordered list.
//
// So this adapter declares `orderAt-desc` (its own clock, checked on every run) and NOT `publishedAt-desc`:
// the run may read the page, but it must not call this window "the newest hundred by publication time".
// That claim is a measurement, not a vendor promise — changing it to `publishedAt-desc` requires bringing
// a fresh measurement of this interface with it.
import { MAX_PER_RUN, dateValue, plainText, type JobAdapter, type JobPosting, type RequestJson } from "./collect.ts";
import { collapseWhitespace } from "@aihot/backend/lib/text";

export interface MokaBoard {
  /** The source this board feeds (industry/sources.json). */
  sourceId: string;
  /** Moka's organization slug, as it appears in the board's address. */
  org: string;
  /** The board's site id: it is not in the API's answer, only in the board's address (知乎: 78336). */
  siteId: string;
}

interface MokaJob {
  id?: string;
  title?: string;
  description?: string;
  publishedAt?: string;
  /** The day the position opened (Beijing midnight), the field this interface's array is ordered by. */
  openedAt?: string;
  status?: string;
  hireMode?: string;
  education?: string;
  department?: { name?: string };
  locations?: Array<{ name?: string }>;
}

function toPosting(board: MokaBoard, job: MokaJob): JobPosting {
  return {
    url: `https://app.mokahr.com/social-recruitment/${board.org}/${board.siteId}#/job/${job.id}`,
    title: collapseWhitespace(job.title ?? ""),
    publishedAt: dateValue(job.publishedAt),
    orderAt: dateValue(job.openedAt),
    body: plainText(job.description ?? ""),
    raw: {
      jobId: job.id, status: job.status, hireMode: job.hireMode, education: job.education,
      department: job.department?.name, locations: (job.locations ?? []).map((l) => l.name).filter(Boolean),
    },
  };
}

/**
 * One Moka board. A second company on Moka is one more line here, not more code.
 *
 * Two boards must not share one `org`/`siteId`: identity is the job's URL, so the second source would
 * find every job already owned by the first and never get an article of its own (the engine treats the
 * same identity from another source as a discovery, not a revision).
 */
export function mokaBoard(board: MokaBoard): JobAdapter {
  return {
    sourceId: board.sourceId,
    // The opening day, descending — measured above, and re-checked against `openedAt` on every run.
    order: "orderAt-desc",
    async list(request: RequestJson) {
      const page = await request(
        `https://api.mokahr.com/v1/jobs/${encodeURIComponent(board.org)}?mode=social&limit=${MAX_PER_RUN}&offset=0`,
      ) as { jobs?: MokaJob[]; total?: number } | null;
      const jobs = Array.isArray(page?.jobs) ? page.jobs : [];
      return { postings: jobs.flatMap((job) => (job.id ? [toPosting(board, job)] : [])), total: typeof page?.total === "number" ? page.total : null };
    },
  };
}

export const ZHIHU: JobAdapter = mokaBoard({ sourceId: "ext-zhihu", org: "zhihu", siteId: "78336" });
