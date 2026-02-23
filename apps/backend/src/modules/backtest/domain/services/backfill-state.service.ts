import { Injectable } from '@nestjs/common';
import { BackfillRequest } from '../types';

@Injectable()
export class BackfillStateService {
  private readonly requests = new Map<string, BackfillRequest>();

  createRequest(symbol: string, barsCount: number): BackfillRequest {
    const totalChunks = Math.ceil(barsCount / 500);
    const request: BackfillRequest = {
      symbol,
      barsRequested: barsCount,
      barsIngested: 0,
      chunksReceived: 0,
      totalChunks,
      createdAt: new Date(),
    };
    this.requests.set(symbol, request);
    return request;
  }

  getRequest(symbol: string): BackfillRequest | undefined {
    return this.requests.get(symbol);
  }

  incrementProgress(symbol: string, barsCount: number): BackfillRequest | undefined {
    const request = this.requests.get(symbol);
    if (!request) return undefined;

    request.barsIngested += barsCount;
    request.chunksReceived += 1;
    return request;
  }

  completeRequest(symbol: string): void {
    this.requests.delete(symbol);
  }

  getAllRequests(): BackfillRequest[] {
    return Array.from(this.requests.values());
  }
}
