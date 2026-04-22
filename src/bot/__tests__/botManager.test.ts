import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BotManager } from '../botManager';
import { Bot } from 'grammy';
import { Menu } from '@grammyjs/menu';
import { SettingsService } from '../../services/settingsService';
import { UserStep } from '../../constants';

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
            api: {
                sendMessage: vi.fn(),
                sendPhoto: vi.fn(),
                sendDocument: vi.fn(),
                sendInvoice: vi.fn(),
            },
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
            getPaymentMethodKindFromPayment: vi.fn().mockReturnValue('rial_card'),
            updatePaymentStatus: vi.fn().mockResolvedValue(undefined),
            getPaymentInstructions: vi.fn().mockReturnValue(''),
            notifyChannel: vi.fn().mockResolvedValue(undefined),
            recordProof: vi.fn().mockResolvedValue(undefined),
            recordProofText: vi.fn().mockResolvedValue(undefined),
            setReviewStatus: vi.fn().mockResolvedValue(undefined),
            getPaymentById: vi.fn().mockResolvedValue(null),
        })),
    };
});

vi.mock('../../services/settingsService', () => ({
    SettingsService: vi.fn().mockImplementation(() => ({
        isSalesEnabled: vi.fn().mockResolvedValue(true),
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

const getHandler = (mockBot: any, type: 'command' | 'callbackQuery' | 'on', matcher: any) => {
    const calls = mockBot[type].mock.calls as any[];
    for (const call of calls) {
        const [first, second] = call;
        if (type === 'command' && first === matcher) return second;
        if (type === 'on') {
            if (Array.isArray(first) && Array.isArray(matcher)) {
                const sameLength = first.length === matcher.length;
                const sameValues = sameLength && first.every((value, index) => value === matcher[index]);
                if (sameValues) return second;
            } else if (first === matcher) {
                return second;
            }
        }
        if (type === 'callbackQuery' && first instanceof RegExp && first.source === matcher.source)
            return second;
    }
    return undefined;
};

const getMenuTextHandler = (menuMockInstance: any, label: string) => {
    const call = (menuMockInstance.text.mock.calls as any[]).find(
        (args) => args[0] === label
    );
    return call?.[1];
};

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

    describe('sales toggle guards', () => {
        it('non-purchase help command remains accessible when sales disabled', async () => {
            const mockBot = (Bot as any).mock.results[0].value;
            const settingsProto = (SettingsService as any).mock.results[0].value;
            settingsProto.isSalesEnabled.mockResolvedValue(false);
            const helpHandler = getHandler(mockBot, 'command', 'help');

            const ctx = {
                from: { id: 1, first_name: 'T' },
                replyWithPhoto: vi.fn().mockResolvedValue(undefined),
            };

            await helpHandler(ctx);
            expect(ctx.replyWithPhoto).toHaveBeenCalled();
        });

        it('blocks purchase entry from main menu when sales disabled', async () => {
            const mockMenuInstance = (Menu as any).mock.results[1].value;
            const settingsProto = (SettingsService as any).mock.results[0].value;
            settingsProto.isSalesEnabled.mockResolvedValue(false);
            const buyHandler = getMenuTextHandler(mockMenuInstance, '🛍 خرید اشتراک');

            const ctx = {
                from: { id: 1, first_name: 'T' },
                reply: vi.fn().mockResolvedValue(undefined),
            };

            await buyHandler(ctx);
            expect(ctx.reply).toHaveBeenCalled();
            expect(ctx.reply.mock.calls[0][0]).toContain('فروش موقتاً متوقف شده');
        });

        it('blocks plan callback when sales disabled', async () => {
            const mockBot = (Bot as any).mock.results[0].value;
            const settingsProto = (SettingsService as any).mock.results[0].value;
            settingsProto.isSalesEnabled.mockResolvedValue(false);
            const planHandler = getHandler(mockBot, 'callbackQuery', /^plan:(.+)$/);

            const ctx = {
                from: { id: 1, first_name: 'T', username: 'u' },
                match: ['plan:basic', 'basic'],
                answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
                reply: vi.fn().mockResolvedValue(undefined),
            };

            await planHandler(ctx);
            expect(ctx.reply).toHaveBeenCalled();
            expect(ctx.reply.mock.calls[0][0]).toContain('فروش موقتاً متوقف شده');
        });

        it('blocks payment method callback when sales disabled', async () => {
            const mockBot = (Bot as any).mock.results[0].value;
            const settingsProto = (SettingsService as any).mock.results[0].value;
            settingsProto.isSalesEnabled.mockResolvedValue(false);
            const methodHandler = getHandler(mockBot, 'callbackQuery', /^select_method:(\d+)$/);

            const ctx = {
                from: { id: 1, first_name: 'T', username: 'u' },
                match: ['select_method:1', '1'],
                answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
                reply: vi.fn().mockResolvedValue(undefined),
            };

            await methodHandler(ctx);
            expect(ctx.reply).toHaveBeenCalled();
            expect(ctx.reply.mock.calls[0][0]).toContain('فروش موقتاً متوقف شده');
        });

        it('blocks proof submission entry when sales disabled', async () => {
            const mockBot = (Bot as any).mock.results[0].value;
            const settingsProto = (SettingsService as any).mock.results[0].value;
            settingsProto.isSalesEnabled.mockResolvedValue(false);
            const mediaHandler = getHandler(mockBot, 'on', ['message:photo', 'message:document']);

            const userService = (await import('../../services/userService')).UserService as any;
            userService.mock.results[0].value.getOrCreateUser.mockResolvedValue({
                id: 10,
                step: 'awaiting_payment_proof',
            });

            const ctx = {
                from: { id: 1, first_name: 'T', username: 'u' },
                message: { photo: [{ file_id: 'f1' }] },
                reply: vi.fn().mockResolvedValue(undefined),
            };

            await mediaHandler(ctx);
            expect(ctx.reply).toHaveBeenCalled();
            expect(ctx.reply.mock.calls[0][0]).toContain('فروش موقتاً متوقف شده');
        });

        it('allows purchase entry from main menu when sales enabled', async () => {
            const mockMenuInstance = (Menu as any).mock.results[1].value;
            const settingsProto = (SettingsService as any).mock.results[0].value;
            settingsProto.isSalesEnabled.mockResolvedValue(true);
            const buyHandler = getMenuTextHandler(mockMenuInstance, '🛍 خرید اشتراک');

            const userService = (await import('../../services/userService')).UserService as any;
            userService.mock.results[0].value.getOrCreateUser.mockResolvedValue({
                id: 1,
                step: UserStep.IDLE,
            });

            const ctx = {
                from: { id: 1, first_name: 'T', username: 'u' },
                reply: vi.fn().mockResolvedValue(undefined),
            };

            await buyHandler(ctx);
            expect(userService.mock.results[0].value.setUserStep).toHaveBeenCalled();
        });
    });
}); 