/** Production wiring for discussions: reply emails, sent after the response so posting stays fast. */
import { getDb } from "@/lib/db";
import { getMailer } from "@/lib/email";
import { postalAddress } from "@/lib/emails/runtime";
import { appUrl } from "@/lib/env";
import { notifyPostReply } from "./emails";

export async function sendReplyNotice(replyId: string): Promise<void> {
  try {
    await notifyPostReply(getDb(), getMailer(), replyId, { appUrl: appUrl(), postalAddress: postalAddress() });
  } catch (error) {
    console.error(`Reply notice for post ${replyId} failed`, error);
  }
}
