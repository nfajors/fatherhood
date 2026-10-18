import { getDb } from "@/lib/db";
import { getMailer } from "@/lib/email";
import { appUrl } from "@/lib/env";
import { notifyReply } from "./replies";

/** Mailing address for the footer of opt-out email (required by CAN-SPAM before sending in production). */
export const postalAddress = () => process.env.EMAIL_POSTAL_ADDRESS ?? null;

/** Send a reply notification after the response; failures are logged, not shown to the replier. */
export async function notifyReplyInBackground(replyId: string): Promise<void> {
  try {
    await notifyReply(getDb(), getMailer(), replyId, { appUrl: appUrl(), postalAddress: postalAddress() });
  } catch (error) {
    console.error(`Reply notification failed for comment ${replyId}:`, error);
  }
}
