import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  AnalyticsLimitQuery,
  AnalyticsRangeQuery,
} from './dto/analytics-query.dto';

const revenueStatuses: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.OTP_VERIFICATION_PENDING,
  OrderStatus.COMPLETED,
];

const liveQueueStatuses: OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.OTP_VERIFICATION_PENDING,
];

const statusLabels: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Pending payment',
  PAID: 'Paid',
  PLACED: 'Placed',
  CONFIRMED: 'Confirmed',
  PREPARING: 'Preparing',
  READY_FOR_PICKUP: 'Ready for pickup',
  OTP_VERIFICATION_PENDING: 'Ready for pickup',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
};

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const todayStart = startOfDay(new Date());
    const tomorrowStart = addDays(todayStart, 1);
    const revenueWhere = this.revenueOrderWhere(todayStart, tomorrowStart);

    const [
      todayRevenue,
      todayOrders,
      activeCustomers,
      liveQueueCount,
      completedOrdersToday,
      cancelledOrdersToday,
    ] = await this.prisma.$transaction([
      this.prisma.order.aggregate({
        where: revenueWhere,
        _sum: { totalAmount: true },
      }),
      this.prisma.order.count({ where: revenueWhere }),
      this.prisma.order.groupBy({
        by: ['userId'],
        where: revenueWhere,
        orderBy: { userId: 'asc' },
      }),
      this.prisma.order.count({
        where: {
          status: { in: liveQueueStatuses },
        },
      }),
      this.prisma.order.count({
        where: {
          status: OrderStatus.COMPLETED,
          placedAt: {
            gte: todayStart,
            lt: tomorrowStart,
          },
        },
      }),
      this.prisma.order.count({
        where: {
          status: { in: [OrderStatus.CANCELLED, OrderStatus.REFUNDED] },
          createdAt: {
            gte: todayStart,
            lt: tomorrowStart,
          },
        },
      }),
    ]);

    const revenueToday = todayRevenue._sum.totalAmount?.toNumber() ?? 0;

    return {
      data: {
        revenueToday,
        ordersToday: todayOrders,
        averageOrderValueToday:
          todayOrders > 0 ? Math.round(revenueToday / todayOrders) : 0,
        activeCustomersToday: activeCustomers.length,
        liveQueueCount,
        completedOrdersToday,
        cancelledOrdersToday,
      },
      meta: {
        startsAt: todayStart.toISOString(),
        endsAt: tomorrowStart.toISOString(),
      },
    };
  }

  async getRevenueTrend(query: AnalyticsRangeQuery) {
    const todayStart = startOfDay(new Date());
    const startsAt = addDays(todayStart, -(query.days - 1));
    const endsAt = addDays(todayStart, 1);
    const orders = await this.prisma.order.findMany({
      where: this.revenueOrderWhere(startsAt, endsAt),
      select: {
        placedAt: true,
        createdAt: true,
        totalAmount: true,
      },
    });

    const buckets = new Map<
      string,
      { date: string; revenue: number; orders: number }
    >();

    for (let dayIndex = 0; dayIndex < query.days; dayIndex += 1) {
      const date = addDays(startsAt, dayIndex);
      const key = formatDateKey(date);
      buckets.set(key, { date: key, revenue: 0, orders: 0 });
    }

    for (const order of orders) {
      const key = formatDateKey(order.placedAt ?? order.createdAt);
      const bucket = buckets.get(key);

      if (!bucket) {
        continue;
      }

      bucket.revenue += order.totalAmount.toNumber();
      bucket.orders += 1;
    }

    return {
      data: [...buckets.values()],
      meta: {
        days: query.days,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      },
    };
  }

  async getTopFoods(query: AnalyticsLimitQuery) {
    const endsAt = addDays(startOfDay(new Date()), 1);
    const startsAt = addDays(endsAt, -query.days);
    const items = await this.prisma.orderItem.findMany({
      where: {
        order: this.revenueOrderWhere(startsAt, endsAt),
      },
      select: {
        foodItemId: true,
        name: true,
        quantity: true,
        totalPrice: true,
      },
    });

    const totals = new Map<
      string,
      {
        foodItemId: string;
        name: string;
        quantitySold: number;
        revenue: number;
      }
    >();

    for (const item of items) {
      const existing = totals.get(item.foodItemId) ?? {
        foodItemId: item.foodItemId,
        name: item.name,
        quantitySold: 0,
        revenue: 0,
      };

      existing.quantitySold += item.quantity;
      existing.revenue += item.totalPrice.toNumber();
      totals.set(item.foodItemId, existing);
    }

    return {
      data: [...totals.values()]
        .sort(
          (first, second) =>
            second.quantitySold - first.quantitySold ||
            second.revenue - first.revenue,
        )
        .slice(0, query.limit),
      meta: {
        limit: query.limit,
        days: query.days,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      },
    };
  }

  async getLiveQueue(query: AnalyticsLimitQuery) {
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: liveQueueStatuses },
      },
      orderBy: [{ placedAt: 'asc' }, { createdAt: 'asc' }],
      take: query.limit,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        placedAt: true,
        pickupTime: true,
        totalAmount: true,
        items: {
          select: {
            name: true,
            quantity: true,
          },
        },
        user: {
          select: {
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    return {
      data: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        statusLabel: statusLabels[order.status],
        placedAt: order.placedAt?.toISOString() ?? null,
        pickupTime: order.pickupTime?.toISOString() ?? null,
        totalAmount: order.totalAmount.toNumber(),
        customer: order.user,
        itemPreview: order.items
          .slice(0, 3)
          .map((item) => `${item.quantity} x ${item.name}`),
      })),
      meta: {
        limit: query.limit,
      },
    };
  }

  async getCustomerInsights(query: AnalyticsLimitQuery) {
    const now = new Date();
    const last30DaysStart = addDays(startOfDay(now), -30);
    const [totalCustomers, newCustomers, orders] = await this.prisma.$transaction([
      this.prisma.user.count({
        where: {
          role: UserRole.CUSTOMER,
          isSuspended: false,
        },
      }),
      this.prisma.user.count({
        where: {
          role: UserRole.CUSTOMER,
          isSuspended: false,
          createdAt: { gte: last30DaysStart },
        },
      }),
      this.prisma.order.findMany({
        where: {
          status: { in: revenueStatuses },
          user: {
            role: UserRole.CUSTOMER,
            isSuspended: false,
          },
        },
        select: {
          userId: true,
          totalAmount: true,
          placedAt: true,
          createdAt: true,
          items: {
            select: {
              quantity: true,
            },
          },
          user: {
            select: {
              name: true,
              email: true,
              createdAt: true,
              lastActivity: true,
            },
          },
        },
      }),
    ]);

    const customers = new Map<
      string,
      {
        userId: string;
        name: string | null;
        email: string;
        joinedAt: Date;
        lastActivity: Date | null;
        lastOrderAt: Date | null;
        orderCount: number;
        itemCount: number;
        totalSpend: number;
      }
    >();

    for (const order of orders) {
      const orderDate = order.placedAt ?? order.createdAt;
      const existing = customers.get(order.userId) ?? {
        userId: order.userId,
        name: order.user.name,
        email: order.user.email,
        joinedAt: order.user.createdAt,
        lastActivity: order.user.lastActivity,
        lastOrderAt: null,
        orderCount: 0,
        itemCount: 0,
        totalSpend: 0,
      };

      existing.orderCount += 1;
      existing.itemCount += order.items.reduce((sum, item) => sum + item.quantity, 0);
      existing.totalSpend += order.totalAmount.toNumber();
      existing.lastOrderAt =
        !existing.lastOrderAt || orderDate > existing.lastOrderAt
          ? orderDate
          : existing.lastOrderAt;
      customers.set(order.userId, existing);
    }

    const customerList = [...customers.values()];
    const totalRevenue = customerList.reduce(
      (sum, customer) => sum + customer.totalSpend,
      0,
    );
    const activeCustomers30Days = customerList.filter(
      (customer) =>
        customer.lastOrderAt && customer.lastOrderAt >= last30DaysStart,
    ).length;
    const repeatCustomers = customerList.filter(
      (customer) => customer.orderCount > 1,
    ).length;

    return {
      data: {
        summary: {
          totalCustomers,
          newCustomers30Days: newCustomers,
          activeCustomers30Days,
          repeatCustomers,
          repeatRate:
            customerList.length > 0
              ? Math.round((repeatCustomers / customerList.length) * 100)
              : 0,
          averageLifetimeValue:
            customerList.length > 0
              ? Math.round(totalRevenue / customerList.length)
              : 0,
        },
        customers: customerList
          .sort(
            (first, second) =>
              second.totalSpend - first.totalSpend ||
              second.orderCount - first.orderCount,
          )
          .slice(0, query.limit)
          .map((customer) => ({
            userId: customer.userId,
            name: customer.name,
            email: customer.email,
            joinedAt: customer.joinedAt.toISOString(),
            lastActivity: customer.lastActivity?.toISOString() ?? null,
            lastOrderAt: customer.lastOrderAt?.toISOString() ?? null,
            orderCount: customer.orderCount,
            itemCount: customer.itemCount,
            totalSpend: customer.totalSpend,
            averageOrderValue:
              customer.orderCount > 0
                ? Math.round(customer.totalSpend / customer.orderCount)
                : 0,
          })),
      },
      meta: {
        limit: query.limit,
        startsAt: last30DaysStart.toISOString(),
        endsAt: now.toISOString(),
      },
    };
  }

  private revenueOrderWhere(
    startsAt: Date,
    endsAt: Date,
  ): Prisma.OrderWhereInput {
    return {
      status: { in: revenueStatuses },
      OR: [
        {
          placedAt: {
            gte: startsAt,
            lt: endsAt,
          },
        },
        {
          placedAt: null,
          createdAt: {
            gte: startsAt,
            lt: endsAt,
          },
        },
      ],
    };
  }
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);

  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);

  return copy;
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
