import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@wompi/database';
import { PaymentStatus } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const take = Math.min(200, Math.max(1, Number(searchParams.get('take') || 20)));
    const skip = Math.max(0, Number(searchParams.get('skip') || 0));
    const status = searchParams.get('status')?.toUpperCase();
    const q = searchParams.get('q') || '';
    
    const statusFilter = status === 'APPROVED' 
      ? ['APPROVED'] 
      : status === 'PENDING' 
        ? ['PENDING'] 
        : status === 'FAILED' 
          ? ['DECLINED', 'ERROR', 'VOIDED'] 
          : null;

    const where: any = {};
    if (statusFilter) where.status = { in: statusFilter };
    if (q) {
      where.OR = [
        { reference: { contains: q, mode: 'insensitive' } },
        { wompiTransactionId: { contains: q, mode: 'insensitive' } }
      ];
    }

    const [items, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          subscription: { include: { plan: true, customer: true } },
          customer: true
        }
      }),
      prisma.payment.count({ where })
    ]);

    return NextResponse.json({ items, total });
  } catch (error) {
    console.error('[API/GET /payments]', error);
    return NextResponse.json(
      { error: 'Failed to fetch payments' },
      { status: 500 }
    );
  }
}
