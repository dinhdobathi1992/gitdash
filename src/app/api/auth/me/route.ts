import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAppMode, isStandaloneMode } from "@/lib/mode";
import { getOctokit } from "@/lib/github";

export async function GET() {
  const mode = getAppMode();

  if (isStandaloneMode()) {
    try {
      const session = await getSession();
      if (!session.pat) {
        return NextResponse.json({ user: null, mode }, { status: 401 });
      }
      // Use cached user from session if available; otherwise re-fetch
      if (session.user) {
        return NextResponse.json({ user: session.user, mode });
      }
      // Re-hydrate from GitHub (e.g. session was created without user cached)
      const octokit = getOctokit(session.pat);
      const { data } = await octokit.rest.users.getAuthenticated();
      const user = {
        login: data.login,
        name: data.name ?? null,
        avatar_url: data.avatar_url,
        email: data.email ?? null,
      };
      session.user = user;
      await session.save();
      return NextResponse.json({ user, mode });
    } catch {
      return NextResponse.json({ user: null, mode }, { status: 401 });
    }
  }

  // Team mode: read from OAuth session
  try {
    const session = await getSession();
    if (!session.user || !session.accessToken) {
      return NextResponse.json({ user: null, mode }, { status: 401 });
    }
    return NextResponse.json({ user: session.user, mode });
  } catch {
    return NextResponse.json({ user: null, mode }, { status: 401 });
  }
}
