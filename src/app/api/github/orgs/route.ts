import { NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { listUserOrgs } from "@/lib/github";
import { safeError } from "@/lib/validation";

const CACHE_TTL = 120;

export async function GET() {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const orgs = await listUserOrgs(token);
    return NextResponse.json(orgs, {
      headers: { "Cache-Control": `private, s-maxage=${CACHE_TTL}, stale-while-revalidate=240` },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch organizations");
  }
}
