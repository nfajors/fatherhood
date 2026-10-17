import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { getDb, schema } from "@/lib/db";
import type { UserRole } from "@/lib/db/schema";
import { appUrl, authEnv } from "@/lib/env";

function createAuth() {
  const env = authEnv();
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : undefined;

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL ?? appUrl(),
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    socialProviders: google,
    user: {
      additionalFields: {
        // Never settable from sign-up; admins grant creator/admin roles.
        role: { type: "string", required: false, defaultValue: "user", input: false },
        stripeCustomerId: { type: "string", required: false, input: false },
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

/** Lazily constructed Better Auth instance. */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  stripeCustomerId: string | null;
};

/** The signed-in user for the current request, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const result = await getAuth().api.getSession({ headers: await headers() });
  if (!result) return null;
  const u = result.user as typeof result.user & { role?: string; stripeCustomerId?: string | null };
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: (u.role as UserRole | undefined) ?? "user",
    stripeCustomerId: u.stripeCustomerId ?? null,
  };
}
