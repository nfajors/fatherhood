import { describe, expect, it } from "vitest";
import { fellowDecisionEmail } from "./emails";

const base = { name: "Sam <b>", email: "sam@test.dev", notes: null, studioUrl: "https://fatherhood.school/studio" };

describe("fellowDecisionEmail", () => {
  it("welcomes approved Fellows with a Studio link", () => {
    const email = fellowDecisionEmail({ ...base, decision: "approved" });
    expect(email.subject).toBe("Welcome to the Fatherhood.School Fellows");
    expect(email.html).toContain('href="https://fatherhood.school/studio"');
    expect(email.text).toContain("Open your Studio: https://fatherhood.school/studio");
  });

  it("declines with the reason, escaping user text", () => {
    const email = fellowDecisionEmail({ ...base, decision: "rejected", notes: "Share a <script>sample</script>" });
    expect(email.html).toContain("Sam &lt;b&gt;");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("Open your Studio");
    expect(email.text).toContain("Why:\nShare a <script>sample</script>");
  });
});
