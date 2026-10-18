import { getDb } from "@/lib/db";
import { getMailer } from "@/lib/email";
import { appUrl } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { monthPeriod } from "@/lib/revenue/pool";
import { settlePeriod } from "@/lib/revenue/settlement";
import { StripeConnectGateway, type ConnectGateway } from "./gateway";
import { remindAccountSetup, sendPayouts } from "./service";

let gateway: ConnectGateway | undefined;

export function getConnectGateway(): ConnectGateway {
  gateway ??= new StripeConnectGateway(getStripe());
  return gateway;
}

/** Sending money without an admin pressing "Send" is opt-in. */
export const autoSendEnabled = () => process.env.PAYOUTS_AUTO_SEND === "true";

/** Settle last month from this day on, so late invoices and refunds are in. */
export const SETTLE_ON_DAY = 5;

/**
 * The daily payout job: settle last month once it's due, remind creators who
 * have money waiting to set up payouts, and send payouts if automatic sending is on.
 */
export async function runPayoutJob(now: Date = new Date()) {
  const db = getDb();
  let settled: { month: string; alreadySettled: boolean; payouts: number } | null = null;
  if (now.getUTCDate() >= SETTLE_ON_DAY) {
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const result = await settlePeriod(db, monthPeriod(prev.getUTCFullYear(), prev.getUTCMonth() + 1));
    settled = { month: prev.toISOString().slice(0, 7), alreadySettled: result.alreadySettled, payouts: result.payouts.length };
  }
  const reminded = await remindAccountSetup(db, getMailer(), appUrl(), now);
  const sent = autoSendEnabled()
    ? await sendPayouts(db, getConnectGateway(), { now, notify: { mailer: getMailer(), appUrl: appUrl() } })
    : null;
  return { settled, reminded, sent: sent && { paid: sent.paid.length, failed: sent.failed.length } };
}
