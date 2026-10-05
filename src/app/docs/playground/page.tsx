import type { Metadata } from "next";
import Playground from "./_parts/playground";

export const metadata: Metadata = {
  title: "GitHub API playground — GitDash Docs",
  description: "See the raw GitHub REST responses GitDash fetches, how each metric is computed, and the result GitDash shows.",
};

export default function PlaygroundPage() {
  return <Playground />;
}
