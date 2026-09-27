import { Controller, Get } from '@nestjs/common';
@Controller('health')
export class HealthController {
  @Get() health() {
    return { status: 'ok', service: 'dts-api', timestamp: new Date().toISOString() };
  }
  @Get('ready') ready() {
    return { status: 'ready' };
  }
}
