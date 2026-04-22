import type {
    PaymentInstruction,
    PaymentMethodKind,
    PaymentSubmission,
} from '../types';

export interface PaymentRailAdapter {
    kind: PaymentMethodKind;
    createInstruction(input: {
        amountToman: number;
        methodLabel: string;
        payToValue?: string | null;
        metadata?: Record<string, unknown>;
        transactionId: string;
        telegramUserId: number;
    }): Promise<PaymentInstruction>;
    validateSubmission(
        input: PaymentSubmission
    ): Promise<{ ok: boolean; reason?: string }>;
    reconcile?(
        event: unknown
    ): Promise<{ matchedPaymentId?: number; status: 'pending' | 'approved' | 'rejected' }>;
}

function toText(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const value = v.trim();
    return value.length ? value : null;
}

class RialCardAdapter implements PaymentRailAdapter {
    kind: PaymentMethodKind = 'rial_card';

    async createInstruction(input: {
        amountToman: number;
        methodLabel: string;
        payToValue?: string | null;
        transactionId: string;
    }): Promise<PaymentInstruction> {
        const payTo = input.payToValue ?? null;
        const instructionText =
            `💳 روش پرداخت: ${input.methodLabel}\n` +
            `💰 مبلغ قابل پرداخت: ${input.amountToman.toLocaleString()} تومان\n` +
            `${payTo ? `🏦 شماره کارت مقصد: ${payTo}\n` : ''}` +
            `🧾 شناسه مرجع: ${input.transactionId}\n\n` +
            `پس از واریز، عکس رسید یا اسکرین‌شات پیامک بانک را ارسال کنید.`;

        return {
            paymentMethodId: -1,
            kind: this.kind,
            label: input.methodLabel,
            amountToman: input.amountToman,
            payToValue: payTo,
            instructionText,
        };
    }

    async validateSubmission(
        input: PaymentSubmission
    ): Promise<{ ok: boolean; reason?: string }> {
        if (!input.proofFileId) return { ok: false, reason: 'proof_required' };
        if (input.cardLastDigits && !/^\d{4,6}$/.test(input.cardLastDigits)) {
            return { ok: false, reason: 'invalid_card_digits' };
        }
        return { ok: true };
    }
}

class TonAdapter implements PaymentRailAdapter {
    kind: PaymentMethodKind = 'ton';

    async createInstruction(input: {
        amountToman: number;
        methodLabel: string;
        payToValue?: string | null;
        transactionId: string;
    }): Promise<PaymentInstruction> {
        const wallet = input.payToValue ?? null;
        const deepLink = wallet
            ? `https://app.tonkeeper.com/transfer/${encodeURIComponent(wallet)}?text=${encodeURIComponent(input.transactionId)}`
            : null;
        const instructionText =
            `💠 روش پرداخت: ${input.methodLabel}\n` +
            `💰 مبلغ (معادل تومان): ${input.amountToman.toLocaleString()} تومان\n` +
            `${wallet ? `👛 کیف پول مقصد: ${wallet}\n` : ''}` +
            `🧾 Memo/Reference: ${input.transactionId}\n\n` +
            `پس از انتقال TON، اسکرین‌شات یا هش تراکنش را ارسال کنید تا بررسی شود.`;

        return {
            paymentMethodId: -1,
            kind: this.kind,
            label: input.methodLabel,
            amountToman: input.amountToman,
            payToValue: wallet,
            instructionText,
            deepLink,
        };
    }

    async validateSubmission(
        input: PaymentSubmission
    ): Promise<{ ok: boolean; reason?: string }> {
        if (!input.proofFileId) return { ok: false, reason: 'proof_required' };
        return { ok: true };
    }
}

class CryptoAdapter implements PaymentRailAdapter {
    kind: PaymentMethodKind = 'crypto';

    async createInstruction(input: {
        amountToman: number;
        methodLabel: string;
        payToValue?: string | null;
        transactionId: string;
        metadata?: Record<string, unknown>;
    }): Promise<PaymentInstruction> {
        const wallet = input.payToValue ?? null;
        const network = toText(input.metadata?.network) ?? toText(input.metadata?.chain);
        const instructionText =
            `🪙 روش پرداخت: ${input.methodLabel}\n` +
            `💰 مبلغ (معادل تومان): ${input.amountToman.toLocaleString()} تومان\n` +
            `${network ? `🌐 شبکه: ${network}\n` : ''}` +
            `${wallet ? `👛 آدرس مقصد: ${wallet}\n` : ''}` +
            `🧾 کد مرجع: ${input.transactionId}\n\n` +
            `پس از پرداخت، هش تراکنش یا اسکرین‌شات را ارسال کنید.`;

        return {
            paymentMethodId: -1,
            kind: this.kind,
            label: input.methodLabel,
            amountToman: input.amountToman,
            payToValue: wallet,
            instructionText,
        };
    }

    async validateSubmission(
        input: PaymentSubmission
    ): Promise<{ ok: boolean; reason?: string }> {
        if (!input.proofFileId) return { ok: false, reason: 'proof_required' };
        return { ok: true };
    }
}

class GenericAdapter implements PaymentRailAdapter {
    kind: PaymentMethodKind = 'other';

    async createInstruction(input: {
        amountToman: number;
        methodLabel: string;
        payToValue?: string | null;
        transactionId: string;
    }): Promise<PaymentInstruction> {
        const instructionText =
            `💳 روش پرداخت: ${input.methodLabel}\n` +
            `💰 مبلغ قابل پرداخت: ${input.amountToman.toLocaleString()} تومان\n` +
            `${input.payToValue ? `📌 مقصد پرداخت: ${input.payToValue}\n` : ''}` +
            `🧾 کد پیگیری: ${input.transactionId}\n\n` +
            `لطفاً رسید پرداخت را ارسال کنید.`;
        return {
            paymentMethodId: -1,
            kind: this.kind,
            label: input.methodLabel,
            amountToman: input.amountToman,
            payToValue: input.payToValue ?? null,
            instructionText,
        };
    }

    async validateSubmission(
        input: PaymentSubmission
    ): Promise<{ ok: boolean; reason?: string }> {
        if (!input.proofFileId) return { ok: false, reason: 'proof_required' };
        return { ok: true };
    }
}

export class PaymentRailFactory {
    private readonly adapters: Record<PaymentMethodKind, PaymentRailAdapter>;

    constructor() {
        this.adapters = {
            rial_card: new RialCardAdapter(),
            ton: new TonAdapter(),
            crypto: new CryptoAdapter(),
            other: new GenericAdapter(),
        };
    }

    get(kind: PaymentMethodKind): PaymentRailAdapter {
        return this.adapters[kind] ?? this.adapters.other;
    }
}
