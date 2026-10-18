"use client";

import { ErrorText, useApiAction } from "@/components/use-api-action";
import { Button } from "@/components/ui/button";

export function CommentModerationButtons({ commentId, status }: { commentId: string; status: string }) {
  const { pending, error, run } = useApiAction();
  const act = (action: "hide" | "restore" | "remove") => run(`/api/admin/comments/${commentId}`, "PATCH", { action });
  return (
    <div className="flex flex-wrap items-center gap-1">
      {status === "hidden" ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => act("restore")}>
          Restore
        </Button>
      ) : (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => act("hide")}>
          Hide
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="text-red-700"
        disabled={pending}
        onClick={() => {
          if (window.confirm("Remove this comment for good?")) act("remove");
        }}
      >
        Remove
      </Button>
      <ErrorText error={error} />
    </div>
  );
}
