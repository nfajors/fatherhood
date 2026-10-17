import { afterEach, describe, expect, it, vi } from "vitest";
import { appUrl, stripeEnv } from "./env";

afterEach(() => vi.unstubAllEnvs());

describe("env", () => {
  it("names every missing variable", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect(() => stripeEnv()).toThrowError(/STRIPE_SECRET_KEY.*STRIPE_WEBHOOK_SECRET/);
  });

  it("returns validated values", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "wh");
    vi.stubEnv("STRIPE_PRICE_MONTHLY", "pm");
    vi.stubEnv("STRIPE_PRICE_ANNUAL", "pa");
    expect(stripeEnv()).toMatchObject({ STRIPE_SECRET_KEY: "sk", STRIPE_PRICE_ANNUAL: "pa" });
  });

  it("defaults the app URL for local development", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined as unknown as string);
    expect(appUrl()).toBe("http://localhost:3000");
  });
});
