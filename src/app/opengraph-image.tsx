import { brandCard, BRAND_CARD_ALT, OG_SIZE } from "@/lib/og-card";

export const alt = BRAND_CARD_ALT;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return brandCard();
}
