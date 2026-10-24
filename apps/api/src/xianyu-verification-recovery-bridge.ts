import { Redis } from 'ioredis';

const CHANNEL = 'xianyu:verification-recovery:v1';
export interface VerificationRecoveryRequest {
  adminId: string;
  accountId: string;
  source: string;
}

/** Committed database risk is authoritative; Redis wakes the browser owner. */
export class XianyuVerificationRecoveryBridge {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private closed = false;
  private consuming = false;
  private onReady?: () => Promise<void>;

  constructor(redisUrl: string, private readonly onRequest: (request: VerificationRecoveryRequest) => void) {
    const options = { lazyConnect: true, connectTimeout: 1_000, commandTimeout: 2_000, maxRetriesPerRequest: 1,
      retryStrategy: (attempt: number) => Math.min(1_000, attempt * 100) };
    this.publisher = new Redis(redisUrl, options);
    this.subscriber = new Redis(redisUrl, options);
    for (const client of [this.publisher, this.subscriber]) client.on('error', () => this.reportError('redis_unavailable'));
    this.subscriber.on('ready', () => {
      if (this.closed || !this.consuming) return;
      void this.subscriber.subscribe(CHANNEL).then(async () => {
        // Replay committed risk after reconnect, including missed pub/sub wakes.
        if (!this.closed) await this.onReady?.();
      }).catch(() => this.reportError('subscribe_failed'));
    });
    this.subscriber.on('message', (channel, raw) => {
      if (this.closed || !this.consuming || channel !== CHANNEL) return;
      try {
        const request = JSON.parse(raw) as VerificationRecoveryRequest;
        if (![request?.adminId, request?.accountId, request?.source].every(value => typeof value === 'string' && value.length > 0 && value.length <= 128)) return;
        this.onRequest({ adminId: request.adminId, accountId: request.accountId, source: request.source });
      } catch { this.reportError('invalid_request'); }
    });
  }

  startPublisher(): void {
    if (!this.closed && this.publisher.status === 'wait') void this.publisher.connect().catch(() => this.reportError('publish_connect_failed'));
  }

  startConsumer(onReady: () => Promise<void>): void {
    if (this.closed || this.consuming) return;
    this.consuming = true;
    this.onReady = onReady;
    void this.subscriber.connect().catch(() => this.reportError('subscribe_connect_failed'));
  }

  async publish(request: VerificationRecoveryRequest): Promise<void> {
    if (this.closed) return;
    try { await this.publisher.publish(CHANNEL, JSON.stringify(request)); }
    catch { this.reportError('publish_failed'); }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.publisher.disconnect();
    this.subscriber.disconnect();
  }

  private reportError(errorCode: string): void {
    if (!this.closed) console.warn(JSON.stringify({ component: 'xianyu-verification-recovery', event: 'bridge_error', errorCode }));
  }
}
