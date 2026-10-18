import { describe, expect, it } from "vitest";
import { emailToken, verifyEmailToken } from "./tokens";

const KEY = "test-secret";

describe("email tokens", () => {
  it("round-trips a user id", () => {
    const token = emailToken("user_123", KEY);
    expect(verifyEmailToken(token, KEY)).toBe("user_123");
    expect(token).toMatch(/^[\w-]+\.[\w-]{32}$/);
  });

  it("rejects forged, altered and malformed tokens", () => {
    const token = emailToken("user_123", KEY);
    const [, signature] = token.split(".");
    expect(verifyEmailToken(`${Buffer.from("user_999").toString("base64url")}.${signature}`, KEY)).toBeNull();
    expect(verifyEmailToken(token, "other-secret")).toBeNull();
    expect(verifyEmailToken(token.slice(0, -1), KEY)).toBeNull();
    for (const bad of [null, undefined, "", "nodot", ".sig", "abc."]) expect(verifyEmailToken(bad, KEY)).toBeNull();
  });
});
