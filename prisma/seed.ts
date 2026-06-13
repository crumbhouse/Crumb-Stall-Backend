import {
  AdminApprovalStatus,
  AuthProvider,
  CouponType,
  FoodType,
  NotificationType,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';

const prisma = new PrismaClient();

const categories = [
  {
    name: 'Snacks',
    slug: 'snacks',
    description: 'Fast bites for between classes.',
    sortOrder: 1,
  },
  {
    name: 'Beverages',
    slug: 'beverages',
    description: 'Coffee, tea, shakes, and refreshers.',
    sortOrder: 2,
  },
  {
    name: 'Combos',
    slug: 'combos',
    description: 'Student-friendly meal bundles.',
    sortOrder: 3,
  },
  {
    name: 'Meals',
    slug: 'meals',
    description: 'Filling plates for lunch breaks and long study days.',
    sortOrder: 4,
  },
  {
    name: 'Desserts',
    slug: 'desserts',
    description: 'Sweet finishes and quick treats.',
    sortOrder: 5,
  },
];

const foodItems = [
  {
    categorySlug: 'snacks',
    name: 'Classic Veg Burger',
    slug: 'classic-veg-burger',
    description: 'Crispy patty, fresh veggies, and house sauce in a toasted bun.',
    ingredients: ['Veg patty', 'Lettuce', 'Tomato', 'House sauce'],
    price: 89,
    discountPrice: 79,
    imageUrl: 'https://images.unsplash.com/photo-1520072959219-c595dc870360?auto=format&fit=crop&w=900&q=80',
    tags: ['burger', 'quick-bite', 'popular'],
    type: FoodType.VEG,
    ratingAverage: 4.6,
    ratingCount: 128,
    popularity: 95,
    isFeatured: true,
  },
  {
    categorySlug: 'snacks',
    name: 'Steamed Momos',
    slug: 'steamed-momos',
    description: 'Soft steamed momos served with spicy chutney.',
    ingredients: ['Flour wrap', 'Veg filling', 'Chilli chutney'],
    price: 69,
    imageUrl: 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?auto=format&fit=crop&w=900&q=80',
    tags: ['momos', 'student-favorite'],
    type: FoodType.VEG,
    ratingAverage: 4.5,
    ratingCount: 96,
    popularity: 90,
    isFeatured: true,
  },
  {
    categorySlug: 'snacks',
    name: 'Peri Peri Fries',
    slug: 'peri-peri-fries',
    description: 'Crispy fries tossed with peri peri seasoning and served hot.',
    ingredients: ['Potato fries', 'Peri peri spice', 'House dip'],
    price: 79,
    discountPrice: 69,
    imageUrl: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=80',
    tags: ['fries', 'spicy', 'quick-bite'],
    type: FoodType.VEG,
    ratingAverage: 4.4,
    ratingCount: 71,
    popularity: 84,
  },
  {
    categorySlug: 'snacks',
    name: 'Chicken Cheese Sandwich',
    slug: 'chicken-cheese-sandwich',
    description: 'Grilled sandwich with chicken, cheese, and herbed mayo.',
    ingredients: ['Chicken', 'Cheese', 'Bread', 'Herbed mayo'],
    price: 129,
    imageUrl: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80',
    tags: ['sandwich', 'non-veg', 'grilled'],
    type: FoodType.NON_VEG,
    ratingAverage: 4.5,
    ratingCount: 54,
    popularity: 78,
  },
  {
    categorySlug: 'beverages',
    name: 'Cold Coffee',
    slug: 'cold-coffee',
    description: 'Chilled coffee blended smooth for a quick recharge.',
    ingredients: ['Coffee', 'Milk', 'Sugar'],
    price: 79,
    imageUrl: 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=900&q=80',
    tags: ['coffee', 'beverage'],
    type: FoodType.VEG,
    ratingAverage: 4.4,
    ratingCount: 83,
    popularity: 82,
  },
  {
    categorySlug: 'beverages',
    name: 'Masala Chai',
    slug: 'masala-chai',
    description: 'Strong tea simmered with milk, ginger, and warm spices.',
    ingredients: ['Tea', 'Milk', 'Ginger', 'Cardamom'],
    price: 29,
    imageUrl: 'https://images.unsplash.com/photo-1561336313-0bd5e0b27ec8?auto=format&fit=crop&w=900&q=80',
    tags: ['tea', 'hot', 'budget'],
    type: FoodType.VEG,
    ratingAverage: 4.7,
    ratingCount: 142,
    popularity: 92,
  },
  {
    categorySlug: 'beverages',
    name: 'Lemon Iced Tea',
    slug: 'lemon-iced-tea',
    description: 'Bright lemon tea served chilled for hot afternoons.',
    ingredients: ['Tea', 'Lemon', 'Mint', 'Ice'],
    price: 69,
    imageUrl: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=900&q=80',
    tags: ['iced-tea', 'refreshing'],
    type: FoodType.VEG,
    ratingAverage: 4.3,
    ratingCount: 47,
    popularity: 72,
  },
  {
    categorySlug: 'combos',
    name: 'Burger + Coffee Combo',
    slug: 'burger-coffee-combo',
    description: 'A filling burger with cold coffee at a student-friendly price.',
    ingredients: ['Classic Veg Burger', 'Cold Coffee'],
    price: 159,
    discountPrice: 139,
    imageUrl: 'https://images.unsplash.com/photo-1619096252214-ef06c45683e3?auto=format&fit=crop&w=900&q=80',
    tags: ['combo', 'value'],
    type: FoodType.VEG,
    ratingAverage: 4.7,
    ratingCount: 74,
    popularity: 88,
    isFeatured: true,
  },
  {
    categorySlug: 'combos',
    name: 'Momos + Chai Combo',
    slug: 'momos-chai-combo',
    description: 'Steamed momos paired with masala chai for a quick break.',
    ingredients: ['Steamed Momos', 'Masala Chai'],
    price: 98,
    discountPrice: 89,
    imageUrl: 'https://images.unsplash.com/photo-1541696432-82c6da8ce7bf?auto=format&fit=crop&w=900&q=80',
    tags: ['combo', 'budget', 'tea-time'],
    type: FoodType.VEG,
    ratingAverage: 4.5,
    ratingCount: 63,
    popularity: 86,
  },
  {
    categorySlug: 'meals',
    name: 'Paneer Rice Bowl',
    slug: 'paneer-rice-bowl',
    description: 'Spiced paneer, rice, salad, and mint chutney in one bowl.',
    ingredients: ['Paneer', 'Rice', 'Salad', 'Mint chutney'],
    price: 149,
    discountPrice: 135,
    imageUrl: 'https://images.unsplash.com/photo-1543353071-10c8ba85a904?auto=format&fit=crop&w=900&q=80',
    tags: ['meal', 'paneer', 'lunch'],
    type: FoodType.VEG,
    ratingAverage: 4.6,
    ratingCount: 58,
    popularity: 80,
    isFeatured: true,
  },
  {
    categorySlug: 'meals',
    name: 'Chicken Rice Bowl',
    slug: 'chicken-rice-bowl',
    description: 'Grilled chicken, rice, salad, and creamy pepper sauce.',
    ingredients: ['Chicken', 'Rice', 'Salad', 'Pepper sauce'],
    price: 169,
    imageUrl: 'https://images.unsplash.com/photo-1543352634-a1c51d9f1fa7?auto=format&fit=crop&w=900&q=80',
    tags: ['meal', 'chicken', 'lunch'],
    type: FoodType.NON_VEG,
    ratingAverage: 4.5,
    ratingCount: 49,
    popularity: 76,
  },
  {
    categorySlug: 'desserts',
    name: 'Chocolate Brownie',
    slug: 'chocolate-brownie',
    description: 'Dense chocolate brownie with a soft center.',
    ingredients: ['Chocolate', 'Butter', 'Flour', 'Cocoa'],
    price: 75,
    imageUrl: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=900&q=80',
    tags: ['dessert', 'chocolate'],
    type: FoodType.VEG,
    ratingAverage: 4.8,
    ratingCount: 91,
    popularity: 89,
    isFeatured: true,
  },
  {
    categorySlug: 'desserts',
    name: 'Mini Pancake Bites',
    slug: 'mini-pancake-bites',
    description: 'Mini pancakes finished with chocolate drizzle.',
    ingredients: ['Pancakes', 'Chocolate sauce', 'Sugar'],
    price: 99,
    imageUrl: 'https://images.unsplash.com/photo-1528207776546-365bb710ee93?auto=format&fit=crop&w=900&q=80',
    tags: ['dessert', 'sweet'],
    type: FoodType.VEG,
    ratingAverage: 4.4,
    ratingCount: 36,
    popularity: 68,
  },
];

const coupons = [
  {
    code: 'WELCOME10',
    type: CouponType.PERCENTAGE,
    value: 10,
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    endsAt: new Date('2027-01-01T00:00:00.000Z'),
    usageLimit: 5000,
    minimumAmount: 99,
  },
  {
    code: 'SAVE50',
    type: CouponType.FIXED_AMOUNT,
    value: 50,
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    endsAt: new Date('2027-01-01T00:00:00.000Z'),
    usageLimit: 2000,
    minimumAmount: 299,
  },
  {
    code: 'CHAI20',
    type: CouponType.PERCENTAGE,
    value: 20,
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    endsAt: new Date('2026-12-31T23:59:59.000Z'),
    usageLimit: 1000,
    minimumAmount: 49,
  },
  {
    code: 'LUNCH30',
    type: CouponType.FIXED_AMOUNT,
    value: 30,
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    endsAt: new Date('2026-12-31T23:59:59.000Z'),
    usageLimit: 1500,
    minimumAmount: 149,
  },
];

const demoCustomers = [
  {
    email: 'riya.customer@crumbstall.local',
    name: 'Riya Sharma',
    providerId: 'seed-riya-customer',
    imageUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80',
  },
  {
    email: 'arjun.customer@crumbstall.local',
    name: 'Arjun Mehta',
    providerId: 'seed-arjun-customer',
    imageUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80',
  },
];

async function main() {
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD ?? 'CrumbHouse@2026';
  const superAdmin = await prisma.user.upsert({
    where: { email: 'crumbhouse2026@gmail.com' },
    update: {
      name: 'Crumb House Super Admin',
      role: UserRole.SUPER_ADMIN,
      provider: AuthProvider.CREDENTIALS,
      passwordHash: hashPassword(superAdminPassword),
      adminApprovalStatus: AdminApprovalStatus.APPROVED,
      adminApprovedAt: new Date(),
      isSuspended: false,
    },
    create: {
      email: 'crumbhouse2026@gmail.com',
      name: 'Crumb House Super Admin',
      role: UserRole.SUPER_ADMIN,
      provider: AuthProvider.CREDENTIALS,
      passwordHash: hashPassword(superAdminPassword),
      adminApprovalStatus: AdminApprovalStatus.APPROVED,
      adminApprovedAt: new Date(),
    },
  });

  await ensureCart(superAdmin.id);

  // const admin = await prisma.user.upsert({
  //   where: { email: 'admin@crumbstall.local' },
  //   update: {
  //     name: 'Crumb Stall Admin',
  //     role: UserRole.ADMIN,
  //     provider: AuthProvider.CREDENTIALS,
  //     adminApprovalStatus: AdminApprovalStatus.APPROVED,
  //     adminApprovedAt: new Date(),
  //     adminApprovedByEmail: superAdmin.email,
  //     isSuspended: false,
  //   },
  //   create: {
  //     email: 'admin@crumbstall.local',
  //     name: 'Crumb Stall Admin',
  //     role: UserRole.ADMIN,
  //     provider: AuthProvider.CREDENTIALS,
  //     adminApprovalStatus: AdminApprovalStatus.APPROVED,
  //     adminApprovedAt: new Date(),
  //     adminApprovedByEmail: superAdmin.email,
  //   },
  // });

  // await ensureCart(admin.id);

  // const categoryRecords = new Map<string, string>();

  // for (const category of categories) {
  //   const record = await prisma.category.upsert({
  //     where: { slug: category.slug },
  //     update: category,
  //     create: category,
  //   });

  //   categoryRecords.set(category.slug, record.id);
  // }

  // const foodRecords = new Map<string, { id: string; name: string; price: number; discountPrice?: number | null }>();

  // for (const item of foodItems) {
  //   const categoryId = categoryRecords.get(item.categorySlug);

  //   if (!categoryId) {
  //     throw new Error(`Missing seed category for ${item.slug}.`);
  //   }

  //   const { categorySlug, ...foodData } = item;
  //   const record = await prisma.foodItem.upsert({
  //     where: { slug: item.slug },
  //     update: {
  //       ...foodData,
  //       categoryId,
  //       isAvailable: true,
  //       isFeatured: item.isFeatured ?? false,
  //     },
  //     create: {
  //       ...foodData,
  //       categoryId,
  //       isFeatured: item.isFeatured ?? false,
  //     },
  //   });

  //   foodRecords.set(record.slug, {
  //     id: record.id,
  //     name: record.name,
  //     price: Number(record.price),
  //     discountPrice: record.discountPrice === null ? null : Number(record.discountPrice),
  //   });
  // }

  // const couponRecords = new Map<string, string>();

  // for (const coupon of coupons) {
  //   const record = await prisma.coupon.upsert({
  //     where: { code: coupon.code },
  //     update: coupon,
  //     create: coupon,
  //   });

  //   couponRecords.set(record.code, record.id);
  // }

  // const customerIds: string[] = [];

  // for (const customer of demoCustomers) {
  //   const record = await prisma.user.upsert({
  //     where: { email: customer.email },
  //     update: {
  //       ...customer,
  //       role: UserRole.CUSTOMER,
  //       provider: AuthProvider.GOOGLE,
  //       isSuspended: false,
  //       lastActivity: new Date('2026-06-06T11:20:00.000Z'),
  //     },
  //     create: {
  //       ...customer,
  //       role: UserRole.CUSTOMER,
  //       provider: AuthProvider.GOOGLE,
  //       lastActivity: new Date('2026-06-06T11:20:00.000Z'),
  //     },
  //   });

  //   await ensureCart(record.id);
  //   customerIds.push(record.id);
  // }

  // if (customerIds.length >= 2) {
  //   await seedOrders(customerIds[0], customerIds[1], foodRecords, couponRecords);
  //   await seedCustomerEngagement(customerIds[0], customerIds[1], foodRecords);
  // }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');

  return `scrypt$${salt}$${hash}`;
}

async function ensureCart(userId: string) {
  await prisma.cart.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

async function seedOrders(
  firstCustomerId: string,
  secondCustomerId: string,
  foods: Map<string, { id: string; name: string; price: number; discountPrice?: number | null }>,
  coupons: Map<string, string>,
) {
  await upsertSeedOrder({
    orderNumber: 'CS-SEED-1001',
    invoiceNumber: 'INV-CS-SEED-1001',
    userId: firstCustomerId,
    couponId: coupons.get('WELCOME10'),
    status: OrderStatus.COMPLETED,
    placedAt: new Date('2026-06-05T07:45:00.000Z'),
    completedAt: new Date('2026-06-05T08:05:00.000Z'),
    items: [
      { food: requireFood(foods, 'burger-coffee-combo'), quantity: 1 },
      { food: requireFood(foods, 'chocolate-brownie'), quantity: 1 },
    ],
    discountAmount: 21.4,
    paymentId: 'pay_seed_completed_1001',
    providerOrderId: 'order_seed_completed_1001',
  });

  await upsertSeedOrder({
    orderNumber: 'CS-SEED-1002',
    invoiceNumber: 'INV-CS-SEED-1002',
    userId: secondCustomerId,
    status: OrderStatus.READY_FOR_PICKUP,
    placedAt: new Date('2026-06-06T10:15:00.000Z'),
    items: [
      { food: requireFood(foods, 'paneer-rice-bowl'), quantity: 1 },
      { food: requireFood(foods, 'masala-chai'), quantity: 2, note: 'Less sugar' },
    ],
    discountAmount: 0,
    paymentId: 'pay_seed_ready_1002',
    providerOrderId: 'order_seed_ready_1002',
  });

  await upsertSeedOrder({
    orderNumber: 'CS-SEED-1003',
    invoiceNumber: 'INV-CS-SEED-1003',
    userId: firstCustomerId,
    couponId: coupons.get('CHAI20'),
    status: OrderStatus.PREPARING,
    placedAt: new Date('2026-06-07T05:30:00.000Z'),
    items: [
      { food: requireFood(foods, 'steamed-momos'), quantity: 1 },
      { food: requireFood(foods, 'lemon-iced-tea'), quantity: 1 },
    ],
    discountAmount: 27.6,
    paymentId: 'pay_seed_preparing_1003',
    providerOrderId: 'order_seed_preparing_1003',
  });
}

async function upsertSeedOrder(input: {
  orderNumber: string;
  invoiceNumber: string;
  userId: string;
  couponId?: string;
  status: OrderStatus;
  placedAt: Date;
  completedAt?: Date;
  items: Array<{
    food: { id: string; name: string; price: number; discountPrice?: number | null };
    quantity: number;
    note?: string;
  }>;
  discountAmount: number;
  paymentId: string;
  providerOrderId: string;
}) {
  const subtotalAmount = input.items.reduce((total, item) => {
    const unitPrice = item.food.discountPrice ?? item.food.price;
    return total + unitPrice * item.quantity;
  }, 0);
  const taxAmount = roundMoney(subtotalAmount * 0.05);
  const totalAmount = roundMoney(subtotalAmount + taxAmount - input.discountAmount);

  const order = await prisma.order.upsert({
    where: { orderNumber: input.orderNumber },
    update: {
      userId: input.userId,
      couponId: input.couponId,
      status: input.status,
      subtotalAmount,
      taxAmount,
      discountAmount: input.discountAmount,
      totalAmount,
      estimatedPrepMinutes: 12,
      placedAt: input.placedAt,
      completedAt: input.completedAt,
      cancelledAt: null,
    },
    create: {
      orderNumber: input.orderNumber,
      userId: input.userId,
      couponId: input.couponId,
      status: input.status,
      subtotalAmount,
      taxAmount,
      discountAmount: input.discountAmount,
      totalAmount,
      estimatedPrepMinutes: 12,
      placedAt: input.placedAt,
      completedAt: input.completedAt,
    },
  });

  await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
  await prisma.orderItem.createMany({
    data: input.items.map((item) => {
      const unitPrice = item.food.discountPrice ?? item.food.price;

      return {
        orderId: order.id,
        foodItemId: item.food.id,
        name: item.food.name,
        note: item.note,
        quantity: item.quantity,
        unitPrice,
        totalPrice: roundMoney(unitPrice * item.quantity),
      };
    }),
  });

  await prisma.payment.deleteMany({ where: { orderId: order.id } });
  await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: PaymentProvider.RAZORPAY,
      status: PaymentStatus.CAPTURED,
      amount: totalAmount,
      currency: 'INR',
      providerOrderId: input.providerOrderId,
      providerPaymentId: input.paymentId,
      rawPayload: { seeded: true, orderNumber: input.orderNumber },
    },
  });

  await prisma.invoice.upsert({
    where: { orderId: order.id },
    update: { invoiceNumber: input.invoiceNumber },
    create: {
      orderId: order.id,
      invoiceNumber: input.invoiceNumber,
    },
  });

  if (input.couponId) {
    await prisma.couponUsage.deleteMany({ where: { orderId: order.id } });
    await prisma.couponUsage.create({
      data: {
        couponId: input.couponId,
        userId: input.userId,
        orderId: order.id,
      },
    });
  }

  await prisma.notification.deleteMany({
    where: {
      userId: input.userId,
      title: `Seed order ${input.orderNumber}`,
    },
  });
  await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.status === OrderStatus.COMPLETED ? NotificationType.ORDER_COMPLETED : NotificationType.ORDER_PREPARING,
      title: `Seed order ${input.orderNumber}`,
      message: `Demo order ${input.orderNumber} is ${input.status.toLowerCase().replace(/_/g, ' ')}.`,
      readAt: input.status === OrderStatus.COMPLETED ? input.completedAt ?? input.placedAt : null,
      metadata: { orderNumber: input.orderNumber, seeded: true },
    },
  });
}

async function seedCustomerEngagement(
  firstCustomerId: string,
  secondCustomerId: string,
  foods: Map<string, { id: string; name: string; price: number; discountPrice?: number | null }>,
) {
  await upsertFavorite(firstCustomerId, requireFood(foods, 'classic-veg-burger').id);
  await upsertFavorite(firstCustomerId, requireFood(foods, 'chocolate-brownie').id);
  await upsertFavorite(secondCustomerId, requireFood(foods, 'paneer-rice-bowl').id);
  await upsertFavorite(secondCustomerId, requireFood(foods, 'masala-chai').id);

  await upsertReview(firstCustomerId, requireFood(foods, 'burger-coffee-combo').id, 5, 'Good value and fast pickup.');
  await upsertReview(firstCustomerId, requireFood(foods, 'chocolate-brownie').id, 5, 'Soft center, perfect after lunch.');
  await upsertReview(secondCustomerId, requireFood(foods, 'paneer-rice-bowl').id, 4, 'Filling bowl, chutney was nice.');
}

async function upsertFavorite(userId: string, foodItemId: string) {
  await prisma.favorite.upsert({
    where: { userId_foodItemId: { userId, foodItemId } },
    update: {},
    create: { userId, foodItemId },
  });
}

async function upsertReview(userId: string, foodItemId: string, rating: number, comment: string) {
  await prisma.review.upsert({
    where: { userId_foodItemId: { userId, foodItemId } },
    update: { rating, comment, isHidden: false },
    create: { userId, foodItemId, rating, comment },
  });
}

function requireFood(
  foods: Map<string, { id: string; name: string; price: number; discountPrice?: number | null }>,
  slug: string,
) {
  const food = foods.get(slug);

  if (!food) {
    throw new Error(`Missing seed food item: ${slug}`);
  }

  return food;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
