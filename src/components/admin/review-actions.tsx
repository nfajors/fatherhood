"use client";

import { ErrorText, useApiAction } from "@/components/use-api-action";
import { Button } from "@/components/ui/button";

export function ReviewVisibilityButton({ ratingId, hidden }: { ratingId: string; hidden: boolean }) {
  const { pending, error, run } = useApiAction();
  return (
    <>
      <Button type="button" size="sm" variant={hidden ? "outline" : "ghost"} disabled={pending} onClick={() => run(`/api/admin/reviews/${ratingId}`, "PATCH", { hidden: !hidden })}>
        {hidden ? "Restore" : "Hide review"}
      </Button>
      <ErrorText error={error} />
    </>
  );
}
