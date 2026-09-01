import { describe, expect, it, vi } from 'vitest'
import { ToutiaoAdapter } from '../toutiao'

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function runtime(fetchImpl: (url: string, options?: RequestInit) => Promise<Response>) {
  return {
    type: 'extension' as const,
    fetch: vi.fn(fetchImpl),
    cookies: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
    storage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
    session: { get: vi.fn(), set: vi.fn() },
    dom: {
      parseHTML: vi.fn(), querySelector: vi.fn(), querySelectorAll: vi.fn(),
      getTextContent: vi.fn(), getInnerHTML: vi.fn(),
    },
  }
}

describe('ToutiaoAdapter', () => {
  it('creates and verifies a cloud draft with save=0', async () => {
    let writes = 0
    const adapterRuntime = runtime(async (url, options) => {
      if (url.includes('/creator_center/user_info')) {
        return json({ code: 0, data: { user: { id: 'user-1', name: '头条作者' } } })
      }
      if (url.includes('/mp/agw/article/publish')) {
        writes++
        const body = options?.body as URLSearchParams
        expect(body.get('save')).toBe('0')
        expect(body.get('title')).toBe('测试标题')
        return json({ code: 0, data: { pgcId: 'draft-1' } })
      }
      if (url.includes('/mp/agw/article/edit')) {
        return json({ code: 0, data: { title: '测试标题', pgcId: 'draft-1' } })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    const adapter = new ToutiaoAdapter()
    await adapter.init(adapterRuntime as any)

    await expect(adapter.publish({ title: '测试标题', html: '<p>正文</p>' } as any))
      .resolves.toMatchObject({
        success: true,
        postId: 'draft-1',
        postUrl: 'https://mp.toutiao.com/profile_v4/graphic/publish?pgc_id=draft-1',
        draftOnly: true,
      })
    expect(writes).toBe(1)
  })

  it('never changes to public publish when draftOnly=false is passed', async () => {
    const adapterRuntime = runtime(async (url, options) => {
      if (url.includes('/creator_center/user_info')) {
        return json({ code: 0, data: { user: { id: 'user-1', name: '头条作者' } } })
      }
      if (url.includes('/mp/agw/article/publish')) {
        expect((options?.body as URLSearchParams).get('save')).toBe('0')
        return json({ code: 0, data: { pgc_id: 'draft-safe' } })
      }
      return json({ code: 0, data: { title: '安全草稿', pgc_id: 'draft-safe' } })
    })
    const adapter = new ToutiaoAdapter()
    await adapter.init(adapterRuntime as any)

    const result = await adapter.publish(
      { title: '安全草稿', html: '<p>正文</p>' } as any,
      { draftOnly: false },
    )
    expect(result).toMatchObject({ success: true, draftOnly: true })
    expect(result.message).toContain('未公开发布')
  })
})
