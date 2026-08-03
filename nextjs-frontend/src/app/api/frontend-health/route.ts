import { NextResponse } from 'next/server';

const BUILD_REVISION = /^[a-f0-9]{40}$/.test(
  process.env.AI_GEO_BUILD_REVISION || ''
)
  ? process.env.AI_GEO_BUILD_REVISION
  : null;

export function GET() {
  return NextResponse.json({
    status: 'OK',
    revision: BUILD_REVISION,
  });
}
