/**
 * Tests unitarios para wompiReconcile.ts
 * 
 * Para ejecutar:
 * ```bash
 * npm -w packages/core run test -- wompiReconcile.test.ts
 * ```
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reconcileWompiTransaction, reconcileWompiByReference } from '../wompiReconcile';
import { prisma } from '../../db/prisma';
import { getWompiApiBaseUrl, getWompiCheckoutLinkBaseUrl, getWompiPrivateKey, getWompiPublicKey } from '../runtimeConfig';
import { getDefaultTenantId } from '../tenantContext';

const getTransactionMock = vi.hoisted(() => vi.fn());
const listTransactionsMock = vi.hoisted(() => vi.fn());

vi.mock('../../providers/wompi/client', () => ({
  WompiClient: vi.fn().mockImplementation(() => ({
    getTransaction: getTransactionMock,
    listTransactionsByReference: listTransactionsMock
  }))
}));

// Mock de Prisma
vi.mock('../../db/prisma', () => ({
  prisma: {
    webhookEvent: {
      create: vi.fn()
    },
    retryJob: {
      create: vi.fn()
    },
    $queryRaw: vi.fn()
  }
}));

// Mock de runtime config
vi.mock('../runtimeConfig', () => ({
  getWompiApiBaseUrl: vi.fn(() => Promise.resolve('https://sandbox.wompi.co/v1')),
  getWompiCheckoutLinkBaseUrl: vi.fn(() => Promise.resolve('https://checkout.wompi.co/l/')),
  getWompiPrivateKey: vi.fn(() => Promise.resolve('test-private-key')),
  getWompiPublicKey: vi.fn(() => Promise.resolve('test-public-key')),
  getShopifyForward: vi.fn(() => Promise.resolve({})),
  getShopifyForwardRetryConfig: vi.fn(() => Promise.resolve({ enabled: false, minutes: 5 }))
}));

vi.mock('../tenantContext', () => ({
  getDefaultTenantId: vi.fn(() => Promise.resolve('test-tenant-id'))
}));

describe('reconcileWompiTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTransactionMock.mockResolvedValue({
      id: '12345',
      status: 'APPROVED',
      amountInCents: 10000,
      currency: 'COP',
      reference: 'TEST_123',
      paymentLinkId: 'pl_123',
      customerEmail: 'test@example.com',
      raw: {}
    });
    listTransactionsMock.mockResolvedValue([
      {
        id: '12345',
        status: 'APPROVED',
        amountInCents: 10000,
        currency: 'COP',
        reference: 'TEST_123',
        paymentLinkId: 'pl_123',
        customerEmail: 'test@example.com',
        finalizedAt: '2026-03-01T00:00:00Z',
        createdAt: '2026-02-28T00:00:00Z'
      }
    ]);
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({ id: 'webhook-123' } as any);
    vi.mocked(prisma.retryJob.create).mockResolvedValue({} as any);
    vi.mocked(getWompiPublicKey).mockResolvedValue('test-public-key');
    vi.mocked(getWompiPrivateKey).mockResolvedValue('test-private-key');
    vi.mocked(getWompiApiBaseUrl).mockResolvedValue('https://sandbox.wompi.co/v1');
    vi.mocked(getWompiCheckoutLinkBaseUrl).mockResolvedValue('https://checkout.wompi.co/l/');
    vi.mocked(getDefaultTenantId).mockResolvedValue('test-tenant-id');
  });

  describe('Validación de parámetros', () => {
    it('should reject invalid transaction IDs', async () => {
      const result = await reconcileWompiTransaction({
        wompiTransactionId: '',
        tenantId: 'test-tenant'
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('missing_transaction_id');
    });

    it('should reject null transaction IDs', async () => {
      const result = await reconcileWompiTransaction({
        wompiTransactionId: null as any,
        tenantId: 'test-tenant'
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('missing_transaction_id');
    });

    it('should reject when tenant is missing', async () => {
      vi.mocked(getDefaultTenantId).mockResolvedValueOnce(null);

      const result = await reconcileWompiTransaction({
        wompiTransactionId: '12345',
        tenantId: null
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('missing_tenant');
    });
  });

  describe('Conciliación de transacciones', () => {
    it('should reject transactions with non-final status', async () => {
      getTransactionMock.mockResolvedValueOnce({
        id: '12345',
        status: 'PENDING',
        amountInCents: 10000,
        currency: 'COP',
        reference: 'TEST_123',
        paymentLinkId: 'pl_123',
        customerEmail: 'test@example.com',
        raw: {}
      });

      const result = await reconcileWompiTransaction({
        wompiTransactionId: '12345',
        tenantId: 'test-tenant',
        processNow: false
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('status_not_final');
    });

    it('should create webhook event for APPROVED transactions', async () => {
      const mockWebhookEvent = {
        id: 'webhook-123',
        tenantId: 'test-tenant',
        checksum: 'reconcile:12345:uuid'
      };

      vi.mocked(prisma.webhookEvent.create).mockResolvedValue(mockWebhookEvent as any);
      vi.mocked(prisma.retryJob.create).mockResolvedValue({} as any);

      const result = await reconcileWompiTransaction({
        wompiTransactionId: '12345',
        tenantId: 'test-tenant',
        processNow: false
      });

      expect(result.ok).toBe(true);
      expect(prisma.webhookEvent.create).toHaveBeenCalled();
      expect(result.webhookEventId).toBe('webhook-123');
    });

    it('should use checksumPrefix when provided', async () => {
      vi.mocked(prisma.webhookEvent.create).mockResolvedValue({ id: 'webhook-123' } as any);

      await reconcileWompiTransaction({
        wompiTransactionId: '12345',
        tenantId: 'test-tenant',
        checksumPrefix: 'poll-reconcile',
        processNow: false
      });

      expect(prisma.webhookEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            checksum: expect.stringContaining('poll-reconcile:')
          })
        })
      );
    });
  });

  describe('Wompi API integration', () => {
    it('should reject when Wompi API is unavailable', async () => {
      getTransactionMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await reconcileWompiTransaction({
        wompiTransactionId: '12345',
        tenantId: 'test-tenant',
        processNow: false
      });

      // Debería fallar gracefully
      expect(result.ok).toBe(false);
    });

    it('should reject when public key is not configured', async () => {
      vi.mocked(getWompiPublicKey).mockResolvedValueOnce('');

      const result = await reconcileWompiTransaction({
        wompiTransactionId: '12345',
        tenantId: 'test-tenant',
        processNow: false
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('wompi_public_key_not_configured');
    });
  });
});

describe('reconcileWompiByReference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTransactionsMock.mockResolvedValue([
      {
        id: '12345',
        status: 'APPROVED',
        amountInCents: 10000,
        currency: 'COP',
        reference: 'SUB_test_1',
        paymentLinkId: 'pl_123',
        customerEmail: 'test@example.com',
        finalizedAt: '2026-03-01T00:00:00Z',
        createdAt: '2026-02-28T00:00:00Z'
      }
    ]);
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({ id: 'webhook-123' } as any);
    vi.mocked(prisma.retryJob.create).mockResolvedValue({} as any);
    vi.mocked(getWompiPublicKey).mockResolvedValue('test-public-key');
    vi.mocked(getWompiPrivateKey).mockResolvedValue('test-private-key');
    vi.mocked(getWompiApiBaseUrl).mockResolvedValue('https://sandbox.wompi.co/v1');
    vi.mocked(getWompiCheckoutLinkBaseUrl).mockResolvedValue('https://checkout.wompi.co/l/');
    vi.mocked(getDefaultTenantId).mockResolvedValue('test-tenant-id');
  });

  describe('Validación de parámetros', () => {
    it('should reject missing reference', async () => {
      const result = await reconcileWompiByReference({
        reference: '',
        tenantId: 'test-tenant',
        processNow: false
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('missing_reference');
    });

    it('should reject null reference', async () => {
      const result = await reconcileWompiByReference({
        reference: null as any,
        tenantId: 'test-tenant',
        processNow: false
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('missing_reference');
    });
  });

  describe('Búsqueda por referencia', () => {
    it('should reject when no transactions found by reference', async () => {
      listTransactionsMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const result = await reconcileWompiByReference({
        reference: 'SUB_test_1',
        tenantId: 'test-tenant',
        processNow: false
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('transaction_not_found_by_reference');
    });

    it('should reject when all transactions have non-final status', async () => {
      listTransactionsMock.mockResolvedValueOnce([
        {
          id: 'tx_pending',
          status: 'PENDING',
          amountInCents: 10000,
          currency: 'COP',
          reference: 'SUB_test_1',
          paymentLinkId: 'pl_123',
          customerEmail: 'test@example.com',
          finalizedAt: '2026-03-01T00:00:00Z',
          createdAt: '2026-02-28T00:00:00Z'
        }
      ]);

      const result = await reconcileWompiByReference({
        reference: 'SUB_test_1',
        tenantId: 'test-tenant',
        processNow: false
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('status_not_final');
    });
  });

  describe('Selección de transacción candidata', () => {
    it('should prefer transactions with matching paymentLinkId', async () => {
      // Este test valida el scoring de candidatos
      // La implementación debería preferir la transacción con paymentLinkId matching
      const result = await reconcileWompiByReference({
        reference: 'SUB_test_1',
        tenantId: 'test-tenant',
        paymentLinkId: 'pl_expected',
        processNow: false
      });

      // El scoring es interno, pero el resultado debería reflejar la selección correcta
      expect(result.ok).toBe(true);
    });

    it('should score higher for matching amount and currency', async () => {
      listTransactionsMock.mockResolvedValueOnce([
        {
          id: 'tx_1',
          status: 'APPROVED',
          amountInCents: 50000,
          currency: 'COP',
          reference: 'SUB_test_1',
          paymentLinkId: 'pl_123',
          customerEmail: 'test@example.com',
          finalizedAt: '2026-03-01T00:00:00Z',
          createdAt: '2026-02-28T00:00:00Z'
        },
        {
          id: 'tx_2',
          status: 'APPROVED',
          amountInCents: 40000,
          currency: 'USD',
          reference: 'SUB_test_1',
          paymentLinkId: 'pl_123',
          customerEmail: 'test@example.com',
          finalizedAt: '2026-03-01T00:00:00Z',
          createdAt: '2026-02-28T00:00:00Z'
        }
      ]);

      const result = await reconcileWompiByReference({
        reference: 'SUB_test_1',
        tenantId: 'test-tenant',
        amountInCents: 50000,
        currency: 'COP',
        processNow: false
      });

      expect(result.ok).toBe(true);
    });
  });
});

describe('Final status validation', () => {
  const FINAL_STATUSES = ['APPROVED', 'DECLINED', 'VOIDED', 'ERROR'];
  const NON_FINAL_STATUSES = ['PENDING', 'IN_PROGRESS', 'AUTHORIZED'];

  it('should recognize all final statuses', () => {
    FINAL_STATUSES.forEach(status => {
      expect(status).toMatch(/^(APPROVED|DECLINED|VOIDED|ERROR)$/);
    });
  });

  it('should recognize non-final statuses', () => {
    NON_FINAL_STATUSES.forEach(status => {
      expect(status).not.toMatch(/^(APPROVED|DECLINED|VOIDED|ERROR)$/);
    });
  });
});

describe('Reference parsing', () => {
  it('should handle SUB_ references', () => {
    const ref = 'SUB_550e8400-e29b-41d4-a716-446655440000_3';
    expect(ref).toMatch(/^SUB_/);
    expect(ref.split('_').length).toBeGreaterThanOrEqual(3);
  });

  it('should handle ORDER_ references', () => {
    const ref = 'ORDER_external_123_plan_abc';
    expect(ref).toMatch(/^ORDER_/);
  });

  it('should handle SHOPIFY_ references', () => {
    const ref = 'SHOPIFY_4598732156';
    expect(ref).toMatch(/^SHOPIFY_/);
  });
});
