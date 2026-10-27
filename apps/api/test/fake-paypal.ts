import type { PayPalCapture, PayPalGateway, PayPalPayoutBatch } from "../src/paypal.js";

export class FakePayPalGateway implements PayPalGateway {
  captureStatus = "COMPLETED";
  payoutStatus = "PENDING";
  verified = true;
  orderCreates = 0;
  payoutCreates = 0;
  private readonly orders = new Map<string, { topupId: string; amountMinor: bigint }>();
  private readonly payouts = new Map<string, { amountMinor: bigint; recipientEmail: string }>();

  async createOrder(input: { topupId: string; amountMinor: bigint }): Promise<string> {
    this.orderCreates += 1;
    const orderId = `PP_ORDER_${input.topupId}`;
    this.orders.set(orderId, input);
    return orderId;
  }

  async captureOrder(orderId: string): Promise<PayPalCapture | null> {
    return this.getOrderCapture(orderId);
  }

  async getOrderCapture(orderId: string): Promise<PayPalCapture | null> {
    const order = this.orders.get(orderId);
    if (!order || this.captureStatus !== "COMPLETED") return null;
    return {
      orderId,
      captureId: `PP_CAPTURE_${order.topupId}`,
      status: this.captureStatus,
      amountMinor: order.amountMinor,
      currency: "USD",
      merchantId: "sandbox-business-id",
      feeMinor: 30n,
      referenceId: order.topupId,
    };
  }

  async createPayout(input: { payoutId: string; amountMinor: bigint; recipientEmail: string }): Promise<string> {
    this.payoutCreates += 1;
    this.payouts.set(input.payoutId, { amountMinor: input.amountMinor, recipientEmail: input.recipientEmail });
    return `PP_BATCH_${input.payoutId}`;
  }

  async getPayoutBatch(batchId: string): Promise<PayPalPayoutBatch> {
    const payoutId = batchId.replace(/^PP_BATCH_/, "");
    const payout = this.payouts.get(payoutId);
    if (!payout) throw new Error("Payout batch missing");
    return {
      batchId,
      status: this.payoutStatus === "PENDING" ? "PROCESSING" : "SUCCESS",
      items: [{
        itemId: `PP_ITEM_${payoutId}`,
        senderItemId: payoutId,
        status: this.payoutStatus,
        amountMinor: payout.amountMinor,
        currency: "USD",
        recipientEmail: payout.recipientEmail,
        feeMinor: 25n,
      }],
    };
  }

  async verifyWebhook(): Promise<boolean> {
    return this.verified;
  }
}
