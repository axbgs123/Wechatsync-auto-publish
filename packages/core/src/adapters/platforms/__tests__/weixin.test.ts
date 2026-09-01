import { afterEach, describe, expect, it, vi } from 'vitest'
import { WeixinAdapter } from '../weixin'

const AUTH_HTML = `
  <script>
    window.wx = { data: { t: "token-1" } };
    ticket: "ticket-1";
    user_name: "user-1";
    nick_name: "测试公众号";
    time: "1788228000";
  </script>
`

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

describe('WeixinAdapter', () => {
  it('rejects a draft without a cover before calling the draft API', async () => {
    const adapterRuntime = runtime(async (url) => {
      if (url === 'https://mp.weixin.qq.com/') {
        return new Response(AUTH_HTML)
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    const adapter = new WeixinAdapter()
    await adapter.init(adapterRuntime as any)

    const result = await adapter.publish({ title: '测试标题', html: '<p>正文</p>' } as any)

    expect(result).toMatchObject({
      success: false,
      error: '微信公众号草稿必须提供封面图',
    })
    expect(adapterRuntime.fetch).toHaveBeenCalledTimes(1)
  })

  it('uploads the cover and includes it in all WeChat cover fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new Blob(['cover'], { type: 'image/jpeg' }),
      { status: 200 },
    )))

    const adapterRuntime = runtime(async (url, options) => {
      if (url === 'https://mp.weixin.qq.com/') {
        return new Response(AUTH_HTML)
      }
      if (url.includes('/cgi-bin/filetransfer')) {
        expect(options?.body).toBeInstanceOf(FormData)
        return json({
          cdn_url: 'https://mmbiz.qpic.cn/cover.jpg',
          content: 'original-file-id',
          base_resp: { ret: 0, err_msg: 'ok' },
        })
      }
      if (url.includes('/cgi-bin/cropimage')) {
        const body = options?.body as URLSearchParams
        expect(body.get('format0')).toBe('2.35_1')
        expect(body.get('format1')).toBe('1_1')
        return json({
          result: [
            { cdnurl: 'https://mmbiz.qpic.cn/cover-235.jpg', file_id: 'wide-file-id' },
            { cdnurl: 'https://mmbiz.qpic.cn/cover-square.jpg', file_id: 'square-file-id' },
          ],
          base_resp: { ret: 0, err_msg: 'ok' },
        })
      }
      if (url.includes('/cgi-bin/operate_appmsg')) {
        const body = options?.body as URLSearchParams
        expect(body.get('title0')).toBe('测试标题')
        expect(body.get('cdn_url0')).toBe('https://mmbiz.qpic.cn/cover-235.jpg')
        expect(body.get('cdn_235_1_url0')).toBe('https://mmbiz.qpic.cn/cover-235.jpg')
        expect(body.get('cdn_1_1_url0')).toBe('https://mmbiz.qpic.cn/cover-square.jpg')
        expect(body.get('cdn_url_back0')).toBe('https://mmbiz.qpic.cn/cover.jpg')
        expect(JSON.parse(body.get('crop_list0') || '{}')).toMatchObject({
          crop_list: [
            { ratio: '2.35_1', file_id: 'wide-file-id' },
            { ratio: '1_1', file_id: 'square-file-id' },
          ],
        })
        return json({
          appMsgId: 'draft-1',
          base_resp: { ret: 0, err_msg: 'ok' },
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    const adapter = new WeixinAdapter()
    await adapter.init(adapterRuntime as any)

    await expect(adapter.publish({
      title: '测试标题',
      html: '<p>正文</p>',
      cover: 'https://example.com/cover.jpg',
    } as any)).resolves.toMatchObject({
      success: true,
      postId: 'draft-1',
      draftOnly: true,
    })
  })

  it('preserves the detailed WeChat error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new Blob(['cover'], { type: 'image/jpeg' }),
      { status: 200 },
    )))

    const adapterRuntime = runtime(async (url) => {
      if (url === 'https://mp.weixin.qq.com/') {
        return new Response(AUTH_HTML)
      }
      if (url.includes('/cgi-bin/filetransfer')) {
        return json({
          cdn_url: 'https://mmbiz.qpic.cn/cover.jpg',
          content: 'original-file-id',
          base_resp: { ret: 0, err_msg: 'ok' },
        })
      }
      if (url.includes('/cgi-bin/cropimage')) {
        return json({
          result: [
            { cdnurl: 'https://mmbiz.qpic.cn/cover-235.jpg', file_id: 'wide-file-id' },
            { cdnurl: 'https://mmbiz.qpic.cn/cover-square.jpg', file_id: 'square-file-id' },
          ],
          base_resp: { ret: 0, err_msg: 'ok' },
        })
      }
      if (url.includes('/cgi-bin/operate_appmsg')) {
        return json({
          base_resp: { ret: 200040, err_msg: 'cover image required' },
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    const adapter = new WeixinAdapter()
    await adapter.init(adapterRuntime as any)

    const result = await adapter.publish({
      title: '测试标题',
      html: '<p>正文</p>',
      cover: 'https://example.com/cover.jpg',
    } as any)

    expect(result).toMatchObject({
      success: false,
      error: '同步失败 (错误码: 200040)：cover image required',
    })
  })
})
