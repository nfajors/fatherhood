import type { Metadata } from "next";

export const metadata: Metadata = { title: "Community Voices" };

export default function CommunityPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-semibold">Community Voices</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        Short stories and practical lessons from approved fathers, free for everyone. Our founding Fellows are
        recording now.
      </p>
    </div>
  );
}
