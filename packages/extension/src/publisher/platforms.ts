export interface PublisherPlatformConfig {
  id: string
  name: string
  publishEnabled: boolean
  note: string
}

/**
 * 发布器能力表。草稿适配和公开发布是两个独立能力；只有经过真实接口
 * 提交与公开结果验证的平台，publishEnabled 才能设为 true。
 */
export const PUBLISHER_PLATFORMS: PublisherPlatformConfig[] = [
  { id: 'zhihu', name: '知乎', publishEnabled: true, note: '支持浏览器登录态公开发布' },
  { id: 'weixin', name: '微信公众号', publishEnabled: true, note: '浏览器登录态发布；等待实账号验收' },
  { id: 'sohu', name: '搜狐号', publishEnabled: true, note: '浏览器登录态发布；等待实账号验收' },
  { id: 'baijiahao', name: '百家号', publishEnabled: true, note: '浏览器登录态发布；等待实账号验收' },
  { id: 'bilibili', name: 'B站专栏', publishEnabled: true, note: '浏览器登录态投稿；等待实账号验收' },
  { id: 'toutiao', name: '今日头条', publishEnabled: true, note: '浏览器发布页提交；等待实账号验收' },
]

export function getPublisherPlatformConfig(platform: string): PublisherPlatformConfig | undefined {
  return PUBLISHER_PLATFORMS.find(item => item.id === platform)
}
