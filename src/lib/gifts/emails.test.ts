import { describe, expect, it } from "vitest";
import { purchaserEmail, recipientEmail, redeemUrl, type GiftForEmail } from "./emails";

const gift: GiftForEmail = {
  code: "FATHER-ABCD-2345",
  plan: "annual",
  purchaserName: "Marcus",
  purchaserEmail: "marcus@example.com",
  recipientName: "Dad",
  recipientEmail: "dad@example.com",
  message: "Happy Father's Day.\nThank you for everything.",
  delivery: "email",
  deliverAt: null,
};
const APP = "https://fatherhood.school";

describe("recipientEmail", () => {
  it("addresses the recipient, says who it's from and links to redemption", () => {
    const email = recipientEmail(gift, APP);
    expect(email.to).toBe("dad@example.com");
    expect(email.replyTo).toBe("marcus@example.com");
    expect(email.subject).toBe("Marcus gave you 1 year of Fatherhood.School");
    expect(email.html).toContain("https://fatherhood.school/redeem?code=FATHER-ABCD-2345");
    expect(email.html).toContain("Happy Father&#39;s Day.<br>Thank you for everything.");
    expect(email.text).toContain("Gift code: FATHER-ABCD-2345");
    expect(email.text).toContain(`"Happy Father's Day.\nThank you for everything."`);
  });

  it("escapes everything the purchaser typed", () => {
    const email = recipientEmail({ ...gift, purchaserName: "<b>Evil</b>", recipientName: "<script>x</script>", message: `<img src=x onerror="a">` }, APP);
    expect(email.html).not.toMatch(/<script>|<img|<b>Evil/);
    expect(email.html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;a&quot;&gt;");
  });

  it("omits the message block when there is none, and names a monthly gift correctly", () => {
    const email = recipientEmail({ ...gift, plan: "monthly", message: null }, APP);
    expect(email.html).not.toContain("<blockquote");
    expect(email.subject).toBe("Marcus gave you 1 month of Fatherhood.School");
  });

  it("refuses to build an email without a recipient address", () => {
    expect(() => recipientEmail({ ...gift, delivery: "self", recipientEmail: null }, APP)).toThrow();
  });
});

describe("purchaserEmail", () => {
  it("describes immediate, scheduled and self delivery", () => {
    expect(purchaserEmail(gift, APP).text).toContain("We've emailed it to Dad.");
    const scheduled = purchaserEmail({ ...gift, deliverAt: new Date(Date.now() + 10 * 86_400_000) }, APP);
    expect(scheduled.text).toMatch(/We'll email it to Dad on [A-Z][a-z]+ \d{1,2}, \d{4}\./);
    expect(purchaserEmail({ ...gift, delivery: "self", recipientEmail: null }, APP).text).toContain(
      "Here is the code to give to Dad however you like",
    );
  });

  it("goes to the purchaser with the code", () => {
    const email = purchaserEmail(gift, APP);
    expect(email.to).toBe("marcus@example.com");
    expect(email.subject).toBe("Your gift of Fatherhood.School for Dad");
    expect(email.text).toContain("Gift code: FATHER-ABCD-2345");
  });

  it("escapes the recipient name in HTML but not in plain text", () => {
    const email = purchaserEmail({ ...gift, recipientName: "Tom & Jerry" }, APP);
    expect(email.html).toContain("Tom &amp; Jerry");
    expect(email.text).toContain("Tom & Jerry");
  });
});

describe("redeemUrl", () => {
  it("encodes the code", () => {
    expect(redeemUrl(APP, "A B")).toBe("https://fatherhood.school/redeem?code=A%20B");
  });
});
