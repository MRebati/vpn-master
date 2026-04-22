import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentService } from '../paymentService';
import type { Payment } from '../../types';

describe('PaymentService', () => {
    let paymentService: PaymentService;
    let mockSupabase: any;
    const ADMIN_ID = '123456';
    const CARD = '6104000000000000';

    beforeEach(() => {
        mockSupabase = {
            from: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            insert: vi.fn(),
            update: vi.fn(),
            eq: vi.fn().mockReturnThis(),
        };
        paymentService = new PaymentService(mockSupabase, ADMIN_ID, CARD);
    });

    it('createPayment inserts pending payment', async () => {
        const mockPayment: Payment = {
            id: 1,
            user_id: 1,
            amount: 150000,
            plan: 'basic-30d',
            card_last_digits: 'proof',
            status: 'PENDING',
            transaction_id: 'TXN-1',
            review_status: 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        const mockSingle = vi.fn().mockResolvedValue({ data: mockPayment, error: null });
        mockSupabase.insert.mockReturnValue({
            select: vi.fn().mockReturnValue({ single: mockSingle }),
        });

        const result = await paymentService.createPayment(1, 'basic-30d', 150000);
        expect(result.id).toBe(1);
        expect(mockSupabase.from).toHaveBeenCalledWith('payments');
    });

    it('updatePaymentStatus chains update → eq → select → single', async () => {
        const mockPayment: Payment = {
            id: 1,
            user_id: 1,
            amount: 150000,
            plan: 'basic-30d',
            card_last_digits: 'proof',
            status: 'COMPLETED',
            transaction_id: 'TXN-1',
            review_status: 'approved',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        const mockSingle = vi.fn().mockResolvedValue({ data: mockPayment, error: null });
        mockSupabase.update.mockReturnValue({
            eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({ single: mockSingle }),
            }),
        });

        const result = await paymentService.updatePaymentStatus(1, 'COMPLETED');
        expect(result.status).toBe('COMPLETED');
    });
});
