import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DraftRecord, RuntimeInterface } from '@wechatsync/core'
import { ZhihuDraftPublisher, summarizeHtml } from '../src/publisher/zhihu'
import { publishDraftByUserAction } from '../src/publisher'
import { listDraftRecords, registerDraftRecords } from '../src/background/draft-registry'
import { listPublishAudit } from '../src/publisher/audit'

const record: DraftRecord = {
  syncId: 'sync-1',
  platform: 'zhihu',
  platformName: '知乎',
  draftId: '123',
  draftName: '测试文章',
  draftUrl: 'https://zhuanlan.zhihu.com/p/123/edit',
  contentHash: 'hash',
  createdAt: 1,
  status: 'draft_created',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createRuntime(responses: Response[], tabs?: RuntimeInterface['tabs']) {
  return {
    fetch: vi.fn(async () => {
      const response = responses.shift()
      if (!response) throw new Error('Unexpected fetch')
      return response
    }),
    headerRules: {
      add: vi.fn(async ({ urlFilter }: { urlFilter: string }) => `rule:${urlFilter}`),
      remove: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    },
    tabs,
  } as unknown as RuntimeInterface
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ZhihuDraftPublisher', () => {
  it('builds a preview from the current platform draft', async () => {
    const runtime = createRuntime([
      jsonResponse({ title: '平台中的标题', content: '<p>第一段&nbsp;正文</p><p>第二段</p>' }),
    ])
    const publisher = new ZhihuDraftPublisher(runtime)

    await expect(publisher.getPreview(record)).resolves.toEqual({
      platform: 'zhihu',
      platformName: '知乎',
      draftId: '123',
      draftName: '平台中的标题',
      draftUrl: 'https://zhuanlan.zhihu.com/p/123/edit',
      summary: '第一段 正文 第二段',
    })
  })

  it('only reports success after the public article is verified', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_725_000_000_000)
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000')
    const runtime = createRuntime([
      jsonResponse({ title: '测试文章', content: '<p>正文</p>' }),
      jsonResponse({
        code: 0,
        data: { result: JSON.stringify({ publish: { id: '456' } }) },
      }),
      jsonResponse({ id: '456', title: '测试文章', is_published: true }),
    ])
    const publisher = new ZhihuDraftPublisher(runtime)

    const result = await publisher.publish(record)

    expect(result).toEqual({
      platform: 'zhihu',
      platformName: '知乎',
      success: true,
      status: 'published',
      postId: '456',
      postUrl: 'https://zhuanlan.zhihu.com/p/456',
      publishedAt: 1_725_000_000_000,
      error: null,
    })
    expect(runtime.fetch).toHaveBeenCalledTimes(3)
    expect(runtime.fetch).toHaveBeenNthCalledWith(
      3,
      'https://www.zhihu.com/api/v4/articles/456',
      expect.objectContaining({ credentials: 'omit', method: 'GET' })
    )
  })

  it('retries when the public article API is not ready yet', async () => {
    const runtime = createRuntime([
      jsonResponse({ title: '测试文章', content: '<p>正文</p>' }),
      jsonResponse({
        code: 0,
        data: { result: JSON.stringify({ publish: { id: '456' } }) },
      }),
      jsonResponse({}, 404),
      new Response('not found', { status: 404 }),
      jsonResponse({ id: '456', title: '测试文章', is_published: true }),
    ])
    const publisher = new ZhihuDraftPublisher(runtime, [0])

    const result = await publisher.publish(record)

    expect(result.success).toBe(true)
    expect(result.status).toBe('published')
    expect(runtime.fetch).toHaveBeenCalledTimes(5)
  })

  it('falls back to the public article page when the API is blocked', async () => {
    const runtime = createRuntime([
      jsonResponse({ title: '测试文章', content: '<p>正文</p>' }),
      jsonResponse({
        code: 0,
        data: { result: JSON.stringify({ publish: { id: '456' } }) },
      }),
      jsonResponse({}, 403),
      new Response('<html><head><title>测试文章 - 知乎</title></head></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    ])
    const publisher = new ZhihuDraftPublisher(runtime, [])

    const result = await publisher.publish(record)

    expect(result.success).toBe(true)
    expect(result.status).toBe('published')
    expect(runtime.fetch).toHaveBeenNthCalledWith(
      4,
      'https://zhuanlan.zhihu.com/p/456',
      expect.objectContaining({ credentials: 'omit', method: 'GET' })
    )
  })

  it('falls back to a temporary browser tab when background requests are blocked', async () => {
    const tabs = {
      query: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 9 })),
      remove: vi.fn(async () => undefined),
      waitForLoad: vi.fn(async () => undefined),
      executeScript: vi.fn(async () => ({
        href: 'https://zhuanlan.zhihu.com/p/456',
        title: '测试文章 - 知乎',
        heading: '测试文章',
        hasArticle: true,
      })),
    } as unknown as RuntimeInterface['tabs']
    const runtime = createRuntime([
      jsonResponse({ title: '测试文章', content: '<p>正文</p>' }),
      jsonResponse({
        code: 0,
        data: { result: JSON.stringify({ publish: { id: '456' } }) },
      }),
      jsonResponse({}, 403),
      new Response('forbidden', { status: 403 }),
    ], tabs)
    const publisher = new ZhihuDraftPublisher(runtime, [])

    const result = await publisher.publish(record)

    expect(result.success).toBe(true)
    expect(result.status).toBe('published')
    expect(tabs?.create).toHaveBeenCalledWith('https://zhuanlan.zhihu.com/p/456', false)
    expect(tabs?.remove).toHaveBeenCalledWith(9)
  })

  it('includes verification diagnostics when neither public endpoint is ready', async () => {
    const runtime = createRuntime([
      jsonResponse({ title: '测试文章', content: '<p>正文</p>' }),
      jsonResponse({
        code: 0,
        data: { result: JSON.stringify({ publish: { id: '456' } }) },
      }),
      jsonResponse({}, 403),
      new Response('not found', { status: 404 }),
    ])
    const publisher = new ZhihuDraftPublisher(runtime, [])

    const result = await publisher.publish(record)

    expect(result.success).toBe(false)
    expect(result.status).toBe('unverified')
    expect(result.error).toContain('公开 API HTTP 403')
    expect(result.error).toContain('公开文章页 HTTP 404')
  })

  it('does not report success while Zhihu is reviewing the article', async () => {
    const runtime = createRuntime([
      jsonResponse({ title: '测试文章', content: '<p>正文</p>' }),
      jsonResponse({
        code: 0,
        data: { result: JSON.stringify({ publish: { id: '456', review_info: { is_reviewing: true } } }) },
      }),
    ])
    const publisher = new ZhihuDraftPublisher(runtime)

    const result = await publisher.publish(record)

    expect(result.success).toBe(false)
    expect(result.status).toBe('reviewing')
    expect(result.publishedAt).toBeNull()
  })

  it('does not report success when the publish request fails', async () => {
    const runtime = createRuntime([
      jsonResponse({ title: '测试文章', content: '<p>正文</p>' }),
      jsonResponse({ message: 'rejected' }, 400),
    ])
    const publisher = new ZhihuDraftPublisher(runtime)

    const result = await publisher.publish(record)

    expect(result.success).toBe(false)
    expect(result.status).toBe('failed')
    expect(result.postUrl).toBeNull()
    expect(result.error).toContain('HTTP 400')
  })
})

describe('publisher confirmation', () => {
  it('rejects calls without an explicit user confirmation', async () => {
    await expect(publishDraftByUserAction('zhihu', '123', false))
      .rejects.toThrow('必须由用户明确确认')
  })

  it('blocks a draft that is already published', async () => {
    await registerDraftRecords([{
      ...record,
      status: 'published',
      publishedPostId: '456',
      publishedPostUrl: 'https://zhuanlan.zhihu.com/p/456',
      publishedAt: 1_725_000_000_000,
    }])

    const result = await publishDraftByUserAction('zhihu', '123', true)

    expect(result.success).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.error).toContain('重复发布')
    expect((await listPublishAudit())[0].event).toBe('publish_blocked')
  })

  it('blocks a draft while a publish attempt is still pending', async () => {
    await registerDraftRecords([{
      ...record,
      draftId: 'pending-123',
      status: 'publishing',
      lastPublishAttemptAt: Date.now(),
    }])

    const result = await publishDraftByUserAction('zhihu', 'pending-123', true)

    expect(result.success).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.error).toContain('已提交发布')
  })

  it('keeps a rate-limited draft ready for a later publish attempt', async () => {
    const rateLimitedRecord = {
      ...record,
      draftId: 'rate-limited-123',
      status: 'ready_to_publish' as const,
    }
    await registerDraftRecords([rateLimitedRecord])
    const responses = [
      jsonResponse({ title: '测试文章', content: '<p>正文</p>' }),
      jsonResponse({ code: 10001, message: '近期发布频率过高，请24小时后重试~' }),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => responses.shift()!))

    const result = await publishDraftByUserAction('zhihu', 'rate-limited-123', true)

    expect(result.success).toBe(false)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('频率过高')
    expect((await listDraftRecords({ platform: 'zhihu' }))
      .find(item => item.draftId === 'rate-limited-123')?.status)
      .toBe('ready_to_publish')
  })

  it('recovers an old interrupted publishing attempt before retrying', async () => {
    await registerDraftRecords([{
      ...record,
      draftId: 'stale-123',
      status: 'publishing',
      lastPublishAttemptAt: Date.now() - 11 * 60 * 1000,
    }])

    const result = await publishDraftByUserAction('zhihu', 'stale-123', true)

    expect(result.status).not.toBe('blocked')
    expect((await listPublishAudit()).some(item => item.event === 'publish_recovered')).toBe(true)
  })
})

describe('summarizeHtml', () => {
  it('strips markup and truncates long content', () => {
    expect(summarizeHtml('<p>abcdef</p>', 3)).toBe('abc…')
  })
})
