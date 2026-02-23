export interface RequestHistoricalBackfillResult {
  message: string;
  barsRequested: number;
  totalChunks: number;
  note: string;
}

export interface IngestHistoricalChunkResult {
  message: string;
  symbol: string;
  chunkNumber: number;
  totalChunks: number;
  barsIngested: number;
  barsInChunk: number;
}

export interface CompleteHistoricalBackfillResult {
  message: string;
  symbol: string;
  barsIngested: number;
  chunksReceived: number;
}
