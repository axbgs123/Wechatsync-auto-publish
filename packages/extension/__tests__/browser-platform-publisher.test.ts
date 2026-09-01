import { describe, expect, it, vi } from 'vitest'
import type { DraftRecord, RuntimeInterface } from '@wechatsync/core'
import {
  BROWSER_PUBLISHER_CONFIGS,
  BrowserPlatformDraftPublisher,
  type BrowserPublisherConfig,
} from '../src/publisher/browser-platform'

const publicUrls: Record<string, string> = {
  weixin: 'https://mp.weixin.qq.com/s/abc123',
  sohu: 'https://www.sohu.com/a/123456_100001',
  baijiahao: 'https://baijiahao.baidu.com/s?id=123456',
  bilibili: 'https://www.bilibili.com/read/cv123456',
  toutiao: 'https://www.toutiao.com/article/123456/',
}

function record(config: BrowserPublisherConfig): DraftRecord {
  return {
    syncId: 'sync-1',
    platform: config.platform,
    platformName: config.platform,
    draftId: 'draft-1',
    draftName: '测试文章',
    draftUrl: `https://${config.platform}.example.test/edit/draft-1`,
    contentHash: 'hash-1',
    createdAt: 1,
    status: 'draft_created',
  }
}

function runtime(results: unknown[]): RuntimeInterface {
  return {
    type: 'extension',
    tabs: {
      query: vi.fn(async () => [{ id: 7, url: 'https://weixin.example.test/edit/draft-1' }]),
      create: vi.fn(async () => ({ id: 8 })),
      waitForLoad: vi.fn(async () => undefined),
      executeScript: vi.fn(async () => {
        if (results.length === 0) throw new Error('Unexpected executeScript call')
        return results.shift()
      }) as any,
    },
  } as unknown as RuntimeInterface
}

describe('BrowserPlatformDraftPublisher', () => {
  it.each(BROWSER_PUBLISHER_CONFIGS.map(config => [config.platform, config] as const))(
    'builds a preview for %s from the native editor',
    async (_platform, config) => {
      const adapterRuntime = runtime([{
        url: record(config).draftUrl,
        title: '平台标题',
        content: '<p>第一段正文</p>',
        bodyText: '',
      }])
      const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config)

      await expect(publisher.getPreview(record(config))).resolves.toMatchObject({
        platform: config.platform,
        draftName: '平台标题',
        summary: '第一段正文',
      })
    },
  )

  it('verifies an interrupted publish without clicking publish again', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'toutiao')!
    const adapterRuntime = runtime([{
      url: publicUrls.toutiao,
      title: '测试文章',
      content: '正文',
      bodyText: '',
    }])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config)

    await expect(publisher.verifyPublished(record(config))).resolves.toMatchObject({
      success: true,
      status: 'published',
      postUrl: publicUrls.toutiao,
    })
    expect(adapterRuntime.tabs!.executeScript).toHaveBeenCalledTimes(1)
  })

  it('recognizes the current Toutiao item URL as public', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'toutiao')!
    const itemUrl = 'https://www.toutiao.com/item/7680412358082331177/'
    const adapterRuntime = runtime([{
      url: itemUrl,
      title: '测试文章',
      content: '正文',
      bodyText: '',
    }])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config)

    await expect(publisher.verifyPublished(record(config))).resolves.toMatchObject({
      success: true,
      status: 'published',
      postId: '7680412358082331177',
      postUrl: itemUrl,
    })
  })

  it('does not recover a Toutiao draft from another article review status', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'toutiao')!
    const adapterRuntime = runtime([
      { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      {
        url: 'https://mp.toutiao.com/profile_v4/graphic/articles',
        title: '',
        content: '',
        bodyText: '上一篇文章 审核中',
      },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config)

    await expect(publisher.verifyPublished(record(config))).resolves.toBeNull()
    expect(adapterRuntime.tabs!.executeScript).toHaveBeenCalledTimes(2)
  })

  it('recovers a matching Toutiao draft from the review status page', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'toutiao')!
    const adapterRuntime = runtime([
      { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      {
        url: 'https://mp.toutiao.com/profile_v4/graphic/articles',
        title: '',
        content: '',
        bodyText: '测试文章 审核中',
      },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config)

    await expect(publisher.verifyPublished(record(config))).resolves.toMatchObject({
      success: true,
      status: 'reviewing',
      postId: 'draft-1',
    })
  })

  it.each(BROWSER_PUBLISHER_CONFIGS.map(config => [config.platform, config] as const))(
    'reports %s as published only after reaching its public URL',
    async (_platform, config) => {
      const scriptResults = [
        { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '' },
        { clicked: true, text: '发布', disabled: false },
        ...(config.preConfirmDisableToggleLabels?.length
          ? [
              { found: true, on: true, clicked: true, ambiguous: false },
              { found: true, on: false, clicked: false, ambiguous: false },
            ]
          : []),
        ...(config.confirmOptionalAfterNavigation
          ? [{ url: publicUrls[config.platform], title: '测试文章', content: '正文', bodyText: '' }]
          : [
              ...Array.from({ length: config.confirmSteps ?? 1 }, () => (
                { clicked: true, text: '确认发布', disabled: false }
              )),
              { url: publicUrls[config.platform], title: '测试文章', content: '正文', bodyText: '' },
            ]),
      ]
      const adapterRuntime = runtime(scriptResults)
      const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config, {
        confirmDelayMs: 0,
        pollIntervalMs: 0,
        pollAttempts: 1,
      })

      const result = await publisher.publish(record(config))
      expect(result).toMatchObject({
        platform: config.platform,
        success: true,
        status: 'published',
        postUrl: publicUrls[config.platform],
      })
      expect(result.publishedAt).not.toBeNull()
    },
  )

  it('treats the Baijiahao submission page as reviewing without clicking a confirmation button', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'baijiahao')!
    const adapterRuntime = runtime([
      { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { clicked: true, text: '发布', disabled: false },
      {
        url: 'https://baijiahao.baidu.com/builder/rc/clue?from=news',
        title: '',
        content: '',
        bodyText: '提交成功，正在审核中...',
      },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config, {
      confirmDelayMs: 0,
    })

    await expect(publisher.publish(record(config))).resolves.toMatchObject({
      platform: 'baijiahao',
      success: true,
      status: 'reviewing',
      error: null,
    })
    expect(adapterRuntime.tabs!.executeScript).toHaveBeenCalledTimes(3)
  })

  it('waits for the asynchronously loaded Baijiahao publish button', async () => {
    const baseConfig = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'baijiahao')!
    const config = { ...baseConfig, publishLookupAttempts: 3 }
    const adapterRuntime = runtime([
      { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { clicked: false, text: null, disabled: false, ambiguous: false },
      { clicked: false, text: null, disabled: false, ambiguous: false },
      { clicked: true, text: '发布', disabled: false, ambiguous: false },
      {
        url: 'https://baijiahao.baidu.com/builder/rc/clue?from=news',
        title: '',
        content: '',
        bodyText: '提交成功，正在审核中...',
      },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config, {
      confirmDelayMs: 0,
    })

    await expect(publisher.publish(record(config))).resolves.toMatchObject({
      success: true,
      status: 'reviewing',
    })
    expect(adapterRuntime.tabs!.executeScript).toHaveBeenCalledTimes(5)
  })

  it('waits for the Baijiahao submission page before looking for a confirmation dialog', async () => {
    const baseConfig = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'baijiahao')!
    const config = { ...baseConfig, postPublishTransitionAttempts: 3 }
    const adapterRuntime = runtime([
      { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { clicked: true, text: '发布', disabled: false, ambiguous: false },
      { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      {
        url: 'https://baijiahao.baidu.com/builder/rc/clue?from=news',
        title: '',
        content: '',
        bodyText: '提交成功，正在审核中...',
      },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config, {
      confirmDelayMs: 0,
    })

    await expect(publisher.publish(record(config))).resolves.toMatchObject({
      success: true,
      status: 'reviewing',
      error: null,
    })
    expect(adapterRuntime.tabs!.executeScript).toHaveBeenCalledTimes(5)
  })

  it('waits for the asynchronously loaded Toutiao confirmation dialog', async () => {
    const baseConfig = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'toutiao')!
    const config = { ...baseConfig, confirmLookupAttempts: 3 }
    const adapterRuntime = runtime([
      { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { clicked: true, text: '预览并发布', disabled: false, ambiguous: false },
      { clicked: false, text: null, disabled: false, ambiguous: false },
      { clicked: false, text: null, disabled: false, ambiguous: false },
      { clicked: true, text: '确定', disabled: false, ambiguous: false },
      { clicked: true, text: '确认发布', disabled: false, ambiguous: false },
      { clicked: true, text: '确定', disabled: false, ambiguous: false },
      { url: publicUrls.toutiao, title: '测试文章', content: '正文', bodyText: '' },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config, {
      confirmDelayMs: 0,
      pollIntervalMs: 0,
      pollAttempts: 1,
    })

    const result = await publisher.publish(record(config))
    expect(result).toMatchObject({
      success: true,
      status: 'published',
      postUrl: publicUrls.toutiao,
    })
    expect(adapterRuntime.tabs!.executeScript).toHaveBeenCalledTimes(8)
  })

  it('retries an ignored Toutiao publish click and accepts a shorter confirmation flow', async () => {
    const baseConfig = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'toutiao')!
    const config = {
      ...baseConfig,
      confirmLookupAttempts: 1,
      publishTransitionRetries: 1,
    }
    const adapterRuntime = runtime([
      { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { clicked: true, text: '预览并发布', disabled: false, ambiguous: false },
      { clicked: false, text: null, disabled: false, ambiguous: false },
      { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { clicked: true, text: '预览并发布', disabled: false, ambiguous: false },
      { clicked: true, text: '确认发布', disabled: false, ambiguous: false },
      { clicked: true, text: '确定', disabled: false, ambiguous: false },
      { clicked: false, text: null, disabled: false, ambiguous: false },
      { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { url: publicUrls.toutiao, title: '测试文章', content: '正文', bodyText: '' },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config, {
      confirmDelayMs: 0,
      pollIntervalMs: 0,
      pollAttempts: 1,
    })

    await expect(publisher.publish(record(config))).resolves.toMatchObject({
      success: true,
      status: 'published',
      postUrl: publicUrls.toutiao,
    })
    expect(adapterRuntime.tabs!.executeScript).toHaveBeenCalledTimes(10)
  })

  it('does not treat stale WeChat QR text as a successful submission', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'weixin')!
    const weixinRecord = { ...record(config), platformName: '微信公众号' }
    const adapterRuntime = runtime([
      { url: weixinRecord.draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { clicked: true, text: '发表', disabled: false },
      { found: true, on: true, clicked: true, ambiguous: false },
      { found: true, on: false, clicked: false, ambiguous: false },
      { clicked: true, text: '发表', disabled: false },
      { clicked: true, text: '继续发表', disabled: false },
      {
        url: weixinRecord.draftUrl,
        title: '测试文章',
        content: '正文',
        bodyText: '请使用微信扫码确认，二维码有效期为五分钟',
      },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config, {
      confirmDelayMs: 0,
      pollIntervalMs: 0,
      pollAttempts: 1,
    })

    await expect(publisher.publish(weixinRecord)).resolves.toMatchObject({
      platform: 'weixin',
      success: false,
      status: 'unverified',
    })
    expect(adapterRuntime.tabs!.executeScript).toHaveBeenCalledTimes(7)
  })

  it('stops WeChat publishing when the group notification switch is absent', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'weixin')!
    const weixinRecord = { ...record(config), platformName: '微信公众号' }
    const adapterRuntime = runtime([
      { url: weixinRecord.draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { clicked: true, text: '发表', disabled: false },
      { found: false, on: null, clicked: false, ambiguous: false },
      { found: false, on: null, clicked: false, ambiguous: false },
      { found: false, on: null, clicked: false, ambiguous: false },
      { found: false, on: null, clicked: false, ambiguous: false },
      { found: false, on: null, clicked: false, ambiguous: false },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config, {
      confirmDelayMs: 0,
      pollIntervalMs: 0,
      pollAttempts: 1,
    })

    await expect(publisher.publish(weixinRecord)).resolves.toMatchObject({
      platform: 'weixin',
      success: false,
      status: 'failed',
      error: '微信公众号未找到“群发通知”开关，已停止发布',
    })
    expect(adapterRuntime.tabs!.executeScript).toHaveBeenCalledTimes(7)
  })

  it('waits for the asynchronous WeChat notification switch', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'weixin')!
    const weixinRecord = { ...record(config), platformName: '微信公众号' }
    const adapterRuntime = runtime([
      { url: weixinRecord.draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { clicked: true, text: '发表', disabled: false },
      { found: false, on: null, clicked: false, ambiguous: false },
      { found: false, on: null, clicked: false, ambiguous: false },
      { found: true, on: true, clicked: true, ambiguous: false },
      { found: true, on: false, clicked: false, ambiguous: false },
      { clicked: true, text: '发表', disabled: false },
      { clicked: true, text: '继续发表', disabled: false },
      {
        url: weixinRecord.draftUrl,
        title: '测试文章',
        content: '正文',
        bodyText: '发表成功',
      },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config, {
      confirmDelayMs: 0,
      pollIntervalMs: 0,
      pollAttempts: 1,
    })

    await expect(publisher.publish(weixinRecord)).resolves.toMatchObject({
      success: true,
      status: 'reviewing',
    })
  })

  it('waits for the new WeChat confirmation button to become enabled', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'weixin')!
    const weixinRecord = { ...record(config), platformName: '微信公众号' }
    const adapterRuntime = runtime([
      { url: weixinRecord.draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { clicked: true, text: '发表', disabled: false },
      { found: true, on: false, clicked: false, ambiguous: false },
      { found: true, on: false, clicked: false, ambiguous: false },
      { clicked: false, text: '发表', disabled: true, ambiguous: false },
      { clicked: true, text: '发表', disabled: false, ambiguous: false },
      { clicked: true, text: '继续发表', disabled: false, ambiguous: false },
      {
        url: weixinRecord.draftUrl,
        title: '测试文章',
        content: '正文',
        bodyText: '发表成功',
      },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config, {
      confirmDelayMs: 0,
      pollIntervalMs: 0,
      pollAttempts: 1,
    })

    await expect(publisher.publish(weixinRecord)).resolves.toMatchObject({
      success: true,
      status: 'reviewing',
    })
  })

  it('does not report WeChat success without a success or review signal', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'weixin')!
    const weixinRecord = { ...record(config), platformName: '微信公众号' }
    const adapterRuntime = runtime([
      { url: weixinRecord.draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { clicked: true, text: '发表', disabled: false },
      { found: true, on: false, clicked: false, ambiguous: false },
      { found: true, on: false, clicked: false, ambiguous: false },
      { clicked: true, text: '发表', disabled: false },
      { clicked: true, text: '继续发表', disabled: false },
      { url: weixinRecord.draftUrl, title: '测试文章', content: '正文', bodyText: '' },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config, {
      confirmDelayMs: 0,
      pollIntervalMs: 0,
      pollAttempts: 1,
    })

    await expect(publisher.publish(weixinRecord)).resolves.toMatchObject({
      success: false,
      status: 'unverified',
      postId: null,
    })
  })

  it('does not recover WeChat from a previous click without platform evidence', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'weixin')!
    const weixinRecord = {
      ...record(config),
      platformName: '微信公众号',
      status: 'publishing' as const,
      lastPublishAttemptAt: Date.now(),
    }
    const adapterRuntime = runtime([
      { url: weixinRecord.draftUrl, title: '测试文章', content: '正文', bodyText: '' },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config)

    await expect(publisher.verifyPublished(weixinRecord)).resolves.toBeNull()
    expect(adapterRuntime.tabs!.executeScript).toHaveBeenCalledTimes(2)
  })

  it('verifies WeChat submission from a freshly loaded publish-status page', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'weixin')!
    const weixinRecord = {
      ...record(config),
      platformName: '微信公众号',
      draftUrl: 'https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&appmsgid=draft-1&token=token-1',
    }
    const adapterRuntime = runtime([
      { url: weixinRecord.draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { clicked: true, text: '发表', disabled: false },
      { found: true, on: false, clicked: false, ambiguous: false },
      { found: true, on: false, clicked: false, ambiguous: false },
      { clicked: true, text: '发表', disabled: false },
      { clicked: true, text: '继续发表', disabled: false },
      { url: weixinRecord.draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      {
        url: 'https://mp.weixin.qq.com/cgi-bin/appmsgpublish?sub=list',
        title: '测试文章',
        content: '',
        bodyText: '测试文章 已发表',
      },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config, {
      confirmDelayMs: 0,
      pollIntervalMs: 0,
      pollAttempts: 1,
    })

    await expect(publisher.publish(weixinRecord)).resolves.toMatchObject({
      success: true,
      status: 'reviewing',
      postId: 'draft-1',
    })
    expect(adapterRuntime.tabs!.create).toHaveBeenCalledWith(
      expect.stringContaining('appmsgpublish?sub=list'),
      false,
    )
  })

  it('stops WeChat publishing if group notification remains enabled', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'weixin')!
    const weixinRecord = { ...record(config), platformName: '微信公众号' }
    const adapterRuntime = runtime([
      { url: weixinRecord.draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { clicked: true, text: '发表', disabled: false },
      { found: true, on: true, clicked: true, ambiguous: false },
      { found: true, on: true, clicked: false, ambiguous: false },
      { found: true, on: true, clicked: false, ambiguous: false },
      { found: true, on: true, clicked: false, ambiguous: false },
      { found: true, on: true, clicked: false, ambiguous: false },
      { found: true, on: true, clicked: false, ambiguous: false },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config, {
      confirmDelayMs: 0,
      pollIntervalMs: 0,
      pollAttempts: 1,
    })

    await expect(publisher.publish(weixinRecord)).resolves.toMatchObject({
      success: false,
      status: 'failed',
      error: '微信公众号未能确认“群发通知”已关闭，已停止发布',
    })
  })

  it('records a Bilibili review submission as a successful publish operation', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'bilibili')!
    const adapterRuntime = runtime([
      { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { clicked: true, text: '投稿', disabled: false },
      { clicked: true, text: '确认投稿', disabled: false },
      { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '稿件审核中' },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config, {
      confirmDelayMs: 0,
      pollIntervalMs: 0,
      pollAttempts: 1,
    })

    await expect(publisher.publish(record(config))).resolves.toMatchObject({
      success: true,
      status: 'reviewing',
      publishedAt: null,
    })
  })

  it('pauses Bilibili publishing when the platform requests an image captcha', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'bilibili')!
    const adapterRuntime = runtime([
      { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { clicked: true, text: '发布', disabled: false },
      {
        url: record(config).draftUrl,
        title: '测试文章',
        content: '正文',
        bodyText: '请完成验证 请输入图片中的内容 换一张 取消 确定',
      },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config, {
      confirmDelayMs: 0,
    })

    await expect(publisher.publish(record(config))).resolves.toMatchObject({
      success: false,
      status: 'reviewing',
      error: '哔哩哔哩已打开图片验证码，请用户完成验证后确认',
    })
    expect(adapterRuntime.tabs!.executeScript).toHaveBeenCalledTimes(3)
  })

  it('opens the current Bilibili article editor URL for an existing draft ID', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'bilibili')!
    const adapterRuntime = runtime([{
      url: 'https://member.bilibili.com/york/read-editor?aid=draft-1',
      title: '测试文章',
      content: '正文',
      bodyText: '',
    }])
    vi.mocked(adapterRuntime.tabs!.query).mockResolvedValue([])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config)

    await publisher.getPreview(record(config))

    expect(adapterRuntime.tabs!.create).toHaveBeenCalledWith(
      'https://member.bilibili.com/york/read-editor?aid=draft-1',
      false,
    )
  })

  it('fails without claiming a publish when the native button is missing', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS[0]
    const adapterRuntime = runtime([
      { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { clicked: false, text: null, disabled: false },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config, {
      confirmDelayMs: 0,
      pollIntervalMs: 0,
      pollAttempts: 1,
    })

    await expect(publisher.publish(record(config))).resolves.toMatchObject({
      success: false,
      status: 'failed',
      postUrl: null,
    })
  })

  it('fails when the confirmation dialog button is missing', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS.find(item => item.platform === 'sohu')!
    const adapterRuntime = runtime([
      { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { clicked: true, text: '发布', disabled: false },
      { clicked: false, text: null, disabled: false, ambiguous: false },
      { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '' },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config, {
      confirmDelayMs: 0,
      pollIntervalMs: 0,
      pollAttempts: 1,
    })

    await expect(publisher.publish(record(config))).resolves.toMatchObject({
      success: false,
      status: 'failed',
      error: expect.stringContaining('弹窗内的确认发布按钮未找到'),
    })
  })

  it('stops when more than one publish control matches', async () => {
    const config = BROWSER_PUBLISHER_CONFIGS[0]
    const adapterRuntime = runtime([
      { url: record(config).draftUrl, title: '测试文章', content: '正文', bodyText: '' },
      { clicked: false, text: null, disabled: false, ambiguous: true },
    ])
    const publisher = new BrowserPlatformDraftPublisher(adapterRuntime, config, {
      confirmDelayMs: 0,
      pollIntervalMs: 0,
      pollAttempts: 1,
    })

    await expect(publisher.publish(record(config))).resolves.toMatchObject({
      success: false,
      status: 'failed',
      error: expect.stringContaining('多个发布按钮'),
    })
  })
})
