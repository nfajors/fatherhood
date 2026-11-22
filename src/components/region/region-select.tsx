"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { REGIONS, type RegionCode } from "@/lib/regions";

/** Country for prices and dates; remembered in a cookie. */
export function RegionSelect({ current }: { current: RegionCode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="inline-flex items-center gap-2">
      <span>Prices for</span>
      <select
        value={current}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            await fetch("/api/region", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: e.target.value }) });
            router.refresh();
          })
        }
        className="rounded-md border border-navy-900/20 bg-white px-2 py-1 text-sm text-ink"
      >
        {Object.values(REGIONS).map((r) => (
          <option key={r.code} value={r.code}>
            {r.name} ({r.currency.toUpperCase()})
          </option>
        ))}
      </select>
    </label>
  );
}
