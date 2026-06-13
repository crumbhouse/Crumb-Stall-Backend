import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    console.log('PRISMA CONNECT START');

    await this.$connect();

    console.log('PRISMA CONNECT SUCCESS');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
