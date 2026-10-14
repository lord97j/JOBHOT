// The site's own job collection, as a module of the existing worker: the schedule below is merged into
// the engine's (apps/worker/src/schedules.ts) and run by the same pg-boss consumer in the same process.
// Nothing here starts a scheduler, a service, a subprocess or a browser; the run only makes HTTP requests
// and stores material through the engine's entrance.
import { defineServerModule } from "@aihot/backend/modules";
import { AUTOHOME } from "./autohome.ts";
import { collectDueJobs, type JobAdapter } from "./collect.ts";
import { ZHIHU } from "./moka.ts";

/** The sources this module collects. Each one's own interval decides when its next run happens. */
const ADAPTERS: readonly JobAdapter[] = [ZHIHU, AUTOHOME];

export const JOB_COLLECTOR = defineServerModule({
  name: "job-collector",
  schedules: [{
    name: "modules.job-collect",
    // The worker wakes the module; the sources gate themselves (interval_minutes), so one minute's
    // schedule still means one request an hour per company.
    cron: "*/5 * * * *",
    run: () => collectDueJobs(ADAPTERS),
    when: () => process.env.COLLECT_ENABLED === "true",
  }],
});
