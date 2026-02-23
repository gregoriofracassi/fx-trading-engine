export interface BackfillRequest {
  symbol: string;
  barsRequested: number;
  barsIngested: number;
  chunksReceived: number;
  totalChunks: number;
  createdAt: Date;
}
