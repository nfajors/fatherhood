import { describe, expect, it } from "vitest";
import { renderEmail, siteLink } from "./template";

const delivery = { appUrl: "https://fatherhood.school", to: "sam@example.com", category: "learning" as const, token: "tok.en", campaign: "welcome-start" };

describe("siteLink", () => {
  it("makes site links absolute and tags them", () => {
    expect(siteLink("/academy/present-fathers#comments", "https://fatherhood.school", "c1")).toBe(
      "https://fatherhood.school/academy/present-fathers?utm_source=email&utm_medium=email&utm_campaign=c1#comments",
    );
  });

  it("leaves other sites alone", () => {
    expect(siteLink("https://example.com/x", "https://fatherhood.school", "c1")).toBe("https://example.com/x");
  });
});

describe("renderEmail", () => {
  const message = renderEmail(
    {
      subject: "Hello <there>",
      preheader: "Preview",
      heading: "Hi & welcome",
      blocks: [
        { kind: "p", text: "A <b>bold</b> claim" },
        { kind: "items", items: [{ title: "Course", href: "/academy/c", meta: "3 lessons", note: "Note" }] },
        { kind: "quote", text: "Line one\nLine two", cite: "Marcus R." },
        { kind: "button", label: "Go", href: "/learning" },
      ],
    },
    { ...delivery, postalAddress: "1 Main St, Springfield", idempotencyKey: "seq:1" },
  );

  it("escapes text in the HTML", () => {
    expect(message.html).toContain("Hi &amp; welcome");
    expect(message.html).toContain("A &lt;b&gt;bold&lt;/b&gt; claim");
    expect(message.html).not.toContain("<b>bold</b>");
    expect(message.html).toContain("Line one<br>Line two");
  });

  it("has a matching plain-text version", () => {
    expect(message.text).toContain("Hi & welcome\n\nA <b>bold</b> claim");
    expect(message.text).toContain("- Course (3 lessons)\n  Note\n  https://fatherhood.school/academy/c?utm_source=email");
    expect(message.text).toContain("> Line one\n> Line two\nMarcus R.");
    expect(message.text).toContain("Go: https://fatherhood.school/learning?utm_source=email&utm_medium=email&utm_campaign=welcome-start");
  });

  it("carries unsubscribe links, the one-click header and the postal address", () => {
    expect(message.headers).toEqual({
      "List-Unsubscribe": "<https://fatherhood.school/api/email/unsubscribe?t=tok.en&c=learning>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(message.html).toContain("https://fatherhood.school/email/unsubscribe?t=tok.en&amp;c=learning");
    expect(message.text).toContain("Unsubscribe: https://fatherhood.school/email/unsubscribe?t=tok.en&c=learning");
    expect(message.text).toContain("Fatherhood.School · 1 Main St, Springfield");
    expect(message).toMatchObject({ to: "sam@example.com", subject: "Hello <there>", idempotencyKey: "seq:1" });
  });
});
