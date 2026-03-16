import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@wompi/database';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const take = Math.min(200, Math.max(1, Number(searchParams.get('take') || 20)));
    const skip = Math.max(0, Number(searchParams.get('skip') || 0));
    const q = searchParams.get('q') || '';

    const where: any = {};
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } }
      ];
    }

    const [items, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip
      }),
      prisma.customer.count({ where })
    ]);

    return NextResponse.json({ items, total });
  } catch (error) {
    console.error('[API/GET /customers]', error);
    return NextResponse.json(
      { error: 'Failed to fetch customers' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, phone, metadata } = body;

    const customer = await prisma.customer.create({
      data: {
        name,
        email,
        phone,
        metadata,
        tenantId: body.tenantId || 'default'
      }
    });

    return NextResponse.json({ ok: true, customer });
  } catch (error) {
    console.error('[API/POST /customers]', error);
    return NextResponse.json(
      { error: 'Failed to create customer' },
      { status: 500 }
    );
  }
}
