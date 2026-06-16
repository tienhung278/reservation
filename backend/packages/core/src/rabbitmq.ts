import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import amqp, { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { EVENT_EXCHANGE, EventEnvelope } from '../../../packages/contracts/src';
import { optionalEnv, requireEnv } from './config';
import { logError, logInfo } from './logger';
import { DbClient, PostgresService } from './postgres';

@Injectable()
export class RabbitMqService implements OnModuleDestroy {
  private connection?: ChannelModel;
  private channel?: Channel;

  async publish<TData>(
    routingKey: string,
    event: EventEnvelope<TData>,
  ): Promise<void> {
    const channel = await this.getChannel();
    channel.publish(
      EVENT_EXCHANGE,
      routingKey,
      Buffer.from(JSON.stringify(event)),
      {
        contentType: 'application/json',
        deliveryMode: 2,
        messageId: event.id,
        timestamp: Math.floor(Date.now() / 1000),
      },
    );
  }

  async consume<TData>(input: {
    queue: string;
    bindingKeys: string[];
    handler: (event: EventEnvelope<TData>) => Promise<void>;
  }): Promise<void> {
    const channel = await this.getChannel();
    await channel.assertQueue(input.queue, { durable: true });
    for (const bindingKey of input.bindingKeys) {
      await channel.bindQueue(input.queue, EVENT_EXCHANGE, bindingKey);
    }

    await channel.consume(input.queue, (message) => {
      if (!message) {
        return;
      }

      void this.handleMessage(message, input.handler);
    });
  }

  async ready(): Promise<boolean> {
    try {
      await this.getChannel();
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  private async getChannel(): Promise<Channel> {
    if (this.channel) {
      return this.channel;
    }

    const connection = await amqp.connect(requireEnv('RABBITMQ_URL'));
    const channel = await connection.createChannel();
    await channel.assertExchange(EVENT_EXCHANGE, 'topic', { durable: true });
    this.connection = connection;
    this.channel = channel;

    return channel;
  }

  private async handleMessage<TData>(
    message: ConsumeMessage,
    handler: (event: EventEnvelope<TData>) => Promise<void>,
  ): Promise<void> {
    const channel = await this.getChannel();
    try {
      const event = JSON.parse(
        message.content.toString('utf8'),
      ) as EventEnvelope<TData>;
      await handler(event);
      channel.ack(message);
    } catch (error) {
      logError({
        action: 'rabbitmq_consume_failed',
        error,
        routingKey: message.fields.routingKey,
      });
      channel.nack(message, false, false);
    }
  }
}

export async function appendOutbox<TData>(input: {
  client: DbClient;
  producer: EventEnvelope<TData>['producer'];
  routingKey: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  data: TData;
  traceId?: string;
}): Promise<EventEnvelope<TData>> {
  const event: EventEnvelope<TData> = {
    id: randomUUID(),
    type: input.eventType,
    version: 1,
    producer: input.producer,
    occurredAt: new Date().toISOString(),
    traceId: input.traceId,
    data: input.data,
  };

  await input.client.query(
    `
      INSERT INTO eventing.outbox (
        id, producer, aggregate_type, aggregate_id, event_type, routing_key, payload, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
    `,
    [
      event.id,
      input.producer,
      input.aggregateType,
      input.aggregateId,
      input.eventType,
      input.routingKey,
      JSON.stringify(event),
    ],
  );

  return event;
}

export async function publishPendingOutbox(input: {
  postgres: PostgresService;
  rabbit: RabbitMqService;
  producer: EventEnvelope<unknown>['producer'];
  batchSize?: number;
}): Promise<number> {
  const batchSize =
    input.batchSize ?? Number(optionalEnv('OUTBOX_BATCH_SIZE', '25'));

  return await input.postgres.transaction(async (client) => {
    const rows = await client.query<{
      id: string;
      routing_key: string;
      payload: EventEnvelope<unknown>;
      attempts: number;
    }>(
      `
        SELECT id, routing_key, payload, attempts
        FROM eventing.outbox
        WHERE producer = $1
          AND status = 'pending'
          AND available_at <= now()
        ORDER BY created_at
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      `,
      [input.producer, batchSize],
    );

    for (const row of rows.rows) {
      try {
        await input.rabbit.publish(row.routing_key, row.payload);
        await client.query(
          `
            UPDATE eventing.outbox
            SET status = 'published', published_at = now(), attempts = attempts + 1
            WHERE id = $1
          `,
          [row.id],
        );
        logInfo({
          action: 'outbox_published',
          eventId: row.id,
          producer: input.producer,
        });
      } catch (error) {
        await client.query(
          `
            UPDATE eventing.outbox
            SET attempts = attempts + 1,
                available_at = now() + interval '10 seconds',
                status = CASE WHEN attempts + 1 >= 10 THEN 'dead' ELSE 'pending' END
            WHERE id = $1
          `,
          [row.id],
        );
        logError({
          action: 'outbox_publish_failed',
          eventId: row.id,
          producer: input.producer,
          error,
        });
      }
    }

    return rows.rowCount ?? 0;
  });
}

export async function recordInbox(input: {
  client: DbClient;
  eventId: string;
  consumer: string;
}): Promise<boolean> {
  const inserted = await input.client.query(
    `
      INSERT INTO eventing.inbox (event_id, consumer, processed_at)
      VALUES ($1, $2, now())
      ON CONFLICT (event_id, consumer) DO NOTHING
    `,
    [input.eventId, input.consumer],
  );

  return (inserted.rowCount ?? 0) > 0;
}
