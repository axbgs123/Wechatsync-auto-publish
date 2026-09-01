/**
 * 页面上会有大量不属于 WechatSync 的 postMessage。只解析看起来像 JSON
 * 的字符串或普通对象，其他消息直接忽略。
 */
export function parseWindowMessage(data: unknown): Record<string, any> | null {
  if (typeof data === 'string') {
    const value = data.trim()
    if (!value || (value[0] !== '{' && value[0] !== '[')) return null
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : null
    } catch {
      return null
    }
  }

  return data && typeof data === 'object'
    ? data as Record<string, any>
    : null
}
