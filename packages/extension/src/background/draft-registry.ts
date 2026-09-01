import type {
  DraftRecord,
  DraftRecordQuery,
  DraftSyncResult,
} from '@wechatsync/core'

const DRAFT_RECORDS_KEY = 'draftRecords'

let writeQueue: Promise<void> = Promise.resolve()

function recordKey(record: Pick<DraftRecord, 'platform' | 'draftId'>): string {
  return `${record.platform}\u0000${record.draftId}`
}

/** 计算发布队列使用的稳定 SHA-256 内容摘要。 */
export async function createContentHash(article: {
  title: string
  markdown?: string
  html?: string
  content?: string
}): Promise<string> {
  const body = article.markdown || article.html || article.content || ''
  const bytes = new TextEncoder().encode(`${article.title}\u0000${body}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)

  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** 只为实际创建成功且具有平台草稿 ID 的结果生成记录。 */
export function createDraftRecords(
  syncId: string,
  contentHash: string,
  results: DraftSyncResult[]
): DraftRecord[] {
  return results
    .filter((result): result is DraftSyncResult & { postId: string } => (
      result.success && result.draftOnly && Boolean(result.postId)
    ))
    .map(result => ({
      syncId,
      platform: result.platform,
      platformName: result.platformName,
      draftId: result.postId,
      draftName: result.draftName,
      draftUrl: result.postUrl,
      contentHash,
      createdAt: result.timestamp,
      status: 'draft_created',
    }))
}

export interface DraftRegistrationResult {
  created: number
  updated: number
  skipped: number
}

/**
 * 串行写入 Chrome storage，以 platform + draftId 为幂等键防止重复登记。
 */
export function registerDraftRecords(records: DraftRecord[]): Promise<DraftRegistrationResult> {
  const operation = writeQueue.then(async () => {
    const storage = await chrome.storage.local.get(DRAFT_RECORDS_KEY)
    const existing = Array.isArray(storage[DRAFT_RECORDS_KEY])
      ? storage[DRAFT_RECORDS_KEY] as DraftRecord[]
      : []
    const existingByKey = new Map(existing.map(record => [recordKey(record), record]))
    const newRecords: DraftRecord[] = []
    const newRecordKeys = new Set<string>()
    const updates = new Map<string, DraftRecord>()

    for (const record of records) {
      const key = recordKey(record)
      const current = existingByKey.get(key)
      if (current) {
        if (newRecordKeys.has(key)) continue
        if (current.status === 'published' || current.status === 'publishing') continue
        updates.set(key, {
          ...current,
          syncId: record.syncId,
          platformName: record.platformName,
          draftName: record.draftName,
          draftUrl: record.draftUrl,
          contentHash: record.contentHash,
          createdAt: record.createdAt,
          status: 'draft_created',
          lastPublishAttemptAt: undefined,
        })
        continue
      }

      existingByKey.set(key, record)
      newRecordKeys.add(key)
      newRecords.push(record)
    }

    if (newRecords.length > 0 || updates.size > 0) {
      const refreshedExisting = existing.map(record => updates.get(recordKey(record)) || record)
      await chrome.storage.local.set({
        [DRAFT_RECORDS_KEY]: [...newRecords, ...refreshedExisting],
      })
    }

    return {
      created: newRecords.length,
      updated: updates.size,
      skipped: records.length - newRecords.length - updates.size,
    }
  })

  writeQueue = operation.then(() => undefined, () => undefined)
  return operation
}

export const STALE_PUBLISHING_MS = 10 * 60 * 1000

export function isPublishingAttemptStale(
  record: DraftRecord,
  now: number = Date.now(),
): boolean {
  if (record.status !== 'publishing') return false
  if (!record.lastPublishAttemptAt) return true
  return now - record.lastPublishAttemptAt >= STALE_PUBLISHING_MS
}

/** 原子记录发布尝试时间，供崩溃恢复判断使用。 */
export function markDraftPublishing(
  platform: string,
  draftId: string,
  attemptedAt: number = Date.now(),
): Promise<boolean> {
  const operation = writeQueue.then(async () => {
    const storage = await chrome.storage.local.get(DRAFT_RECORDS_KEY)
    const records = Array.isArray(storage[DRAFT_RECORDS_KEY])
      ? storage[DRAFT_RECORDS_KEY] as DraftRecord[]
      : []
    let updated = false
    const nextRecords = records.map(record => {
      if (record.platform !== platform || record.draftId !== draftId) return record
      updated = true
      return { ...record, status: 'publishing' as const, lastPublishAttemptAt: attemptedAt }
    })

    if (updated) await chrome.storage.local.set({ [DRAFT_RECORDS_KEY]: nextRecords })
    return updated
  })

  writeQueue = operation.then(() => undefined, () => undefined)
  return operation
}

/** 返回按创建时间倒序排列的草稿记录，可按平台或状态过滤。 */
export async function listDraftRecords(query: DraftRecordQuery = {}): Promise<DraftRecord[]> {
  await writeQueue

  const storage = await chrome.storage.local.get(DRAFT_RECORDS_KEY)
  const records = Array.isArray(storage[DRAFT_RECORDS_KEY])
    ? storage[DRAFT_RECORDS_KEY] as DraftRecord[]
    : []

  return records
    .filter(record => !query.platform || record.platform === query.platform)
    .filter(record => !query.status || record.status === query.status)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** 按内容摘要查找各平台最近的未发布草稿，避免再次同步时重复创建。 */
export async function findReusableDraftRecords(
  platforms: string[],
  contentHash: string
): Promise<DraftRecord[]> {
  const requested = new Set(platforms)
  const reusable = new Map<string, DraftRecord>()

  for (const record of await listDraftRecords()) {
    if (!requested.has(record.platform)) continue
    if (record.contentHash !== contentHash) continue
    if (record.status === 'published') continue
    if (!reusable.has(record.platform)) reusable.set(record.platform, record)
  }

  return platforms.flatMap(platform => {
    const record = reusable.get(platform)
    return record ? [record] : []
  })
}

/** 更新发布队列状态，供独立发布器使用。 */
export function updateDraftRecordStatus(
  platform: string,
  draftId: string,
  status: DraftRecord['status']
): Promise<boolean> {
  const operation = writeQueue.then(async () => {
    const storage = await chrome.storage.local.get(DRAFT_RECORDS_KEY)
    const records = Array.isArray(storage[DRAFT_RECORDS_KEY])
      ? storage[DRAFT_RECORDS_KEY] as DraftRecord[]
      : []
    let updated = false
    const nextRecords = records.map(record => {
      if (record.platform !== platform || record.draftId !== draftId) return record
      updated = true
      if (status === 'published') return { ...record, status }
      const {
        publishIdempotencyKey: _publishIdempotencyKey,
        publishedPostId: _publishedPostId,
        publishedPostUrl: _publishedPostUrl,
        publishedAt: _publishedAt,
        ...draft
      } = record
      return { ...draft, status }
    })

    if (updated) {
      await chrome.storage.local.set({ [DRAFT_RECORDS_KEY]: nextRecords })
    }
    return updated
  })

  writeQueue = operation.then(() => undefined, () => undefined)
  return operation
}

/** 保存已经验证成功的公开文章信息。 */
export function markDraftPublished(
  platform: string,
  draftId: string,
  publication: {
    idempotencyKey: string
    postId: string
    postUrl?: string | null
    publishedAt: number
  }
): Promise<boolean> {
  const operation = writeQueue.then(async () => {
    const storage = await chrome.storage.local.get(DRAFT_RECORDS_KEY)
    const records = Array.isArray(storage[DRAFT_RECORDS_KEY])
      ? storage[DRAFT_RECORDS_KEY] as DraftRecord[]
      : []
    let updated = false
    const nextRecords = records.map(record => {
      if (record.platform !== platform || record.draftId !== draftId) return record
      updated = true
      return {
        ...record,
        status: 'published' as const,
        publishIdempotencyKey: publication.idempotencyKey,
        publishedPostId: publication.postId,
        ...(publication.postUrl ? { publishedPostUrl: publication.postUrl } : {}),
        publishedAt: publication.publishedAt,
      }
    })

    if (updated) await chrome.storage.local.set({ [DRAFT_RECORDS_KEY]: nextRecords })
    return updated
  })

  writeQueue = operation.then(() => undefined, () => undefined)
  return operation
}

/** 同步完成后的批量登记入口。 */
export async function registerSyncDrafts(
  syncId: string,
  article: { title: string; markdown?: string; html?: string; content?: string },
  results: DraftSyncResult[]
): Promise<DraftRegistrationResult> {
  const successfulDrafts = results.filter(result => result.success && result.postId)
  if (successfulDrafts.length === 0) return { created: 0, updated: 0, skipped: 0 }

  const contentHash = await createContentHash(article)
  return registerDraftRecords(createDraftRecords(syncId, contentHash, successfulDrafts))
}
