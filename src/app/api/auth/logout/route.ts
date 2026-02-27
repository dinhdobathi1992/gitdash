import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isStandaloneMode } from "@/lib/mode";

// POST — destroy session. Using POST instead of GET prevents logout CSRF
// (a cross-site <img> or <link> tag cannot trigger a cross-origin POST).
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    session.destroy();
  } catch {
    // Ignore — proceed to redirect regardless
  }
  // standalone → back to setup; organization → back to login
  const dest = isStandaloneMode() ? "/setup" : "/login";
  return NextResponse.redirect(new URL(dest, req.url));
}
