import { afterEach, describe, expect, it, vi } from 'vitest'
import { BaijiahaoAdapter } from '../baijiahao.ts'

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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BaijiahaoAdapter cover', () => {
  it('rejects a draft without a cover', async () => {
    const adapterRuntime = runtime(async (url) => {
      if (url.includes('/builder/app/appinfo')) {
        return json({
          errno: 0,
          errmsg: 'success',
          data: { user: { userid: '1', name: '测试账号', avatar: '' } },
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    const adapter = new BaijiahaoAdapter()
    await adapter.init(adapterRuntime as any)

    const result = await adapter.publish({ title: '测试标题', html: '<p>正文</p>' } as any)

    expect(result).toMatchObject({ success: false, error: '百家号草稿必须提供封面图' })
  })

  it('uploads and crops the cover before saving the draft', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new Blob(['cover'], { type: 'image/png' }),
      { status: 200 },
    )))
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 1672,
      height: 941,
      close: vi.fn(),
    })))

    let cropIndex = 0
    const adapterRuntime = runtime(async (url, options) => {
      if (url.includes('/builder/app/appinfo')) {
        return json({
          errno: 0,
          errmsg: 'success',
          data: { user: { userid: '1', name: '测试账号', avatar: '' } },
        })
      }
      if (url === 'https://baijiahao.baidu.com/builder/rc/edit') {
        return new Response(`window.__BJH__INIT__AUTH__ = 'token-1'`)
      }
      if (url.includes('/pcui/picture/uploadproxy')) {
        return json({ errno: 0, errmsg: 'success', ret: { https_url: 'https://pic.example/origin.png' } })
      }
      if (url.includes('/pcui/Picture/CuttingPicproxy')) {
        cropIndex += 1
        return json({ errno: 0, errmsg: 'success', data: { https_src: `https://pic.example/crop-${cropIndex}.png` } })
      }
      if (url.includes('/pcui/article/save')) {
        const body = options?.body as URLSearchParams
        expect(body.get('cover_layout')).toBe('one')
        expect(body.get('vertical_cover')).toBe('https://pic.example/crop-2.png')
        expect(JSON.parse(body.get('cover_images') || '[]')).toMatchObject([{
          src: 'https://pic.example/crop-1.png',
          cropData: { x: 130, y: 0, width: 1412, height: 941 },
        }])
        expect(JSON.parse(body.get('_cover_images_map') || '[]')).toEqual([{
          src: 'https://pic.example/crop-1.png',
          origin_src: 'https://pic.example/origin.png',
        }])
        return new Response('bjhdraft({"errno":0,"errmsg":"success","ret":{"article_id":"draft-1"}})')
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    const adapter = new BaijiahaoAdapter()
    await adapter.init(adapterRuntime as any)

    const result = await adapter.publish({
      title: '测试标题',
      html: '<p>正文</p>',
      cover: 'data:image/png;base64,Y292ZXI=',
    } as any)

    expect(result).toMatchObject({ success: true, postId: 'draft-1', draftOnly: true })
    expect(cropIndex).toBe(2)
  })
})
