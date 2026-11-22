/**
 * The scheduler, for hosts without built-in cron (Railway): run this every 5 minutes.
 * It calls each job due now on the web service with `Authorization: Bearer $CRON_SECRET`,
 * in parallel, and exits non-zero if any failed. Plain Node, no dependencies.
 *
 *   CRON_TARGET_URL  the web service to call (defaults to NEXT_PUBLIC_APP_URL)
 *   CRON_SECRET      the same secret the web service has
 *
 *   node scripts/cron-tick.mjs              # the jobs due now
 *   node scripts/cron-tick.mjs payouts      # one job, now
 */
import { dueJobs, JOBS } from "./jobs.mjs";

const target = (process.env.CRON_TARGET_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
const secret = process.env.CRON_SECRET;
if (!target || !secret) {
  console.error("Set CRON_TARGET_URL (or NEXT_PUBLIC_APP_URL) and CRON_SECRET.");
  process.exit(1);
}

const named = process.argv.slice(2);
const unknown = named.filter((n) => !JOBS.some((j) => j.name === n));
if (unknown.length) {
  console.error(`Unknown job: ${unknown.join(", ")}. Jobs: ${JOBS.map((j) => j.name).join(", ")}`);
  process.exit(1);
}
const jobs = named.length ? JOBS.filter((j) => named.includes(j.name)) : dueJobs(new Date());
if (jobs.length === 0) {
  console.log("Nothing due.");
  process.exit(0);
}

const results = await Promise.allSettled(
  jobs.map(async (job) => {
    const started = Date.now();
    const res = await fetch(`${target}${job.path}`, {
      headers: { authorization: `Bearer ${secret}` },
      // Moderation can take a few minutes when several videos are screened at once.
      signal: AbortSignal.timeout(9 * 60_000),
    });
    const body = await res.text();
    const line = `${job.name}: ${res.status} in ${((Date.now() - started) / 1000).toFixed(1)}s ${body.slice(0, 500)}`;
    if (!res.ok) throw new Error(line);
    console.log(line);
  }),
);
const failed = results.filter((r) => r.status === "rejected");
for (const f of failed) console.error(f.reason instanceof Error ? f.reason.message : f.reason);
process.exit(failed.length ? 1 : 0);
