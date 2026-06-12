import { Injectable, MessageEvent } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { Observable, Subject, filter, interval, map, merge, startWith } from 'rxjs';

type BaseLiveEvent = {
  createdAt: string;
  orderNumber?: string;
  status?: OrderStatus;
};

type CustomerLiveEvent = BaseLiveEvent & {
  scope: 'customer';
  userId: string;
  type: 'connected' | 'heartbeat' | 'notification' | 'order-status';
  notificationId?: string;
};

type AdminLiveEvent = BaseLiveEvent & {
  scope: 'admin';
  type: 'admin-order-updated' | 'connected' | 'heartbeat';
};

type LiveEvent = CustomerLiveEvent | AdminLiveEvent;

@Injectable()
export class LiveEventsService {
  private readonly events$ = new Subject<LiveEvent>();

  customerEvents(userId: string): Observable<MessageEvent> {
    return merge(
      this.events$.pipe(
        filter(
          (event): event is CustomerLiveEvent =>
            event.scope === 'customer' && event.userId === userId,
        ),
      ),
      this.heartbeat('customer', userId),
    ).pipe(
      map((event) => toMessageEvent(event)),
      startWith(
        toMessageEvent({
          scope: 'customer',
          userId,
          type: 'connected',
          createdAt: new Date().toISOString(),
        }),
      ),
    );
  }

  adminEvents(): Observable<MessageEvent> {
    return merge(
      this.events$.pipe(
        filter((event): event is AdminLiveEvent => event.scope === 'admin'),
      ),
      this.heartbeat('admin'),
    ).pipe(
      map((event) => toMessageEvent(event)),
      startWith(
        toMessageEvent({
          scope: 'admin',
          type: 'connected',
          createdAt: new Date().toISOString(),
        }),
      ),
    );
  }

  emitCustomerNotification(input: {
    userId: string;
    notificationId: string;
    orderNumber?: string;
    status?: OrderStatus;
  }) {
    this.events$.next({
      scope: 'customer',
      type: 'notification',
      userId: input.userId,
      notificationId: input.notificationId,
      orderNumber: input.orderNumber,
      status: input.status,
      createdAt: new Date().toISOString(),
    });
  }

  emitCustomerOrderStatus(input: {
    userId: string;
    orderNumber: string;
    status: OrderStatus;
  }) {
    this.events$.next({
      scope: 'customer',
      type: 'order-status',
      userId: input.userId,
      orderNumber: input.orderNumber,
      status: input.status,
      createdAt: new Date().toISOString(),
    });
  }

  emitAdminOrderUpdated(input: { orderNumber: string; status: OrderStatus }) {
    this.events$.next({
      scope: 'admin',
      type: 'admin-order-updated',
      orderNumber: input.orderNumber,
      status: input.status,
      createdAt: new Date().toISOString(),
    });
  }

  private heartbeat(scope: 'admin'): Observable<AdminLiveEvent>;
  private heartbeat(
    scope: 'customer',
    userId: string,
  ): Observable<CustomerLiveEvent>;
  private heartbeat(scope: 'admin' | 'customer', userId?: string) {
    return interval(25_000).pipe(
      map(() => ({
        scope,
        ...(scope === 'customer' ? { userId: userId! } : {}),
        type: 'heartbeat',
        createdAt: new Date().toISOString(),
      })),
    );
  }
}

function toMessageEvent(event: LiveEvent): MessageEvent {
  return {
    data: event,
  };
}
