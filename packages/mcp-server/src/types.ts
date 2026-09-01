/**
 * MCP Server 与 Extension 通讯的消息类型
 */

// 请求消息
export interface RequestMessage {
  id: string
  method: string
  token?: string  // 安全验证 token
  params?: Record<string, unknown>
}

// 响应消息
export interface ResponseMessage {
  id: string
  result?: unknown
  error?: {
    code: number
    message: string
  }
}

// 平台信息
export interface PlatformInfo {
  id: string
  name: string
  icon: string
  homepage: string
  isAuthenticated: boolean
  username?: string
  avatar?: string
  error?: string
  capabilities?: string[]
}

// 文章数据
export interface Article {
  title: string
  content: string  // HTML content
  markdown?: string
  cover?: string
  tags?: string[]
  category?: string
}

// 同步结果
export interface SyncResult {
  platform: string
  success: boolean
  postId?: string
  postUrl?: string
  draftOnly?: boolean
  error?: string
  timestamp: number
}

// syncArticle 对外返回的稳定草稿结果
export interface DraftSyncResult {
  platform: string
  platformName: string
  draftName: string
  postId: string | null
  postUrl: string | null
  draftOnly: true
  success: boolean
  error: string | null
  timestamp: number
  message?: string
}

export interface SyncArticleResponse {
  syncId: string
  results: DraftSyncResult[]
}

export type DraftRecordStatus =
  | 'draft_created'
  | 'ready_to_publish'
  | 'publishing'
  | 'published'
  | 'failed'

export interface DraftRecord {
  syncId: string
  platform: string
  platformName: string
  draftId: string
  draftName: string
  draftUrl: string | null
  contentHash: string
  createdAt: number
  status: DraftRecordStatus
  lastPublishAttemptAt?: number
  publishIdempotencyKey?: string
  publishedPostId?: string
  publishedPostUrl?: string
  publishedAt?: number
}

export type DraftPublishResultStatus =
  | 'published'
  | 'reviewing'
  | 'unverified'
  | 'failed'
  | 'blocked'

export interface DraftPublishResult {
  platform: string
  platformName: string
  success: boolean
  status: DraftPublishResultStatus
  postId: string | null
  postUrl: string | null
  publishedAt: number | null
  error: string | null
  idempotencyKey?: string
}

// Extension 支持的方法
export type ExtensionMethod =
  | 'listPlatforms'
  | 'checkAuth'
  | 'syncArticle'
  | 'listDrafts'
  | 'resetDraft'
  | 'publishDraft'
  | 'extractArticle'
