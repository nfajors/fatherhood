import { z } from "zod";

/**
 * Environment access, validated per integration and only when first used, so
 * `next build` and unit tests run without every secret configured.
 */

function parse<T extends z.ZodRawShape>(name: string, shape: T): z.infer<z.ZodObject<T>> {
  const result = z.object(shape).safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Missing or invalid ${name} environment variables: ${missing}`);
  }
  return result.data;
}

const required = z.string().min(1);

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export function databaseEnv() {
  return parse("database", { DATABASE_URL: required });
}

export function authEnv() {
  return parse("auth", {
    BETTER_AUTH_SECRET: required,
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
  });
}

export function stripeEnv() {
  return parse("Stripe", {
    STRIPE_SECRET_KEY: required,
    STRIPE_WEBHOOK_SECRET: required,
    STRIPE_PRICE_MONTHLY: required,
    STRIPE_PRICE_ANNUAL: required,
  });
}

export function streamEnv() {
  return parse("Cloudflare Stream", {
    CLOUDFLARE_ACCOUNT_ID: required,
    CLOUDFLARE_STREAM_API_TOKEN: required,
    CLOUDFLARE_STREAM_CUSTOMER_CODE: required,
    CLOUDFLARE_STREAM_SIGNING_KEY_ID: required,
    CLOUDFLARE_STREAM_SIGNING_KEY_JWK: required,
    CLOUDFLARE_STREAM_WEBHOOK_SECRET: required,
    CLOUDFLARE_STREAM_WATERMARK_UID: z.string().optional(),
  });
}

/**
 * Whether the AI theme classifier can run. The Anthropic SDK reads
 * ANTHROPIC_API_KEY itself; without it, content is left unthemed for admins.
 */
export function themeClassifierConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
