import { beforeEach, describe, expect, it } from 'vitest'
import { mockStorage } from '../vitest.setup'
import {
  createContentHash,
  createDraftRecords,
  findReusableDraftRecords,
  listDraftRecords,
  isPublishingAttemptStale,
  markDraftPublishing,
  registerDraftRecords,
  markDraftPublished,
  updateDraftRecordStatus,
} from '../src/background/draft-registry'
import type { DraftRecord, DraftSyncResult } from '@wechatsync/core'

const successResult: DraftSyncResult = {
  platform: 'zhihu',
  platformName: '知乎',
  draftName: '测试文章',
  postId: 'draft-1',
  postUrl: 'https://zhuanlan.zhihu.com/p/draft-1/edit',
  draftOnly: true,
  success: true,
  error: null,
  timestamp: 1_725_000_000_000,
}

beforeEach(() => {
  delete mockStorage.draftRecords
})

describe('draft registry', () => {
  it('creates a deterministic SHA-256 content hash', async () => {
    const first = await createContentHash({ title: '标题', markdown: '正文' })
    const second = await createContentHash({ title: '标题', markdown: '正文' })
    const changed = await createContentHash({ title: '标题', markdown: '另一篇正文' })

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(second).toBe(first)
    expect(changed).not.toBe(first)
  })

  it('only creates records for successful drafts with an ID', () => {
    const failed: DraftSyncResult = {
      ...successResult,
      platform: 'juejin',
      platformName: '稀土掘金',
      postId: null,
      postUrl: null,
      success: false,
      error: '未登录',
    }

    const records = createDraftRecords('sync-1', 'hash-1', [successResult, failed])

    expect(records).toEqual([{
      syncId: 'sync-1',
      platform: 'zhihu',
      platformName: '知乎',
      draftId: 'draft-1',
      draftName: '测试文章',
      draftUrl: 'https://zhuanlan.zhihu.com/p/draft-1/edit',
      contentHash: 'hash-1',
      createdAt: 1_725_000_000_000,
      status: 'draft_created',
    }])
  })

  it('refreshes an unpublished duplicate by platform and draft ID', async () => {
    const record = createDraftRecords('sync-1', 'hash-1', [successResult])[0]

    const [first, duplicate] = await Promise.all([
      registerDraftRecords([record]),
      registerDraftRecords([{
        ...record,
        syncId: 'sync-2',
        draftName: '更新后的标题',
        contentHash: 'hash-2',
        createdAt: record.createdAt + 1,
      }]),
    ])

    expect(first).toEqual({ created: 1, updated: 0, skipped: 0 })
    expect(duplicate).toEqual({ created: 0, updated: 1, skipped: 0 })
    expect(mockStorage.draftRecords).toHaveLength(1)
    expect(mockStorage.draftRecords[0]).toEqual(expect.objectContaining({
      syncId: 'sync-2',
      draftName: '更新后的标题',
      contentHash: 'hash-2',
    }))
  })

  it('does not overwrite an already published duplicate', async () => {
    const record = {
      ...createDraftRecords('sync-1', 'hash-1', [successResult])[0],
      status: 'published' as const,
      publishedPostId: 'public-1',
    }
    await registerDraftRecords([record])

    await expect(registerDraftRecords([{ ...record, syncId: 'sync-2', draftName: '新标题' }]))
      .resolves.toEqual({ created: 0, updated: 0, skipped: 1 })
    expect((await listDraftRecords())[0].draftName).toBe('测试文章')
  })

  it('skips duplicate keys within the same registration batch', async () => {
    const record = createDraftRecords('sync-1', 'hash-1', [successResult])[0]
    await expect(registerDraftRecords([record, { ...record }]))
      .resolves.toEqual({ created: 1, updated: 0, skipped: 1 })
    expect(await listDraftRecords()).toHaveLength(1)
  })

  it('lists records newest first and supports filters', async () => {
    const records: DraftRecord[] = [
      {
        ...createDraftRecords('sync-1', 'hash-1', [successResult])[0],
        createdAt: 1,
      },
      {
        ...createDraftRecords('sync-2', 'hash-2', [{
          ...successResult,
          platform: 'juejin',
          platformName: '稀土掘金',
          postId: 'draft-2',
        }])[0],
        createdAt: 2,
        status: 'ready_to_publish',
      },
    ]
    await registerDraftRecords(records)

    expect((await listDraftRecords()).map(record => record.syncId)).toEqual(['sync-2', 'sync-1'])
    expect(await listDraftRecords({ platform: 'zhihu' })).toHaveLength(1)
    expect(await listDraftRecords({ status: 'ready_to_publish' })).toHaveLength(1)
  })

  it('reuses the newest matching unpublished draft and ignores published records', async () => {
    const base = createDraftRecords('sync-1', 'same-hash', [successResult])[0]
    await registerDraftRecords([
      { ...base, draftId: 'older', createdAt: 1, status: 'ready_to_publish' },
      { ...base, draftId: 'newer', createdAt: 2, status: 'failed' },
      {
        ...base,
        platform: 'juejin',
        platformName: '稀土掘金',
        draftId: 'published',
        createdAt: 3,
        status: 'published',
      },
    ])

    const reusable = await findReusableDraftRecords(['zhihu', 'juejin'], 'same-hash')

    expect(reusable.map(record => record.draftId)).toEqual(['newer'])
  })

  it('updates a registered draft status', async () => {
    const record = createDraftRecords('sync-1', 'hash-1', [successResult])[0]
    await registerDraftRecords([record])

    expect(await updateDraftRecordStatus('zhihu', 'draft-1', 'published')).toBe(true)
    expect((await listDraftRecords())[0].status).toBe('published')
  })

  it('stores verified public publication data', async () => {
    const record = createDraftRecords('sync-1', 'hash-1', [successResult])[0]
    await registerDraftRecords([record])
    await markDraftPublished('zhihu', 'draft-1', {
      idempotencyKey: 'publish:zhihu:draft-1:hash-1',
      postId: 'public-1',
      postUrl: 'https://zhuanlan.zhihu.com/p/public-1',
      publishedAt: 2,
    })

    expect((await listDraftRecords())[0]).toEqual(expect.objectContaining({
      status: 'published',
      publishedPostId: 'public-1',
      publishedPostUrl: 'https://zhuanlan.zhihu.com/p/public-1',
      publishedAt: 2,
    }))
  })

  it('records an accepted review submission as publish success without a public URL', async () => {
    const record = createDraftRecords('sync-1', 'hash-1', [successResult])[0]
    await registerDraftRecords([record])
    await markDraftPublished('zhihu', 'draft-1', {
      idempotencyKey: 'publish:zhihu:draft-1:hash-1',
      postId: 'draft-1',
      postUrl: null,
      publishedAt: 3,
    })

    expect((await listDraftRecords())[0]).toEqual(expect.objectContaining({
      status: 'published',
      publishedPostId: 'draft-1',
      publishedAt: 3,
    }))
    expect((await listDraftRecords())[0].publishedPostUrl).toBeUndefined()
  })

  it('records publish attempt time and identifies stale publishing records', async () => {
    const record = createDraftRecords('sync-1', 'hash-1', [successResult])[0]
    await registerDraftRecords([record])
    await markDraftPublishing('zhihu', 'draft-1', 1_000)

    const [publishing] = await listDraftRecords()
    expect(publishing).toEqual(expect.objectContaining({
      status: 'publishing',
      lastPublishAttemptAt: 1_000,
    }))
    expect(isPublishingAttemptStale(publishing, 1_001)).toBe(false)
    expect(isPublishingAttemptStale(publishing, 1_000 + 10 * 60 * 1000)).toBe(true)
  })
})
