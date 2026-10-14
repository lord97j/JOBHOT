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
// "Newest" is not verified here: the array is not in publish order — on 2026-10-14 the first entries went
// 10-14 09:40, 10-14 11:23, 10-13 06:45, 10-10, 09-24 — and no request parameter changes it (orderBy,
// sort, sortBy and order were each tried and had no effect). The run therefore reads the interface's
// first page only and records that the order is unverified, instead of claiming it holds the newest 100.
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
    body: plainText(job.description ?? ""),
    raw: {
      jobId: job.id, status: job.status, hireMode: job.hireMode, education: job.education,
      department: job.department?.name, locations: (job.locations ?? []).map((l) => l.name).filter(Boolean),
    },
  };
}

/** One Moka board. A second company on Moka is one more line here, not more code. */
export function mokaBoard(board: MokaBoard): JobAdapter {
  return {
    sourceId: board.sourceId,
    order: "unverified",
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
