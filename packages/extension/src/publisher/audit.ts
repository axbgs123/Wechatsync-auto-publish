import type {
  DraftPublishResultStatus,
  DraftRecord,
  PublishAuditEvent,
  PublishAuditRecord,
} from '@wechatsync/core'

const PUBLISH_AUDIT_KEY = 'publishAuditLog'
let auditWriteQueue: Promise<void> = Promise.resolve()

export function createPublishIdempotencyKey(record: DraftRecord): string {
  return `publish:${record.platform}:${record.draftId}:${record.contentHash}`
}

export function appendPublishAudit(input: {
  record: DraftRecord
  idempotencyKey: string
  event: PublishAuditEvent
  resultStatus?: DraftPublishResultStatus | null
  error?: string | null
}): Promise<PublishAuditRecord> {
  const operation = auditWriteQueue.then(async () => {
    const auditRecord: PublishAuditRecord = {
      id: `audit_${Date.now()}_${crypto.randomUUID()}`,
      idempotencyKey: input.idempotencyKey,
      platform: input.record.platform,
      draftId: input.record.draftId,
      draftName: input.record.draftName,
      event: input.event,
      resultStatus: input.resultStatus ?? null,
      error: input.error ?? null,
      createdAt: Date.now(),
    }
    const storage = await chrome.storage.local.get(PUBLISH_AUDIT_KEY)
    const existing = Array.isArray(storage[PUBLISH_AUDIT_KEY])
      ? storage[PUBLISH_AUDIT_KEY] as PublishAuditRecord[]
      : []
    await chrome.storage.local.set({ [PUBLISH_AUDIT_KEY]: [auditRecord, ...existing] })
    return auditRecord
  })

  auditWriteQueue = operation.then(() => undefined, () => undefined)
  return operation
}

export async function listPublishAudit(): Promise<PublishAuditRecord[]> {
  await auditWriteQueue
  const storage = await chrome.storage.local.get(PUBLISH_AUDIT_KEY)
  return Array.isArray(storage[PUBLISH_AUDIT_KEY])
    ? storage[PUBLISH_AUDIT_KEY] as PublishAuditRecord[]
    : []
}

export async function hasSuccessfulPublish(idempotencyKey: string): Promise<boolean> {
  const records = await listPublishAudit()
  return records.some(record => (
    record.idempotencyKey === idempotencyKey && record.event === 'publish_succeeded'
  ))
}
