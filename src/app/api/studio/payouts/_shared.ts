import { appUrl } from "@/lib/env";

/** Where Stripe sends creators after onboarding, and when an onboarding link has expired. */
export function onboardingUrls() {
  return {
    returnUrl: `${appUrl()}/studio/earnings?payouts=return`,
    refreshUrl: `${appUrl()}/api/studio/payouts/onboarding`,
  };
}
