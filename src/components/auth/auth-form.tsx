"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/** Only allow same-site relative redirects after sign-in. */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/account";
}

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setPending(true);
    setError(null);
    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({ email, password, name: String(form.get("name")) })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Something went wrong. Please try again.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  const field = "mt-1 block w-full rounded-md border border-navy-900/20 bg-white px-3 py-2.5 text-ink";
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {mode === "sign-up" && (
        <label className="block text-sm font-medium">
          Name
          <input name="name" required autoComplete="name" className={field} />
        </label>
      )}
      <label className="block text-sm font-medium">
        Email
        <input name="email" type="email" required autoComplete="email" className={field} />
      </label>
      <label className="block text-sm font-medium">
        Password
        <input
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          className={field}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Please wait..." : mode === "sign-up" ? "Create account" : "Sign in"}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => authClient.signIn.social({ provider: "google", callbackURL: next })}
      >
        Continue with Google
      </Button>
      <p className="text-center text-sm text-muted">
        {mode === "sign-up" ? (
          <>
            Already a member? <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="underline">Sign in</Link>
          </>
        ) : (
          <>
            New here? <Link href={`/sign-up?next=${encodeURIComponent(next)}`} className="underline">Create an account</Link>
          </>
        )}
      </p>
    </form>
  );
}
