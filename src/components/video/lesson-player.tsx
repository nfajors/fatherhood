"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { VideoPlayer, type VideoPlayerProps } from "./video-player";

/**
 * Lesson player plus "mark complete" and "up next". Completion updates in
 * place rather than refreshing the page, which would reload the player.
 */
export function LessonPlayer({
  initialCompleted,
  canTrack,
  next,
  ...player
}: Omit<VideoPlayerProps, "onCompleted"> & {
  initialCompleted: boolean;
  /** Signed in, so completion can be saved. */
  canTrack: boolean;
  next: { href: string; title: string } | null;
}) {
  const [completed, setCompleted] = useState(initialCompleted);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setSaving(true);
    const res = await fetch(`/api/videos/${player.videoId}/progress`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: !completed }),
    });
    if (res.ok) setCompleted(!completed);
    setSaving(false);
  }

  return (
    <div>
      <VideoPlayer {...player} onCompleted={() => setCompleted(true)} />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        {canTrack ? (
          <Button size="sm" variant={completed ? "outline" : "secondary"} onClick={toggle} disabled={saving} aria-pressed={completed}>
            {completed ? "✓ Completed" : "Mark as complete"}
          </Button>
        ) : (
          <span />
        )}
        {next && (
          <Button asChild size="sm" variant={completed ? "primary" : "ghost"}>
            <Link href={next.href}>Up next: {next.title} →</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
