/**
 * The visitor's region, on the server: their choice (the region cookie) first, then
 * the country their request comes from (Cloudflare's CF-IPCountry header, or a
 * similar one from the host), then their browser language, else the US.
 */
import { cookies, headers } from "next/headers";
import { countryFromLanguages, DEFAULT_REGION, REGIONS, regionForCountry, type Region, type RegionCode } from "./regions";

export const REGION_COOKIE = "fs_region";

export async function currentRegion(): Promise<Region> {
  const chosen = (await cookies()).get(REGION_COOKIE)?.value;
  if (chosen && chosen in REGIONS) return REGIONS[chosen as RegionCode];
  const h = await headers();
  const country = h.get("cf-ipcountry") ?? h.get("x-vercel-ip-country") ?? h.get("x-country-code") ?? countryFromLanguages(h.get("accept-language"));
  return country ? regionForCountry(country) : DEFAULT_REGION;
}
