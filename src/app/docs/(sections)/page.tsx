import type { Metadata } from "next";
import { DocPage, docMetadata } from "./doc-page";
import { HOME_SECTION } from "../_parts/nav";

const TITLE = "GitDash Docs — set up, run and read every metric";
const DESCRIPTION =
  "How to deploy GitDash, sign in, control access, and read every DORA, pull-request, workflow and team metric it shows.";

export const metadata: Metadata = {
  ...docMetadata(HOME_SECTION),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/docs", type: "website" },
};

export default function DocsHomePage() {
  return <DocPage id={HOME_SECTION} />;
}
