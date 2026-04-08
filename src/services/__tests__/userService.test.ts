import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserService } from '../userService';
import type { User } from '../../types';
import { UserStep } from '../../constants';

describe('UserService', () => {
    let userService: UserService;
    let mockSupabase: any;

    beforeEach(() => {
        mockSupabase = {
            from: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            insert: vi.fn(),
            update: vi.fn(),
            eq: vi.fn(),
        };
        userService = new UserService(mockSupabase);
    });

    it('getUserById returns user', async () => {
        const mockUser: User = {
            id: 1,
            telegram_id: 123,
            first_name: 'Test',
            step: UserStep.IDLE,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        const mockSingle = vi.fn().mockResolvedValue({ data: mockUser, error: null });
        mockSupabase.eq.mockReturnValue({ single: mockSingle });

        const result = await userService.getUserById(1);
        expect(result).toEqual(mockUser);
        expect(mockSupabase.from).toHaveBeenCalledWith('vpn_users');
    });

    it('setUserStep updates step', async () => {
        mockSupabase.update.mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
        });
        await userService.setUserStep(1, UserStep.AWAITING_PAYMENT);
        expect(mockSupabase.update).toHaveBeenCalledWith({ step: UserStep.AWAITING_PAYMENT });
    });
});
