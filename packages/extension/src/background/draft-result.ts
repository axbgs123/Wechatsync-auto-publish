import type { DraftSyncResult, SyncResult } from '@wechatsync/core'

export interface DraftResultContext {
  articleTitle: string
  platformName: string
  timestamp?: number
}

/**
 * 将平台适配器的宽松结果转换成 MCP/CLI 使用的稳定草稿协议。
 * syncArticle 是草稿专用入口，因此不会透传或推断公开发布状态。
 */
export function normalizeDraftResult(
  result: Omit<SyncResult, 'timestamp'> & { timestamp?: number },
  context: DraftResultContext
): DraftSyncResult {
  return {
    platform: result.platform,
    platformName: context.platformName || result.platform,
    draftName: context.articleTitle,
    postId: result.postId ? String(result.postId) : null,
    postUrl: result.postUrl || null,
    draftOnly: true,
    success: result.success,
    error: result.error || (result.success ? null : '同步失败'),
    timestamp: result.timestamp ?? context.timestamp ?? Date.now(),
    ...(result.message ? { message: result.message } : {}),
  }
}
