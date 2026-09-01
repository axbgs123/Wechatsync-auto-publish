import { describe, expect, it } from 'vitest'
import { PUBLISHER_PLATFORMS, getPublisherPlatformConfig } from '../src/publisher/platforms'

describe('publisher platform capabilities', () => {
  it('lists all requested browser publishers', () => {
    expect(PUBLISHER_PLATFORMS.map(item => item.id)).toEqual([
      'zhihu', 'weixin', 'sohu', 'baijiahao', 'bilibili', 'toutiao',
    ])
    for (const platform of ['weixin', 'sohu', 'baijiahao', 'bilibili', 'toutiao']) {
      expect(getPublisherPlatformConfig(platform)?.publishEnabled).toBe(true)
      expect(getPublisherPlatformConfig(platform)?.note).toContain('验收')
    }
  })

  it('keeps the verified Zhihu publisher enabled', () => {
    expect(getPublisherPlatformConfig('zhihu')?.publishEnabled).toBe(true)
  })
})
