ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "checkoutAttemptId" TEXT;

DROP INDEX IF EXISTS "Payment_providerOrderId_idx";
DROP INDEX IF EXISTS "Payment_providerPaymentId_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "Order_checkoutAttemptId_key" ON "Order"("checkoutAttemptId");
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_providerOrderId_key" ON "Payment"("providerOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");

CREATE TABLE IF NOT EXISTS "PaymentWebhookEvent" (
  "id" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'RAZORPAY',
  "eventId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "providerOrderId" TEXT,
  "providerPaymentId" TEXT,
  "rawPayload" JSONB NOT NULL,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentWebhookEvent_eventId_key" ON "PaymentWebhookEvent"("eventId");
CREATE INDEX IF NOT EXISTS "PaymentWebhookEvent_provider_event_idx" ON "PaymentWebhookEvent"("provider", "event");
CREATE INDEX IF NOT EXISTS "PaymentWebhookEvent_providerOrderId_idx" ON "PaymentWebhookEvent"("providerOrderId");
CREATE INDEX IF NOT EXISTS "PaymentWebhookEvent_providerPaymentId_idx" ON "PaymentWebhookEvent"("providerPaymentId");
