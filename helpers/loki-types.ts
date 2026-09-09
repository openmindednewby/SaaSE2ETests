/**
 * Shared type definitions for the Loki HTTP client (`loki-client.ts`).
 * Split out to keep that file under the max-file-lines limit.
 */

/** Shape of a single log stream returned by Loki */
export interface LokiStream {
  stream: Record<string, string>;
  values: Array<[string, string]>; // [nanosecond-timestamp, log-line]
}

/** Shape of a Loki query result */
export interface LokiQueryResult {
  status: string;
  data: {
    resultType: 'streams' | 'matrix' | 'vector' | 'scalar';
    result: LokiStream[];
    stats?: Record<string, unknown>;
  };
}
