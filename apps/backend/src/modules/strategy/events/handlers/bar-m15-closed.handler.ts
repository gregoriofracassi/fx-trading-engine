import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { Injectable } from '@nestjs/common';
import { BarM15ClosedEvent } from '../../../ea-gateway/events/bar-m15-closed.event';
import { AsiaRangeService } from '../../domain/services/asia-range.service';

@Injectable()
@EventsHandler(BarM15ClosedEvent)
export class BarM15ClosedHandler implements IEventHandler<BarM15ClosedEvent> {
  constructor(private readonly asiaRangeService: AsiaRangeService) {}

  async handle(event: BarM15ClosedEvent): Promise<void> {
    await this.asiaRangeService.processBar(event.symbol, event.timeOpen, event.high, event.low);
  }
}
