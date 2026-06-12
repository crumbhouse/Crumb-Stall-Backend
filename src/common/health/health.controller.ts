import { Controller, Get } from '@nestjs/common';
import { APP_NAME } from '../constants/app.constants';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      service: APP_NAME,
      timestamp: new Date().toISOString(),
    };
  }
}
