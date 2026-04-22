import { CatalogService } from './catalogService';
import { PaymentRailFactory } from './paymentRails';
import { PaymentService } from './paymentService';
import type { PaymentInstruction, PublicPaymentMethod, PublicPlan } from '../types';

export class CheckoutService {
    constructor(
        private readonly catalogService: CatalogService,
        private readonly paymentService: PaymentService,
        private readonly railFactory: PaymentRailFactory
    ) {}

    async listPlans(): Promise<PublicPlan[]> {
        return this.catalogService.listVisiblePlans();
    }

    async getPlanBySlug(slug: string): Promise<PublicPlan | null> {
        return this.catalogService.getPlanBySlug(slug);
    }

    async listPaymentMethodsForPlan(
        plan: PublicPlan,
        fallbackCardNumber: string
    ): Promise<PublicPaymentMethod[]> {
        return this.catalogService.getPaymentMethodsForPlan(plan, fallbackCardNumber);
    }

    async createPaymentAndInstruction(input: {
        userId: number;
        telegramUserId: number;
        plan: PublicPlan;
        method: PublicPaymentMethod;
    }): Promise<{ paymentId: number; transactionId: string; amount: number; instruction: PaymentInstruction }> {
        const payment = await this.paymentService.createPayment(
            input.userId,
            input.plan.internalPlanKey,
            input.method.id
        );

        const adapter = this.railFactory.get(input.method.kind);
        const instruction = await adapter.createInstruction({
            amountToman: payment.amount,
            methodLabel: input.method.label,
            payToValue: input.method.payToValue ?? null,
            metadata: input.method.metadata,
            transactionId: payment.transaction_id,
            telegramUserId: input.telegramUserId,
        });

        instruction.paymentMethodId = input.method.id;
        return {
            paymentId: payment.id,
            transactionId: payment.transaction_id,
            amount: payment.amount,
            instruction,
        };
    }
}
