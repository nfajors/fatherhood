import { describe, expect, it } from "vitest";
import { payoutSentEmail, payoutSetupEmail } from "./emails";

const base = { name: "James <J>", email: "james@example.com", amountCents: 42_50, earningsUrl: "https://fatherhood.school/studio/earnings" };

describe("payout emails", () => {
  it("announces a sent payout", () => {
    const email = payoutSentEmail(base);
    expect(email.to).toBe("james@example.com");
    expect(email.subject).toBe("Your Fatherhood.School payout of $42.50 is on its way");
    expect(email.text).toContain("See your earnings: https://fatherhood.school/studio/earnings");
    expect(email.html).toContain("James &lt;J&gt;");
  });

  it("asks for setup, or to finish it", () => {
    expect(payoutSetupEmail({ ...base, started: false }).text).toContain("Set up payouts: https://");
    expect(payoutSetupEmail({ ...base, started: true }).text).toContain("Finish setting up payouts: https://");
    expect(payoutSetupEmail({ ...base, started: false }).subject).toBe("$42.50 is waiting for you on Fatherhood.School");
  });
});
