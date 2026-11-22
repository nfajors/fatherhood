/** Production wiring for organizations: Stripe invoicing. */
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import type { OrgBilling } from "./service";

/** Invoices carry this so the webhook can tell a contract's invoice from a membership's. */
export const CONTRACT_INVOICE_KIND = "organization_contract";

export function contractIdFromInvoice(invoice: Stripe.Invoice): string | null {
  return invoice.metadata?.kind === CONTRACT_INVOICE_KIND && invoice.metadata.contractId ? invoice.metadata.contractId : null;
}

export const stripeOrgBilling: OrgBilling = {
  async ensureCustomer(org) {
    if (org.stripeCustomerId) return org.stripeCustomerId;
    const customer = await getStripe().customers.create(
      { name: org.name, email: org.contactEmail, metadata: { organizationId: org.id, contactName: org.contactName ?? "" } },
      { idempotencyKey: `org-customer-${org.id}` },
    );
    return customer.id;
  },

  /** One invoice per contract; each step's idempotency key makes a retried send safe. */
  async sendInvoice({ customerId, contractId, amountCents, description, daysUntilDue }) {
    const stripe = getStripe();
    const metadata = { kind: CONTRACT_INVOICE_KIND, contractId };
    const draft = await stripe.invoices.create(
      { customer: customerId, collection_method: "send_invoice", days_until_due: daysUntilDue, auto_advance: false, pending_invoice_items_behavior: "exclude", description, metadata },
      { idempotencyKey: `org-invoice-${contractId}` },
    );
    await stripe.invoiceItems.create(
      { customer: customerId, invoice: draft.id, amount: amountCents, currency: "usd", description, metadata },
      { idempotencyKey: `org-invoice-item-${contractId}` },
    );
    const finalized = await stripe.invoices.finalizeInvoice(draft.id!, {}, { idempotencyKey: `org-invoice-finalize-${contractId}` });
    const sent = await stripe.invoices.sendInvoice(finalized.id!, {}, { idempotencyKey: `org-invoice-send-${contractId}` });
    return { invoiceId: sent.id!, invoiceUrl: sent.hosted_invoice_url ?? null };
  },

  async voidInvoice(invoiceId) {
    await getStripe().invoices.voidInvoice(invoiceId);
  },
};
