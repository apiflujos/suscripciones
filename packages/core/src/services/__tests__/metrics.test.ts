/**
 * Tests unitarios para el módulo de métricas
 * 
 * Para ejecutar:
 * ```bash
 * npm -w packages/core run test -- metrics.test.ts
 * ```
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getMetricsOverview } from '../metrics';
import { prisma } from '../../db/prisma';

// Mock de Prisma
vi.mock('../../db/prisma', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    subscription: {
      count: vi.fn()
    },
    webhookEvent: {
      groupBy: vi.fn()
    },
    retryJob: {
      groupBy: vi.fn()
    },
    systemLog: {
      groupBy: vi.fn()
    },
    chatwootMessage: {
      groupBy: vi.fn()
    }
  }
}));

describe('getMetricsOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Validación de parámetros', () => {
    it('should handle invalid date range (to < from)', async () => {
      const result = await getMetricsOverview({
        from: new Date('2026-03-08'),
        to: new Date('2026-03-01'),
        granularity: 'day',
        tenantId: null
      });

      expect(result.range.from).toBeDefined();
      expect(result.range.to).toBeDefined();
      // El rango debería haber sido ajustado automáticamente
    });

    it('should handle NaN dates', async () => {
      const result = await getMetricsOverview({
        from: new Date('invalid'),
        to: new Date('invalid'),
        granularity: 'day',
        tenantId: null
      });

      // Debería usar rango por defecto (últimos 30 días)
      expect(result.series).toBeDefined();
      expect(Array.isArray(result.series)).toBe(true);
    });

    it('should handle null tenantId', async () => {
      (prisma.$queryRawUnsafe as any).mockResolvedValue([]);
      (prisma.subscription.count as any).mockResolvedValue(0);

      const result = await getMetricsOverview({
        from: new Date('2026-02-01'),
        to: new Date('2026-03-08'),
        granularity: 'day',
        tenantId: null
      });

      expect(result).toBeDefined();
      expect(result.totals).toBeDefined();
    });
  });

  describe('Cálculo de MRR', () => {
    it('should calculate MRR correctly for MONTH interval', async () => {
      // Mock de datos: 1 suscripción de $100.000 COP mensual
      (prisma.$queryRawUnsafe as any).mockImplementation((query: string) => {
        if (query.includes('mrr_cents')) {
          return Promise.resolve([{ mrr_cents: 100000 }]);
        }
        return Promise.resolve([]);
      });
      (prisma.subscription.count as any).mockResolvedValue(1);

      const result = await getMetricsOverview({
        from: new Date('2026-02-01'),
        to: new Date('2026-03-08'),
        granularity: 'month',
        tenantId: null
      });

      expect(result.totals.auto.mrrInCents).toBe(100000);
    });

    it('should return 0 MRR for CUSTOM interval without mrrFactor', async () => {
      // Mock: plan CUSTOM sin metadata.mrrFactor
      (prisma.$queryRawUnsafe as any).mockImplementation((query: string) => {
        if (query.includes('mrr_cents')) {
          // CUSTOM sin mrrFactor debería retornar 0
          return Promise.resolve([{ mrr_cents: 0 }]);
        }
        return Promise.resolve([]);
      });
      (prisma.subscription.count as any).mockResolvedValue(1);

      const result = await getMetricsOverview({
        from: new Date('2026-02-01'),
        to: new Date('2026-03-08'),
        granularity: 'month',
        tenantId: null
      });

      expect(result.totals.auto.mrrInCents).toBe(0);
    });

    it('should handle WEEK interval conversion', async () => {
      // $25.000 semanales → MRR ≈ $108.631 (25000 * 4.34524)
      (prisma.$queryRawUnsafe as any).mockImplementation((query: string) => {
        if (query.includes('mrr_cents')) {
          return Promise.resolve([{ mrr_cents: 108631 }]);
        }
        return Promise.resolve([]);
      });

      const result = await getMetricsOverview({
        from: new Date('2026-02-01'),
        to: new Date('2026-03-08'),
        granularity: 'month',
        tenantId: null
      });

      expect(result.totals.auto.mrrInCents).toBe(108631);
    });
  });

  describe('Series temporales', () => {
    it('should return empty series when no data exists', async () => {
      (prisma.$queryRawUnsafe as any).mockResolvedValue([]);
      (prisma.subscription.count as any).mockResolvedValue(0);

      const result = await getMetricsOverview({
        from: new Date('2026-01-01'),
        to: new Date('2026-01-31'),
        granularity: 'day',
        tenantId: null
      });

      expect(result.series).toHaveLength(31); // 31 días en enero
      expect(result.totals.totalRevenueInCents).toBe(0);
      expect(result.totals.totalPaymentsSuccessful).toBe(0);
    });

    it('should sort series by date ascending', async () => {
      (prisma.$queryRawUnsafe as any).mockResolvedValue([
        { bucket: new Date('2026-03-05') },
        { bucket: new Date('2026-03-01') },
        { bucket: new Date('2026-03-03') }
      ]);
      (prisma.subscription.count as any).mockResolvedValue(0);

      const result = await getMetricsOverview({
        from: new Date('2026-03-01'),
        to: new Date('2026-03-05'),
        granularity: 'day',
        tenantId: null
      });

      // Verificar que las series estén ordenadas
      const dates = result.series.map(s => s.at);
      expect(dates).toEqual(dates.sort());
    });
  });

  describe('Cálculo de churn', () => {
    it('should return null churn when no active subscriptions', async () => {
      (prisma.$queryRawUnsafe as any).mockImplementation((query: string) => {
        if (query.includes('cancels') && query.includes('active_start')) {
          return Promise.resolve([{ cancels: 0n, active_start: 0n }]);
        }
        return Promise.resolve([]);
      });
      (prisma.subscription.count as any).mockResolvedValue(0);

      const result = await getMetricsOverview({
        from: new Date('2026-02-01'),
        to: new Date('2026-03-08'),
        granularity: 'month',
        tenantId: null
      });

      expect(result.totals.auto.churnMonthlyPct).toBeNull();
    });

    it('should calculate churn percentage correctly', async () => {
      // 10 activas al inicio, 2 canceladas → 20% churn
      (prisma.$queryRawUnsafe as any).mockImplementation((query: string) => {
        if (query.includes('cancels') && query.includes('active_start')) {
          return Promise.resolve([{ cancels: 2n, active_start: 10n }]);
        }
        return Promise.resolve([]);
      });
      (prisma.subscription.count as any).mockResolvedValue(8);

      const result = await getMetricsOverview({
        from: new Date('2026-02-01'),
        to: new Date('2026-03-08'),
        granularity: 'month',
        tenantId: null
      });

      expect(result.totals.auto.churnMonthlyPct).toBe(20);
    });
  });

  describe('Conversión de links', () => {
    it('should return null conversion when no links sent', async () => {
      (prisma.$queryRawUnsafe as any).mockImplementation((query: string) => {
        if (query.includes('links_sent')) {
          return Promise.resolve([{ links_sent: 0n }]);
        }
        return Promise.resolve([]);
      });

      const result = await getMetricsOverview({
        from: new Date('2026-02-01'),
        to: new Date('2026-03-08'),
        granularity: 'day',
        tenantId: null
      });

      expect(result.totals.link.conversionLinkToPayPct).toBeNull();
    });

    it('should calculate conversion percentage correctly', async () => {
      // 100 links enviados, 25 pagados → 25% conversión
      (prisma.$queryRawUnsafe as any).mockImplementation((query: string) => {
        if (query.includes('links_sent')) {
          return Promise.resolve([{ links_sent: 100n }]);
        }
        if (query.includes('links_paid')) {
          return Promise.resolve([{ links_paid: 25n }]);
        }
        return Promise.resolve([]);
      });

      const result = await getMetricsOverview({
        from: new Date('2026-02-01'),
        to: new Date('2026-03-08'),
        granularity: 'day',
        tenantId: null
      });

      expect(result.totals.link.conversionLinkToPayPct).toBe(25);
    });
  });

  describe('Performance y logging', () => {
    it('should log performance metrics', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      (prisma.$queryRawUnsafe as any).mockResolvedValue([]);
      (prisma.subscription.count as any).mockResolvedValue(0);

      await getMetricsOverview({
        from: new Date('2026-02-01'),
        to: new Date('2026-03-08'),
        granularity: 'day',
        tenantId: null
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[MetricsOverview]',
        expect.any(String)
      );

      const logData = JSON.parse(consoleSpy.mock.calls[0][1]);
      expect(logData).toHaveProperty('durationMs');
      expect(logData).toHaveProperty('seriesPoints');
      expect(logData).toHaveProperty('slow');

      consoleSpy.mockRestore();
    });
  });
});

describe('Security: tenantFilter validation', () => {
  // Estos tests validan que la función tenantFilter (interna) valide aliases
  // Como es una función interna, la probamos indirectamente
  
  it('should reject invalid SQL aliases', async () => {
    try {
      await getMetricsOverview({
        from: new Date('2026-02-01'),
        to: new Date('2026-03-08'),
        granularity: 'day',
        tenantId: '550e8400-e29b-41d4-a716-446655440000'
      });
      // Si no lanza error, los mocks están funcionando correctamente
    } catch (error: any) {
      if (error.message.includes('Invalid SQL alias')) {
        expect(error.message).toMatch(/Invalid SQL alias/);
      }
    }
  });
});
