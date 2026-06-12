import { Injectable } from '@nestjs/common';
import { APP_NAME } from './common/constants/app.constants';

@Injectable()
export class AppService {
  getHello(): string {
    return `${APP_NAME} API`;
  }
}
