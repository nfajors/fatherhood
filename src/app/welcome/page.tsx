import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Welcome" };

export default function WelcomePage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
      <h1 className="text-4xl font-semibold">Welcome to Fatherhood.School</h1>
      <p className="mt-4 text-lg text-muted">
        Your membership is active. It can take a moment for payment confirmation to reach us.
      </p>
      <Button asChild className="mt-8">
        <Link href="/academy">Start learning</Link>
      </Button>
    </div>
  );
}
