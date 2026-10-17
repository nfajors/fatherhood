/** Send scheduled gift emails that are due (and retry failures): npm run gifts:deliver */
import { getDb } from "@/lib/db";
import { getMailer } from "@/lib/email";
import { appUrl } from "@/lib/env";
import { deliverDueGifts } from "@/lib/gifts/service";

deliverDueGifts(getDb(), getMailer(), appUrl())
  .then(({ delivered, failed }) => {
    console.log(`Delivered ${delivered.length} gifts${failed.length ? `, ${failed.length} failed (will retry)` : ""}.`);
    process.exit(failed.length ? 1 : 0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
