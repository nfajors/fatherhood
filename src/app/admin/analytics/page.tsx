import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Kpi, MeterList } from "@/components/analytics/kpi";
import { ColumnChart } from "@/components/charts/column-chart";
import { LineChart } from "@/components/charts/line-chart";
import { dayLabel, formatValue, monthLabel } from "@/components/charts/scale";
import { Card } from "@/components/ui/card";
import { percent } from "@/lib/analytics/compare";
import { analyticsOverview, parseRange, RANGES, rangeEndingAt } from "@/lib/analytics/service";
import { getDb } from "@/lib/db";
import { formatCount, formatWatchTime } from "@/lib/format";
import { REVENUE_POLICY } from "@/lib/revenue/policy";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Analytics (admin)", robots: { index: false } };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const dollars = (cents: number) => formatValue(cents, "money");
const hours = (seconds: number) => `${formatCount(Math.round(seconds / 3600))} hr`;

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <h2 id={id} className="text-2xl font-semibold">
        {title}
      </h2>
      {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const days = parseRange((await searchParams).range);
  const range = rangeEndingAt(new Date(), days);
  const { members, money, joined, watched, top, courses, learned, social, coach } = await analyticsOverview(getDb(), range);
  const period = `previous ${days} days`;
  const daily = <T extends { day: string; value: number }>(rows: T[]) =>
    rows.map((r) => ({ key: r.day, label: dayLabel(r.day), longLabel: dayLabel(r.day, "long"), value: r.value }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Analytics</h1>
          <p className="mt-2 text-muted">
            {dayLabel(range.start.toISOString().slice(0, 10))} to today (UTC), compared with the {days} days before.
          </p>
        </div>
        <nav aria-label="Date range" className="flex rounded-lg border border-navy-900/15 bg-white p-1 text-sm">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/admin/analytics?range=${r}`}
              aria-current={r === days ? "page" : undefined}
              className={cn("rounded-md px-3 py-1.5", r === days ? "bg-navy-900 font-semibold text-white" : "text-navy-900 hover:bg-navy-100")}
            >
              {r} days
            </Link>
          ))}
        </nav>
      </div>

      <section aria-label="Headline numbers" className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Members" value={members.active.toLocaleString("en-US")} current={members.active} previous={members.activeAtStart} period="start of range" />
        <Kpi label="Monthly recurring revenue" value={dollars(members.mrrCents)} detail={`${members.renewing} renewing · ${members.cancelling} set to cancel`} />
        <Kpi label="Revenue" value={dollars(money.totalCents.current)} current={money.totalCents.current} previous={money.totalCents.previous} period={period} />
        <Kpi label="Sign-ups" value={joined.count.current.toLocaleString("en-US")} current={joined.count.current} previous={joined.count.previous} period={period} />
        <Kpi label="Memberships started" value={members.started.current.toLocaleString("en-US")} current={members.started.current} previous={members.started.previous} period={period} />
        <Kpi
          label="Memberships ended"
          value={members.ended.current.toLocaleString("en-US")}
          current={members.ended.current}
          previous={members.ended.previous}
          upIsGood={false}
          period={period}
          detail={`Churn ${percent(members.churnRate)} of members at the start`}
        />
        <Kpi label="Views" value={formatCount(watched.views.current)} current={watched.views.current} previous={watched.views.previous} period={period} />
        <Kpi label="Watch time" value={hours(watched.watchSeconds.current)} current={watched.watchSeconds.current} previous={watched.watchSeconds.previous} period={period} />
      </section>

      <Section id="members" title="Members" description="People with access at the end of each day: paid memberships and gifts. Past days are estimated from each membership's dates.">
        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <Card>
            <h3 className="text-lg font-semibold">Members per day</h3>
            <div className="mt-6">
              <LineChart points={daily(members.daily)} unit={["member", "members"]} tableHeading="Day" ariaLabel="Members per day" />
            </div>
          </Card>
          <Card>
            <h3 className="text-lg font-semibold">By plan, today</h3>
            <div className="mt-4">
              <MeterList
                rows={[
                  { label: "Monthly", value: members.plans.monthly },
                  { label: "Annual", value: members.plans.annual },
                  { label: "Gift", value: members.plans.gift },
                  { label: "Organization", value: members.plans.organization },
                ]}
              />
            </div>
            <p className="mt-4 text-xs text-muted">Monthly recurring revenue counts annual plans at a twelfth of $199. Gifts and organization seats are paid up front, so they aren&apos;t in it.</p>
          </Card>
        </div>
      </Section>

      <Section id="revenue" title="Revenue" description="Paid membership invoices, gift purchases and organization contracts, as recorded from Stripe (before Stripe's fees and any later refunds).">
        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <Card>
            <h3 className="text-lg font-semibold">Revenue by month</h3>
            <div className="mt-6">
              <ColumnChart
                columns={money.monthly.map((m) => ({ key: m.month, label: monthLabel(m.month), longLabel: monthLabel(m.month, "long"), value: m.totalCents }))}
                format="money"
                emptyText="No revenue in the last 12 months."
                tableHeading="Month"
              />
            </div>
          </Card>
          <div className="grid content-start gap-4">
            <Kpi label={`Gifts, last ${days} days`} value={dollars(money.giftCents)} detail="Included in revenue" />
            <Kpi label={`Organizations, last ${days} days`} value={dollars(money.organizationCents)} detail="Contract invoices paid; included in revenue" />
            <Kpi label="To the creator pool" value={dollars(money.creatorPoolCents)} detail={`${REVENUE_POLICY.poolShareBps / 100}% of the last ${days} days' revenue`} />
          </div>
        </div>
      </Section>

      <Section id="signups" title="Sign-ups">
        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <Card>
            <h3 className="text-lg font-semibold">New accounts per day</h3>
            <div className="mt-6">
              <ColumnChart columns={daily(joined.daily)} unit={["sign-up", "sign-ups"]} emptyText="No sign-ups in this range." tableHeading="Day" />
            </div>
          </Card>
          <Kpi
            label="Became members"
            value={percent(joined.conversionRate)}
            className="content-start"
            detail={`${joined.becameMembers} of the ${joined.count.current} people who signed up in this range have a membership (or gift).`}
          />
        </div>
      </Section>

      <Section id="viewing" title="Viewing" description="A view is a playback of 30 seconds or more, the same rule as the creator pool.">
        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <Card>
            <h3 className="text-lg font-semibold">Views per day</h3>
            <div className="mt-6">
              <ColumnChart columns={daily(watched.daily)} unit={["view", "views"]} emptyText="No views in this range." tableHeading="Day" />
            </div>
          </Card>
          <Card>
            <h3 className="text-lg font-semibold">Where</h3>
            <div className="mt-4">
              <MeterList
                format={formatCount}
                rows={[
                  { label: "Academy", value: watched.academyViews },
                  { label: "Community", value: watched.communityViews },
                ]}
              />
            </div>
            <p className="mt-4 text-sm">
              {watched.signedInViewers.toLocaleString("en-US")} signed-in {plural(watched.signedInViewers, "viewer", "viewers")}, plus{" "}
              {watched.anonymousViews.toLocaleString("en-US")} {plural(watched.anonymousViews, "view", "views")} by visitors not signed in.
            </p>
          </Card>
        </div>

        <Card className="mt-6">
          <h3 className="text-lg font-semibold">Most watched</h3>
          {top.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nothing watched in this range.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="py-2 font-normal">Video</th>
                    <th className="py-2 font-normal">Creator</th>
                    <th className="py-2 text-right font-normal">Views</th>
                    <th className="py-2 text-right font-normal">Watch time</th>
                    <th className="py-2 text-right font-normal">Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((v) => (
                    <tr key={v.id} className="border-t border-navy-900/5">
                      <td className="py-2">
                        {v.type === "community" ? (
                          <Link href={`/community/${v.id}`} className="hover:underline">
                            {v.title}
                          </Link>
                        ) : (
                          v.title
                        )}
                        <span className="ml-2 text-xs text-muted">{v.type === "community" ? "Community" : "Academy"}</span>
                      </td>
                      <td className="py-2">{v.creator}</td>
                      <td className="py-2 text-right tabular-nums">{v.views.toLocaleString("en-US")}</td>
                      <td className="py-2 text-right tabular-nums">{formatWatchTime(v.watchSeconds)}</td>
                      <td className="py-2 text-right tabular-nums">{v.ratingAverage ? `${Number(v.ratingAverage).toFixed(1)} (${v.ratingCount})` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>

      <Section id="learning" title="Learning">
        <section aria-label="Learning numbers" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi label="Certificates earned" value={String(learned.certificates.current)} current={learned.certificates.current} previous={learned.certificates.previous} period={period} />
          <Kpi label="Quiz attempts" value={learned.quizAttempts.toLocaleString("en-US")} />
          <Kpi label="Quiz pass rate" value={percent(learned.quizPassRate)} detail="Of attempts in this range" />
          <Kpi label="Published courses" value={String(courses.length)} />
        </section>
        {courses.length > 0 && (
          <Card className="mt-6">
            <h3 className="text-lg font-semibold">Courses</h3>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="py-2 font-normal">Course</th>
                    <th className="py-2 text-right font-normal">Learners</th>
                    <th className="py-2 text-right font-normal">Certificates</th>
                    <th className="py-2 text-right font-normal">All time</th>
                  </tr>
                </thead>
                <tbody>
                  {courses.map((c) => (
                    <tr key={c.id} className="border-t border-navy-900/5">
                      <td className="py-2">
                        <Link href={`/academy/${c.slug}`} className="hover:underline">
                          {c.title}
                        </Link>
                      </td>
                      <td className="py-2 text-right tabular-nums">{c.learners}</td>
                      <td className="py-2 text-right tabular-nums">{c.certificates}</td>
                      <td className="py-2 text-right tabular-nums">{c.certificatesAllTime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted">Learners: signed-in people who watched any of the course&apos;s lessons in this range.</p>
          </Card>
        )}
      </Section>

      <Section id="coach" title="Coach" description="Counts only: conversations with the coach are private, and nobody here can read them.">
        <section aria-label="Coach numbers" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi label="Members using the coach" value={coach.members.toLocaleString("en-US")} detail={members.active ? `${Math.round((coach.members / members.active) * 100)}% of members` : undefined} />
          <Kpi label="Messages sent" value={coach.messages.toLocaleString("en-US")} detail={coach.members ? `${(coach.messages / coach.members).toFixed(1)} per member` : undefined} />
          <Kpi label="Conversations" value={coach.conversations.toLocaleString("en-US")} />
          <Kpi label="Reply tokens" value={formatCount(coach.outputTokens)} detail="Output tokens, the main driver of cost" />
        </section>
      </Section>

      <Section id="community" title="Community">
        <section aria-label="Community numbers" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi label="Comments" value={social.comments.toLocaleString("en-US")} />
          <Kpi label="Ratings" value={social.ratings.toLocaleString("en-US")} detail={`${social.writtenReviews} with a written review`} />
          <Kpi label="Videos published" value={String(social.communityVideosPublished + social.academyVideosPublished)} detail={`${social.communityVideosPublished} Community · ${social.academyVideosPublished} Academy`} />
          <Kpi label="Fellows" value={String(social.fellows)} />
        </section>
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <li>
            <Link href="/admin/moderation" className="underline-offset-2 hover:underline">
              {social.awaitingReview} {plural(social.awaitingReview, "video", "videos")} awaiting review
            </Link>
          </li>
          <li>
            <Link href="/admin/moderation" className="underline-offset-2 hover:underline">
              {social.openReports} open {plural(social.openReports, "report", "reports")}
            </Link>
          </li>
          <li>
            <Link href="/admin/creators" className="underline-offset-2 hover:underline">
              {social.pendingApplications} Fellow {plural(social.pendingApplications, "application", "applications")}
            </Link>
          </li>
        </ul>
      </Section>
    </div>
  );
}
