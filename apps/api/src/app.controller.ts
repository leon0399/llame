import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Liveness probe — deliberately public (no data, no tenant surface).
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
