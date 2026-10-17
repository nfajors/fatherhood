"use client";

import { createAuthClient } from "better-auth/react";

/** Browser-side Better Auth client (same origin as the API route). */
export const authClient = createAuthClient();
