import { BadRequestException } from '@nestjs/common';

export type CheckoutOrderItemDto = {
  foodItemId?: string;
  slug?: string;
  quantity: number;
  note?: string;
};

export type CheckoutPickupSlotDto = {
  id: string;
  label: string;
  minutesFromNow: number;
};

export type StartCheckoutOrderDto = {
  items: CheckoutOrderItemDto[];
  couponCode?: string;
  pickupSlot: CheckoutPickupSlotDto;
  checkoutAttemptId?: string;
};

export type ConfirmCheckoutPaymentDto = {
  orderNumber: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
};

export type RecoverCheckoutOrderDto = {
  orderNumber: string;
  razorpayOrderId: string;
};

export function parseStartCheckoutOrderDto(
  body: Record<string, unknown>,
): StartCheckoutOrderDto {
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new BadRequestException('items must contain at least one item');
  }

  return {
    items: body.items.map((item) => parseOrderItem(item)),
    couponCode:
      typeof body.couponCode === 'string' && body.couponCode.trim()
        ? body.couponCode.trim().toUpperCase()
        : undefined,
    pickupSlot: parsePickupSlot(body.pickupSlot),
    checkoutAttemptId:
      typeof body.checkoutAttemptId === 'string' &&
      body.checkoutAttemptId.trim()
        ? body.checkoutAttemptId.trim().slice(0, 120)
        : undefined,
  };
}

export function parseConfirmCheckoutPaymentDto(
  body: Record<string, unknown>,
): ConfirmCheckoutPaymentDto {
  return {
    orderNumber: readString(body.orderNumber, 'orderNumber'),
    razorpayOrderId: readString(body.razorpayOrderId, 'razorpayOrderId'),
    razorpayPaymentId: readString(body.razorpayPaymentId, 'razorpayPaymentId'),
    razorpaySignature: readString(body.razorpaySignature, 'razorpaySignature'),
  };
}

export function parseRecoverCheckoutOrderDto(
  body: Record<string, unknown>,
): RecoverCheckoutOrderDto {
  return {
    orderNumber: readString(body.orderNumber, 'orderNumber'),
    razorpayOrderId: readString(body.razorpayOrderId, 'razorpayOrderId'),
  };
}

function parseOrderItem(value: unknown): CheckoutOrderItemDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Each item must be an object');
  }

  const record = value as Record<string, unknown>;
  const foodItemId =
    typeof record.foodItemId === 'string'
      ? record.foodItemId.trim()
      : undefined;
  const slug = typeof record.slug === 'string' ? record.slug.trim() : undefined;
  const quantity = Number(record.quantity);
  const note =
    typeof record.note === 'string'
      ? record.note.trim().slice(0, 120)
      : undefined;

  if (!foodItemId && !slug) {
    throw new BadRequestException('Each item requires foodItemId or slug');
  }

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new BadRequestException('Item quantity must be between 1 and 20');
  }

  return {
    foodItemId,
    slug,
    quantity,
    note,
  };
}

function parsePickupSlot(value: unknown): CheckoutPickupSlotDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('pickupSlot is required');
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const label = typeof record.label === 'string' ? record.label.trim() : '';
  const minutesFromNow = Number(record.minutesFromNow);

  if (
    !id ||
    !label ||
    !Number.isInteger(minutesFromNow) ||
    minutesFromNow < 0 ||
    minutesFromNow > 120
  ) {
    throw new BadRequestException('pickupSlot is invalid');
  }

  return {
    id,
    label,
    minutesFromNow,
  };
}

function readString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }

  return value.trim();
}
