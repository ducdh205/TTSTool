import { Controller, Get, ParseEnumPipe, Query } from '@nestjs/common';
import { REGIONS, REGION_IDS, type RegionId } from '../common/constants';
import { VoicesService } from './voices.service';

@Controller()
export class VoicesController {
  constructor(private readonly voices: VoicesService) {}

  @Get('regions')
  regions() {
    return REGIONS;
  }

  @Get('voices')
  list(@Query('region', new ParseEnumPipe(REGION_IDS, { optional: true })) region?: RegionId) {
    return this.voices.list(region);
  }
}
