import { NextRequest, NextResponse } from 'next/server';
import { getSettings, updateSettings } from '@/lib/runtimeConfig';

export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('[API/GET /settings]', error);
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    await updateSettings(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[API/POST /settings]', error);
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}
