import { PaymentsService } from './payments.service';
import { createHmac } from 'node:crypto';

describe('PaymentsService', () => {
  const previousSecret = process.env.RAZORPAY_KEY_SECRET;
  const previousKey = process.env.RAZORPAY_KEY_ID;
  const previousWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  afterEach(() => {
    process.env.RAZORPAY_KEY_SECRET = previousSecret;
    process.env.RAZORPAY_KEY_ID = previousKey;
    process.env.RAZORPAY_WEBHOOK_SECRET = previousWebhookSecret;
  });

  it('creates a mock Razorpay order when keys are not configured', async () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;

    const service = new PaymentsService();
    const order = await service.createRazorpayOrder({
      amount: 123,
      currency: 'INR',
    });

    expect(order).toMatchObject({
      mode: 'mock',
      amount: 12300,
      currency: 'INR',
    });
    expect(order.orderId).toContain('order_mock_');
  });

  it('verifies mock payment payloads only in mock mode', () => {
    delete process.env.RAZORPAY_KEY_SECRET;

    const service = new PaymentsService();
    const result = service.verifyRazorpayPayment({
      razorpayOrderId: 'order_mock_123',
      razorpayPaymentId: 'pay_mock_123',
      razorpaySignature: 'mock_signature',
    });

    expect(result).toMatchObject({
      mode: 'mock',
      verified: true,
    });
  });

  it('verifies live Razorpay signatures', () => {
    process.env.RAZORPAY_KEY_SECRET = 'test_secret';

    const service = new PaymentsService();
    const signature = createHmac('sha256', 'test_secret')
      .update('order_live_123|pay_live_123')
      .digest('hex');

    const result = service.verifyRazorpayPayment({
      razorpayOrderId: 'order_live_123',
      razorpayPaymentId: 'pay_live_123',
      razorpaySignature: signature,
    });

    expect(result).toMatchObject({
      mode: 'live',
      verified: true,
      orderId: 'order_live_123',
      paymentId: 'pay_live_123',
    });
  });

  it('rejects invalid live Razorpay signatures', () => {
    process.env.RAZORPAY_KEY_SECRET = 'test_secret';

    const service = new PaymentsService();

    expect(() =>
      service.verifyRazorpayPayment({
        razorpayOrderId: 'order_live_123',
        razorpayPaymentId: 'pay_live_123',
        razorpaySignature: 'invalid_signature',
      }),
    ).toThrow('Razorpay payment signature verification failed');
  });

  it('verifies Razorpay webhook signatures against the raw body', () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_secret';

    const service = new PaymentsService();
    const rawBody = Buffer.from(JSON.stringify({ event: 'payment.captured' }));
    const signature = createHmac('sha256', 'webhook_secret')
      .update(rawBody)
      .digest('hex');

    expect(service.verifyWebhookSignature(rawBody, signature)).toBe(true);
  });

  it('rejects invalid Razorpay webhook signatures', () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_secret';

    const service = new PaymentsService();
    const rawBody = Buffer.from(JSON.stringify({ event: 'payment.captured' }));

    expect(() =>
      service.verifyWebhookSignature(rawBody, 'invalid_signature'),
    ).toThrow('Invalid Razorpay webhook signature.');
  });

  it('parses Razorpay webhook raw bodies', () => {
    const service = new PaymentsService();
    const payload = service.parseWebhookPayload(
      Buffer.from(JSON.stringify({ event: 'order.paid' })),
    );

    expect(payload).toMatchObject({ event: 'order.paid' });
  });
});
