import type { Metadata } from "next";
import { GiftForm } from "@/components/gifts/gift-form";
import { getSessionUser } from "@/lib/auth";
import { MONEY_BACK_GUARANTEE_DAYS, SITE } from "@/lib/config";
import { currentRegion } from "@/lib/region-server";
import { formatPrice, priceFor, taxNote } from "@/lib/regions";

export const metadata: Metadata = {
  title: "Give a membership",
  description: `Give a father, or a father-to-be, a year of ${SITE.name}.`,
};
export const dynamic = "force-dynamic";

export default async function GiftPage() {
  const [sessionUser, region] = await Promise.all([getSessionUser().catch(() => null), currentRegion()]);
  const prices = {
    annual: formatPrice(priceFor("annual", region.currency), region.currency, region.locale),
    monthly: formatPrice(priceFor("monthly", region.currency), region.currency, region.locale),
  };
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-widest text-gold-600">Gift membership</p>
      <h1 className="mt-3 text-4xl font-semibold sm:text-5xl">Give the gift of fatherhood</h1>
      <p className="mt-4 text-lg text-muted">
        For a new dad, a dad-to-be, or the father who raised you. Their membership starts the day they redeem it, and
        the code never expires. {MONEY_BACK_GUARANTEE_DAYS}-day money-back guarantee.
      </p>
      <div className="mt-10">
        <GiftForm defaultName={sessionUser?.name} defaultEmail={sessionUser?.email} prices={prices} />
        <p className="mt-4 text-sm text-muted">
          Prices in {region.currency.toUpperCase()}. {taxNote(region)}.
        </p>
      </div>
    </div>
  );
}
