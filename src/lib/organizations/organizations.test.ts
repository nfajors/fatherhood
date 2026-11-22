import { describe, expect, it } from "vitest";
import { newJoinCode, normalizeJoinCode, parseEmails } from "./codes";
import { inviteEmail } from "./emails";
import { totalsCoverage } from "./reports";
import { accessWindow } from "./service";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const c = (status: "draft" | "invoiced" | "paid" | "void", start: string, end: string, seats = 10) => ({ status, startsAt: d(start), endsAt: d(end), seats });

describe("accessWindow", () => {
  const now = d("2026-11-22");

  it("gives access through the current term, counting invoiced contracts and not drafts or voids", () => {
    expect(accessWindow([c("invoiced", "2026-01-01", "2027-01-01")], now)).toEqual({ activeUntil: d("2027-01-01"), seats: 10, startsAt: null });
    expect(accessWindow([c("draft", "2026-01-01", "2027-01-01"), c("void", "2026-01-01", "2027-01-01")], now)).toEqual({ activeUntil: null, seats: 0, startsAt: null });
  });

  it("follows a renewal that starts when the term ends, and adds seats from contracts in force together", () => {
    const contracts = [c("paid", "2026-01-01", "2027-01-01", 20), c("invoiced", "2027-01-01", "2028-01-01", 25), c("paid", "2026-06-01", "2027-01-01", 5)];
    expect(accessWindow(contracts, now)).toEqual({ activeUntil: d("2028-01-01"), seats: 25, startsAt: null });
  });

  it("doesn't bridge a gap between terms", () => {
    expect(accessWindow([c("paid", "2026-01-01", "2026-12-01"), c("paid", "2027-02-01", "2028-02-01")], now).activeUntil).toEqual(d("2026-12-01"));
  });

  it("reports a contract that hasn't started yet", () => {
    expect(accessWindow([c("invoiced", "2027-01-01", "2028-01-01", 30)], now)).toEqual({ activeUntil: null, seats: 30, startsAt: d("2027-01-01") });
  });
});

describe("codes", () => {
  it("reads a pasted list of addresses", () => {
    expect(parseEmails("Dad@Example.com, sam@test.org;\n <lee@x.co>  dad@example.com not-an-email")).toEqual({
      valid: ["dad@example.com", "sam@test.org", "lee@x.co"],
      invalid: ["not-an-email"],
    });
  });

  it("makes and reads join codes", () => {
    const code = newJoinCode(() => 0);
    expect(code).toBe("ORG-2222-2222");
    expect(normalizeJoinCode(" org 2222 2222 ")).toBe("ORG-2222-2222");
    expect(normalizeJoinCode("ORG-2222-222O")).toBeNull();
  });
});

describe("totalsCoverage", () => {
  it("leaves a small private group out of the totals", () => {
    expect(totalsCoverage(10, 0)).toBe("everyone");
    expect(totalsCoverage(10, 1)).toBe("sharing_only");
    expect(totalsCoverage(10, 4)).toBe("sharing_only");
    expect(totalsCoverage(10, 5)).toBe("everyone");
  });
});

describe("inviteEmail", () => {
  it("tells a father what he gets and that sharing is his choice", () => {
    const email = inviteEmail({ email: "dad@example.com", organization: "Dads <United>", asManager: false, link: "https://fs.test/join/abc", expiresOn: "Dec 22, 2026" });
    expect(email.subject).toBe("Dads <United> has given you Fatherhood.School");
    expect(email.text).toContain("you choose whether Dads <United> can see your name and progress");
    expect(email.text).toContain("Accept and join: https://fs.test/join/abc");
    expect(email.html).toContain("Dads &lt;United&gt;");
    expect(inviteEmail({ email: "m@x.co", organization: "A", asManager: true, link: "l", expiresOn: "x" }).subject).toBe("Manage A on Fatherhood.School");
  });
});
