import { ogCard, OG_SIZE } from "@/lib/og-card";

export const alt = "GitDash Docs — set up, run and read every metric.";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogCard({
    eyebrow: "Docs",
    title: "Set up, run and read",
    accent: "every metric.",
    subtitle: "Deployment, access control and the definition of every number GitDash shows.",
  });
}
