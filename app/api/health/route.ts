import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "echolocation-audio-sim",
      timestamp: new Date().toISOString()
    },
    { status: 200 }
  );
}
