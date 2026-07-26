import type { Client } from 'pg';

import {
  syncEventV2Schema,
  uuidV7Schema,
  type MaintainerSyncEventV2,
  type PrivateSyncEventV2,
  type PublicSyncEventV2,
  type SyncEventV2,
} from '@ddl-tracker/contracts';

type EventDraft<Event extends { type: string; payload: unknown }> =
  Event extends unknown
    ? { type: Event['type']; payload: Event['payload'] }
    : never;

type AuthenticatedGlobalEvent = Extract<
  PublicSyncEventV2,
  {
    type:
      | 'catalog_revision_changed'
      | 'public_user_profile_updated'
      | 'public_user_deleted'
      | 'class_section_deactivated';
  }
>;
type ClassSectionPublicEvent = Exclude<
  PublicSyncEventV2,
  AuthenticatedGlobalEvent
>;

interface EventMetadata {
  occurredAt: Date;
  eventId?: string;
}

export type SyncEventDraft = EventMetadata &
  (
    | {
        scope: 'private_user';
        userId: string;
        event: EventDraft<PrivateSyncEventV2>;
      }
    | {
        scope: 'class_section_public';
        classSectionId: string;
        event: EventDraft<ClassSectionPublicEvent>;
      }
    | {
        scope: 'authenticated_global';
        event: EventDraft<AuthenticatedGlobalEvent>;
      }
    | {
        scope: 'maintainer_private';
        event: EventDraft<MaintainerSyncEventV2>;
      }
  );

export class PostgresSyncEventStore {
  readonly #client: Client;
  readonly #createId: () => string;

  constructor(client: Client, options: { createId: () => string }) {
    this.#client = client;
    this.#createId = options.createId;
  }

  async append(draft: SyncEventDraft): Promise<SyncEventV2> {
    const event = syncEventV2Schema.parse({
      event_id: draft.eventId ?? this.#createId(),
      schema_version: 2,
      ...draft.event,
      occurred_at: draft.occurredAt.toISOString(),
    });
    const target = scopeTarget(draft);

    await this.#client.query(
      `insert into sync_events (
         event_id, scope, scope_user_id, class_section_id, type,
         schema_version, payload, occurred_at
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        event.event_id,
        draft.scope,
        target.userId,
        target.classSectionId,
        event.type,
        event.schema_version,
        JSON.stringify(event.payload),
        draft.occurredAt,
      ],
    );

    return event;
  }
}

function scopeTarget(draft: SyncEventDraft): {
  userId: string | null;
  classSectionId: string | null;
} {
  switch (draft.scope) {
    case 'private_user':
      return {
        userId: uuidV7Schema.parse(draft.userId),
        classSectionId: null,
      };
    case 'class_section_public':
      return {
        userId: null,
        classSectionId: uuidV7Schema.parse(draft.classSectionId),
      };
    case 'authenticated_global':
    case 'maintainer_private':
      return { userId: null, classSectionId: null };
  }
}
