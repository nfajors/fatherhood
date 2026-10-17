import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold">Sign in</h1>
      <div className="mt-8">
        <Suspense>
          <AuthForm mode="sign-in" />
        </Suspense>
      </div>
    </div>
  );
}
