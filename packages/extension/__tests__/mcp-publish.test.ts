import { beforeEach, describe, expect, it, vi } from 'vitest'

const { publishDraftByUserAction } = vi.hoisted(() => ({
  publishDraftByUserAction: vi.fn(),
}))

vi.mock('@wechatsync/core', () => ({
  markdownToHtml: vi.fn((value: string) => value),
}))

vi.mock('../src/adapters', () => ({
  checkAllPlatformsAuth: vi.fn(),
  checkPlatformAuth: vi.fn(),
  getAdapter: vi.fn(),
}))

vi.mock('../src/background/sync-service', () => ({
  performSync: vi.fn(),
}))

vi.mock('../src/background/draft-registry', () => ({
  listDraftRecords: vi.fn(),
}))

vi.mock('../src/publisher', () => ({
  publishDraftByUserAction,
}))

import { mcpClient } from '../src/mcp/client'

describe('MCP publishDraft route', () => {
  beforeEach(() => {
    publishDraftByUserAction.mockReset()
  })

  it('publishes a registered draft after explicit MCP confirmation', async () => {
    publishDraftByUserAction.mockResolvedValue({
      platform: 'zhihu',
      platformName: '知乎',
      success: true,
      status: 'published',
      postId: 'public-1',
      postUrl: 'https://zhuanlan.zhihu.com/p/public-1',
      publishedAt: 1,
      error: null,
    })

    const result = await (mcpClient as any).handleMethod('publishDraft', {
      platform: 'zhihu',
      draftId: 'draft-1',
      confirmed: true,
    })

    expect(publishDraftByUserAction).toHaveBeenCalledWith('zhihu', 'draft-1', true, false)
    expect(result).toMatchObject({ success: true, status: 'published' })
  })

  it('passes an explicit retry for a previously unverified browser flow', async () => {
    publishDraftByUserAction.mockResolvedValue({
      platform: 'weixin',
      platformName: '微信公众号',
      success: false,
      status: 'reviewing',
      postId: null,
      postUrl: null,
      publishedAt: null,
      error: '等待扫码',
    })

    await (mcpClient as any).handleMethod('publishDraft', {
      platform: 'weixin',
      draftId: 'draft-1',
      confirmed: true,
      retryUnverified: true,
    })

    expect(publishDraftByUserAction).toHaveBeenCalledWith('weixin', 'draft-1', true, true)
  })

  it('rejects automatic publication without confirmed=true', async () => {
    await expect((mcpClient as any).handleMethod('publishDraft', {
      platform: 'zhihu',
      draftId: 'draft-1',
      confirmed: false,
    })).rejects.toThrow('confirmed=true')

    expect(publishDraftByUserAction).not.toHaveBeenCalled()
  })
})
