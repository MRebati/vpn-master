import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsService } from '../settingsService';

describe('SettingsService.isSalesEnabled', () => {
    let mockSupabase: any;

    beforeEach(() => {
        vi.useRealTimers();
        mockSupabase = {
            from: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(),
        };
    });

    it('returns true when key missing', async () => {
        mockSupabase.maybeSingle.mockResolvedValue({ data: null, error: null });
        const svc = new SettingsService(mockSupabase);
        await expect(svc.isSalesEnabled()).resolves.toBe(true);
    });

    it('returns true for truthy values', async () => {
        mockSupabase.maybeSingle.mockResolvedValue({
            data: { value: 'enabled' },
            error: null,
        });
        const svc = new SettingsService(mockSupabase);
        await expect(svc.isSalesEnabled()).resolves.toBe(true);
    });

    it('returns false for explicit false value', async () => {
        mockSupabase.maybeSingle.mockResolvedValue({
            data: { value: 'false' },
            error: null,
        });
        const svc = new SettingsService(mockSupabase);
        await expect(svc.isSalesEnabled()).resolves.toBe(false);
    });

    it('uses fail-open fallback on db errors by default', async () => {
        mockSupabase.maybeSingle.mockResolvedValue({
            data: null,
            error: { message: 'db-down' },
        });
        const svc = new SettingsService(mockSupabase);
        await expect(svc.isSalesEnabled()).resolves.toBe(true);
    });

    it('uses fail-closed fallback on db errors when configured', async () => {
        mockSupabase.maybeSingle.mockResolvedValue({
            data: null,
            error: { message: 'db-down' },
        });
        const svc = new SettingsService(mockSupabase, { salesFailClosed: true });
        await expect(svc.isSalesEnabled()).resolves.toBe(false);
    });

    it('caches value with ttl', async () => {
        vi.useFakeTimers();
        mockSupabase.maybeSingle.mockResolvedValue({
            data: { value: 'true' },
            error: null,
        });
        const svc = new SettingsService(mockSupabase, { salesCacheTtlMs: 20_000 });

        await expect(svc.isSalesEnabled()).resolves.toBe(true);
        await expect(svc.isSalesEnabled()).resolves.toBe(true);
        expect(mockSupabase.maybeSingle).toHaveBeenCalledTimes(1);
    });
});
