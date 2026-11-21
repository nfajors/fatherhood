"use client";

import { ColumnChart } from "@/components/charts/column-chart";
import { dayLabel } from "@/components/charts/scale";

type Day = { day: string; views: number };

/** Counted views per day for the creator's videos. */
export function ViewsChart({ days }: { days: Day[] }) {
  return (
    <ColumnChart
      columns={days.map((d) => ({ key: d.day, label: dayLabel(d.day), longLabel: dayLabel(d.day, "long"), value: d.views }))}
      unit={["view", "views"]}
      emptyText="No views in the last 30 days yet."
      tableHeading="Day"
    />
  );
}
