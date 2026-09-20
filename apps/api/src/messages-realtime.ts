import { Redis } from 'ioredis';
import type { ConversationEventRecord } from './domain.js';

export const CONVERSATION_EVENTS_CHANNEL = 'xianyu:conversation-events:v1';

type EventListener = (event: ConversationEventRecord) => void;

export interface RedisRealtimeHealth {
  configured: boolean;
  reachable: boolean;
  publisherStatus: string;
  subscriberStatus: string;
}

export interface RedisRealtimeOptions {
  channel?: string;
  sourceId?: string;
  onError?: (error: unknown) => void;
}

interface RedisEventEnvelope {
  sourceId: string;
  event: ConversationEventRecord;
}

/**
 * Redis transport for conversation events.
 *
 * The in-process hub remains the source of local delivery. This bridge only
 * transports committed events between API processes; Redis outages therefore
 * do not make a successful PostgreSQL message write fail.
 */
export class RedisConversationEventBridge {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly channel: string;
  private readonly sourceId: string;
  private readonly onEvent: EventListener;
  private readonly onError?: (error: unknown) => void;
  private closed = false;
  private subscribed = false;

  constructor(redisUrl: string, onEvent: EventListener, options: RedisRealtimeOptions = {}) {
    this.channel = options.channel ?? CONVERSATION_EVENTS_CHANNEL;
    this.sourceId = options.sourceId ?? `api-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    this.onEvent = onEvent;
    this.onError = options.onError;
    const redisOptions = {
      lazyConnect: true,
      connectTimeout: 1_000,
      enableReadyCheck: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt: number) => Math.min(1_000, Math.max(100, attempt * 100)),
    };
    this.publisher = new Redis(redisUrl, redisOptions);
    this.subscriber = new Redis(redisUrl, redisOptions);

    this.publisher.on('error', (error) => this.reportError(error));
    this.subscriber.on('error', (error) => this.reportError(error));
    this.subscriber.on('ready', () => {
      void this.ensureSubscription();
    });
    this.subscriber.on('message', (channel, raw) => {
      if (channel !== this.channel || this.closed) return;
      try {
        const envelope = JSON.parse(raw) as RedisEventEnvelope;
        if (!envelope || envelope.sourceId === this.sourceId || !envelope.event?.eventId) return;
        this.onEvent(envelope.event);
      } catch (error) {
        this.reportError(error);
      }
    });
  }

  start(): void {
    if (this.closed) return;
    void this.connect(this.publisher);
    void this.connect(this.subscriber);
  }

  async publish(event: ConversationEventRecord): Promise<void> {
    if (this.closed || this.publisher.status !== 'ready') return;
    const envelope: RedisEventEnvelope = { sourceId: this.sourceId, event };
    try {
      await this.publisher.publish(this.channel, JSON.stringify(envelope));
    } catch (error) {
      this.reportError(error);
    }
  }

  async health(): Promise<RedisRealtimeHealth> {
    if (this.closed) return { configured: true, reachable: false, publisherStatus: this.publisher.status, subscriberStatus: this.subscriber.status };
    try {
      await this.connect(this.publisher);
      await this.publisher.ping();
      return { configured: true, reachable: true, publisherStatus: this.publisher.status, subscriberStatus: this.subscriber.status };
    } catch (error) {
      this.reportError(error);
      return { configured: true, reachable: false, publisherStatus: this.publisher.status, subscriberStatus: this.subscriber.status };
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const clients = [this.publisher, this.subscriber];
    await Promise.all(clients.map(async (client) => {
      if (client.status === 'ready' || client.status === 'connecting' || client.status === 'reconnecting') {
        try { await client.quit(); } catch { client.disconnect(); }
      } else {
        client.disconnect();
      }
    }));
  }

  private async connect(client: Redis): Promise<void> {
    if (this.closed || client.status === 'ready' || client.status === 'connecting' || client.status === 'reconnecting') return;
    try {
      await client.connect();
    } catch (error) {
      this.reportError(error);
    }
  }

  private async ensureSubscription(): Promise<void> {
    if (this.closed || this.subscriber.status !== 'ready' || this.subscribed) return;
    try {
      await this.subscriber.subscribe(this.channel);
      this.subscribed = true;
    } catch (error) {
      this.subscribed = false;
      this.reportError(error);
    }
  }

  private reportError(error: unknown): void {
    try { this.onError?.(error); } catch { /* diagnostics must not affect realtime */ }
  }
}
