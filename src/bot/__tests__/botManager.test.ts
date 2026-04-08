import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BotManager } from '../botManager';
import { Bot } from 'grammy';
import { Menu } from '@grammyjs/menu';

// Mock the dependencies
vi.mock('grammy', () => {
    return {
        Bot: vi.fn().mockImplementation(() => ({
            use: vi.fn(),
            handleUpdate: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            init: vi.fn().mockResolvedValue(undefined),
            command: vi.fn(),
            callbackQuery: vi.fn(),
            api: { sendMessage: vi.fn(), sendPhoto: vi.fn(), sendDocument: vi.fn() },
        })),
    };
});

vi.mock('@grammyjs/menu', () => {
    const mockMenuInstance = {
        text: vi.fn().mockReturnThis(),
        dynamic: vi.fn().mockReturnThis(),
        row: vi.fn().mockReturnThis()
    };
    
    return {
        Menu: vi.fn().mockImplementation(() => mockMenuInstance),
        MenuRange: vi.fn().mockImplementation(() => ({
            text: vi.fn().mockReturnThis()
        }))
    };
});

vi.mock('@supabase/supabase-js', () => {
    return {
        createClient: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            insert: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
    };
});

vi.mock('../../services/userService', () => {
    return {
        UserService: vi.fn().mockImplementation(() => ({
            getOrCreateUser: vi.fn().mockResolvedValue(null),
            getUserById: vi.fn().mockResolvedValue(null),
            setUserStep: vi.fn().mockResolvedValue(undefined),
            selectPlan: vi.fn().mockResolvedValue(undefined),
            setVpnUsername: vi.fn().mockResolvedValue(undefined),
            setVpnPassword: vi.fn().mockResolvedValue(undefined),
        })),
    };
});

vi.mock('../../services/paymentService', () => {
    return {
        PaymentService: vi.fn().mockImplementation(() => ({
            createPayment: vi.fn().mockResolvedValue({ id: 1 }),
            getLatestPendingPayment: vi.fn().mockResolvedValue(null),
            updatePaymentStatus: vi.fn().mockResolvedValue(undefined),
            getPaymentInstructions: vi.fn().mockReturnValue(''),
            notifyChannel: vi.fn().mockResolvedValue(undefined),
            recordProof: vi.fn().mockResolvedValue(undefined),
            setReviewStatus: vi.fn().mockResolvedValue(undefined),
            getPaymentById: vi.fn().mockResolvedValue(null),
        })),
    };
});

vi.mock('../../services/settingsService', () => ({
    SettingsService: vi.fn().mockImplementation(() => ({
        getCardNumber: vi.fn().mockResolvedValue('0000'),
    })),
}));

vi.mock('../../services/inventoryService', () => ({
    InventoryService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../services/vpnAccountService', () => ({
    VpnAccountService: vi.fn().mockImplementation(() => ({
        listAccountsForUser: vi.fn().mockResolvedValue([]),
        isUsernameAvailable: vi.fn().mockResolvedValue(true),
        createVpnAccount: vi.fn().mockResolvedValue({}),
    })),
}));

vi.mock('../../services/fulfillmentService', () => ({
    fulfillPaymentAfterApproval: vi.fn().mockResolvedValue({ ok: true }),
}));

describe('BotManager', () => {
    let botManager: BotManager;
    const mockEnv = {
        BOT_TOKEN: 'mock_token',
        ADMIN_USER_ID: '123456',
        CARD_NUMBER: '1234567890',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_KEY: 'mock_key'
    };

    beforeEach(() => {
        vi.clearAllMocks();
        botManager = new BotManager(mockEnv);
    });

    describe('constructor', () => {
        it('creates a bot instance and registers menus', () => {
            // The constructor already ran in beforeEach
            expect(Bot).toHaveBeenCalledWith(mockEnv.BOT_TOKEN);
            expect(Menu).toHaveBeenCalledTimes(2); // Main menu and plans menu
        });

        it('registers command handlers', () => {
            const mockBot = (Bot as any).mock.results[0].value;
            expect(mockBot.command).toHaveBeenCalledWith('start', expect.any(Function));
            expect(mockBot.command).toHaveBeenCalledWith('help', expect.any(Function));
        });
    });

    describe('init', () => {
        it('initializes the bot', async () => {
            await botManager.init();
            // Get the mock Bot instance and verify init was called
            const mockBot = (Bot as any).mock.results[0].value;
            expect(mockBot.init).toHaveBeenCalled();
        });
    });

    describe('processUpdate', () => {
        it('processes a webhook update successfully', async () => {
            const update = {
                message: {
                    from: {
                        id: 123,
                        first_name: 'Test',
                        username: 'test_user'
                    },
                    text: 'Hello'
                }
            };

            const result = await botManager.processUpdate(update);
            expect(result).toBe(true);
            
            // Get the mock Bot instance and verify methods were called
            const mockBot = (Bot as any).mock.results[0].value;
            expect(mockBot.init).toHaveBeenCalled();
            expect(mockBot.handleUpdate).toHaveBeenCalledWith(update);
        });
    });
}); 