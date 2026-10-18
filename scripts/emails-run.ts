/** Enroll people in email sequences and send what's due: npm run emails:run */
import { getDb } from "@/lib/db";
import { getMailer } from "@/lib/email";
import { runEmailSequences } from "@/lib/emails/engine";
import { postalAddress } from "@/lib/emails/runtime";
import { appUrl } from "@/lib/env";

runEmailSequences(getDb(), getMailer(), { appUrl: appUrl(), postalAddress: postalAddress() })
  .then((result) => {
    console.log(JSON.stringify(result));
    process.exit(result.failed ? 1 : 0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
