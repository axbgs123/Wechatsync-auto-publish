/** 只有普通 HTTP(S) 页面允许扩展内容脚本执行文章提取。 */
export function isExtractableTabUrl(url?: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
