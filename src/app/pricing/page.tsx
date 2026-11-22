import type { Metadata } from "next";
import Link from "next/link";
import { SubscribeButton } from "@/components/subscribe-button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { MONEY_BACK_GUARANTEE_DAYS } from "@/lib/config";
import { currentRegion } from "@/lib/region-server";
import { formatPrice, priceFor, taxNote } from "@/lib/regions";

export const metadata: Metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

const INCLUDED = [
  "Every Professional Academy course, including new monthly releases",
  "Workbooks, reflection exercises and key insight cards",
  "Progress tracking and resume on any device",
  "Rate, review and discuss every lesson",
];

export default async function PricingPage() {
  const region = await currentRegion();
  const price = (plan: "monthly" | "annual") => formatPrice(priceFor(plan, region.currency), region.currency, region.locale);
  const monthlyEquivalent = formatPrice(Math.round(priceFor("annual", region.currency) / 12), region.currency, region.locale);
  return (
    <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-semibold sm:text-5xl">One membership. Every course.</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        Community Voices stay free for everyone. Membership unlocks the full Professional Academy.{" "}
        {MONEY_BACK_GUARANTEE_DAYS}-day money-back guarantee.
      </p>

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        <Card className="border-2 border-gold-500">
          <p className="text-xs font-semibold uppercase tracking-widest text-gold-600">Best value</p>
          <CardTitle className="mt-2">Annual</CardTitle>
          <p className="mt-4 font-serif text-5xl text-navy-900">{price("annual")}</p>
          <CardDescription>per year, about {monthlyEquivalent} a month</CardDescription>
          <SubscribeButton plan="annual" size="lg" className="mt-6 w-full">
            Join annually
          </SubscribeButton>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Flexible</p>
          <CardTitle className="mt-2">Monthly</CardTitle>
          <p className="mt-4 font-serif text-5xl text-navy-900">{price("monthly")}</p>
          <CardDescription>per month, cancel any time</CardDescription>
          <SubscribeButton plan="monthly" size="lg" variant="secondary" className="mt-6 w-full">
            Join monthly
          </SubscribeButton>
        </Card>
      </div>

      <p className="mt-4 text-sm text-muted">
        Prices in {region.currency.toUpperCase()} for {region.code === "XX" ? "your country" : region.name}. {taxNote(region)}. Not right? Choose your country at the
        bottom of the page.
      </p>

      <ul className="mt-12 grid gap-3 text-ink sm:grid-cols-2">
        {INCLUDED.map((item) => (
          <li key={item} className="flex gap-3">
            <span aria-hidden className="text-gold-500">✓</span>
            {item}
          </li>
        ))}
      </ul>
      <p className="mt-8 text-muted">
        Know a father who&apos;d love this?{" "}
        <Link href="/gift" className="font-semibold text-navy-900 underline underline-offset-4">
          Give a membership as a gift
        </Link>
        .
      </p>
    </div>
  );
}
