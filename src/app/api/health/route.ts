import { NextResponse } from "next/server";

/** Lightweight liveness / readiness probe endpoint. */
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
