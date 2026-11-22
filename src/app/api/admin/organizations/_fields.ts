import { z } from "zod";
import { organizationKind } from "@/lib/db/schema";

/** An organization's details, as admins edit them. */
export const orgFields = z.object({
  name: z.string().trim().min(2, "Give the organization a name.").max(120),
  kind: z.enum(organizationKind.enumValues),
  contactName: z.string().trim().max(120).nullable(),
  contactEmail: z.email("Enter the billing contact's email.").max(200),
});
