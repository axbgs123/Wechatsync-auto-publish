import { describe, expect, it } from 'vitest'
import type { DraftRecord } from '@wechatsync/core'
import {
  appendPublishAudit,
  createPublishIdempotencyKey,
  hasSuccessfulPublish,
  listPublishAudit,
} from '../src/publisher/audit'

const record: DraftRecord = {
  syncId: 'sync-1',
  platform: 'zhihu',
  platformName: '知乎',
  draftId: '123',
  draftName: '测试文章',
  draftUrl: 'https://zhuanlan.zhihu.com/p/123/edit',
  contentHash: 'content-hash',
  createdAt: 1,
  status: 'draft_created',
}

describe('publish audit', () => {
  it('creates a stable idempotency key', () => {
    expect(createPublishIdempotencyKey(record)).toBe('publish:zhihu:123:content-hash')
    expect(createPublishIdempotencyKey({ ...record, syncId: 'sync-2' }))
      .toBe('publish:zhihu:123:content-hash')
  })

  it('records publish events without article content or credentials', async () => {
    const idempotencyKey = createPublishIdempotencyKey(record)
    await appendPublishAudit({
      record,
      idempotencyKey,
      event: 'publish_succeeded',
      resultStatus: 'published',
    })

    const [audit] = await listPublishAudit()
    expect(audit.idempotencyKey).toBe(idempotencyKey)
    expect(audit.event).toBe('publish_succeeded')
    expect(await hasSuccessfulPublish(idempotencyKey)).toBe(true)
    expect(audit).not.toHaveProperty('content')
    expect(audit).not.toHaveProperty('token')
    expect(audit).not.toHaveProperty('cookie')
  })
})
