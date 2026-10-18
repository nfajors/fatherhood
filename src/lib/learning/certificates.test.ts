import { describe, expect, it } from "vitest";
import { certificateCode, linkedInAddUrl } from "./certificates";

describe("certificateCode", () => {
  it("formats eight unambiguous characters", () => {
    for (let i = 0; i < 200; i++) expect(certificateCode()).toMatch(/^FS-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  });

  it("maps bytes onto the alphabet", () => {
    expect(certificateCode(Buffer.from([0, 1, 2, 3, 30, 31, 62, 255]))).toBe("FS-2345-Z229");
  });
});

describe("linkedInAddUrl", () => {
  it("prefills the certification form", () => {
    const url = new URL(
      linkedInAddUrl({ code: "FS-ABCD-EFGH", courseTitle: "Present Fathers", issuedAt: new Date("2026-10-18T12:00:00Z") }, "https://fatherhood.school/certificates/FS-ABCD-EFGH", "Fatherhood.School"),
    );
    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/profile/add");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      startTask: "CERTIFICATION_NAME",
      name: "Present Fathers",
      organizationName: "Fatherhood.School",
      issueYear: "2026",
      issueMonth: "10",
      certUrl: "https://fatherhood.school/certificates/FS-ABCD-EFGH",
      certId: "FS-ABCD-EFGH",
    });
  });
});
