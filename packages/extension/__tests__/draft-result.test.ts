import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeDraftResult } from '../src/background/draft-result'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('normalizeDraftResult', () => {
  it('returns a stable successful draft result', () => {
    const result = normalizeDraftResult({
      platform: 'zhihu',
      success: true,
      postId: '123',
      postUrl: 'https://zhuanlan.zhihu.com/p/123/edit',
      draftOnly: true,
      timestamp: 1_725_000_000_000,
    }, {
      articleTitle: '测试文章',
      platformName: '知乎',
    })

    expect(result).toEqual({
      platform: 'zhihu',
      platformName: '知乎',
      draftName: '测试文章',
      postId: '123',
      postUrl: 'https://zhuanlan.zhihu.com/p/123/edit',
      draftOnly: true,
      success: true,
      error: null,
      timestamp: 1_725_000_000_000,
    })
  })

  it('keeps all stable fields on failure', () => {
    const result = normalizeDraftResult({
      platform: 'zhihu',
      success: false,
      error: '未登录',
    }, {
      articleTitle: '失败文章',
      platformName: '知乎',
      timestamp: 1_725_000_000_001,
    })

    expect(result).toEqual({
      platform: 'zhihu',
      platformName: '知乎',
      draftName: '失败文章',
      postId: null,
      postUrl: null,
      draftOnly: true,
      success: false,
      error: '未登录',
      timestamp: 1_725_000_000_001,
    })
  })

  it('normalizes missing failure messages without reporting success', () => {
    const result = normalizeDraftResult({
      platform: 'missing',
      success: false,
    }, {
      articleTitle: '测试文章',
      platformName: '',
      timestamp: 1,
    })

    expect(result.platformName).toBe('missing')
    expect(result.success).toBe(false)
    expect(result.error).toBe('同步失败')
    expect(result.draftOnly).toBe(true)
  })

  it('uses the normalization time when an adapter has no timestamp', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_725_000_000_002)

    const result = normalizeDraftResult({
      platform: 'cms-account',
      success: true,
      postId: '42',
    }, {
      articleTitle: 'CMS 草稿',
      platformName: '我的博客',
    })

    expect(result.timestamp).toBe(1_725_000_000_002)
    expect(result.postId).toBe('42')
  })

  it('always reports the draft-only invariant for syncArticle', () => {
    const result = normalizeDraftResult({
      platform: 'zhihu',
      success: true,
      draftOnly: false,
    }, {
      articleTitle: '安全测试',
      platformName: '知乎',
      timestamp: 1,
    })

    expect(result.draftOnly).toBe(true)
  })
})
