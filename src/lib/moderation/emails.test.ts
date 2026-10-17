import { describe, expect, it } from "vitest";
import { decisionEmail } from "./emails";

const base = { creatorName: "James", creatorEmail: "james@example.com", videoTitle: "Bedtime <stories>", notes: null };

describe("decisionEmail", () => {
  it("writes each decision", () => {
    expect(decisionEmail({ ...base, decision: "approved" }).subject).toBe('Your video "Bedtime <stories>" is live');
    expect(decisionEmail({ ...base, decision: "changes_requested", notes: "Trim the intro." }).text).toContain("What to change:\nTrim the intro.");
    expect(decisionEmail({ ...base, decision: "rejected", notes: "Off topic." }).text).toContain("Why:\nOff topic.");
    expect(decisionEmail({ ...base, decision: "unpublished", notes: "Reported." }).subject).toBe('Your video "Bedtime <stories>" has been taken down');
  });

  it("escapes titles and notes in HTML", () => {
    const email = decisionEmail({ ...base, decision: "rejected", notes: "<script>x</script>" });
    expect(email.to).toBe("james@example.com");
    expect(email.html).toContain("Bedtime &lt;stories&gt;");
    expect(email.html).not.toContain("<script>");
  });

  it("omits the notes block when there are none", () => {
    expect(decisionEmail({ ...base, decision: "approved" }).html).not.toContain("<blockquote");
  });
});
