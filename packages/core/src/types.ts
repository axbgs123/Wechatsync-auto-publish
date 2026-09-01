/**
 * 文章内容
 *
 * 内容格式说明：
 * - markdown: 主要内容格式，由 content script 使用 Turndown + 原生 DOM 转换
 * - html: 可选的原始 HTML，某些平台可能需要
 */
export interface Article {
  title: string
  markdown: string    // Markdown 格式内容（主要）
  html?: string       // 原始 HTML（可选，用于某些需要 HTML 的平台）
  summary?: string
  cover?: string
  tags?: string[]
  category?: string
  source?: {
    url: string
    platform: string
  }
}

/**
 * 同步结果
 */
export interface SyncResult {
  platform: string
  success: boolean
  postId?: string
  postUrl?: string
  draftOnly?: boolean  // 是否只保存了草稿
  error?: string
  message?: string  // 额外提示信息
  timestamp: number
}

/**
 * 对外返回的稳定草稿同步结果。
 *
 * 与适配器内部使用的 SyncResult 分开，避免要求所有适配器在失败时
 * 构造并不存在的草稿 ID/URL，同时保证跨进程 JSON 协议字段稳定。
 */
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

/** MCP/CLI syncArticle 的稳定返回结构。 */
export interface SyncArticleResponse {
  syncId: string
  results: DraftSyncResult[]
}

/** 草稿进入独立发布器前的生命周期状态。 */
export type DraftRecordStatus =
  | 'draft_created'
  | 'ready_to_publish'
  | 'publishing'
  | 'published'
  | 'failed'

/** 已成功创建、可供后续发布器查询的草稿记录。 */
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
  /** 最近一次真正发起平台发布请求的时间，用于识别中断后遗留的 publishing 状态。 */
  lastPublishAttemptAt?: number
  publishIdempotencyKey?: string
  publishedPostId?: string
  publishedPostUrl?: string
  publishedAt?: number
}

export interface DraftRecordQuery {
  platform?: string
  status?: DraftRecordStatus
}

/** 发布器展示给用户确认的只读预览。 */
export interface DraftPublishPreview {
  platform: string
  platformName: string
  draftId: string
  draftName: string
  draftUrl: string | null
  summary: string
}

export type DraftPublishResultStatus = 'published' | 'reviewing' | 'unverified' | 'failed' | 'blocked'

/** 独立发布器结果。success 表示平台已接受发布操作；status 区分已公开、审核中等状态。 */
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

export type PublishAuditEvent =
  | 'previewed'
  | 'publish_started'
  | 'publish_submitted'
  | 'publish_succeeded'
  | 'publish_failed'
  | 'publish_blocked'
  | 'publish_recovered'

export interface PublishAuditRecord {
  id: string
  idempotencyKey: string
  platform: string
  draftId: string
  draftName: string
  event: PublishAuditEvent
  resultStatus: DraftPublishResultStatus | null
  error: string | null
  createdAt: number
}

/** 平台发布器契约；与 syncArticle/平台草稿适配器相互独立。 */
export interface DraftPublisher {
  readonly platform: string
  getPreview(record: DraftRecord): Promise<DraftPublishPreview>
  /** 中断恢复时只读检查平台结果；无法确认时返回 null。 */
  verifyPublished?(record: DraftRecord): Promise<DraftPublishResult | null>
  publish(record: DraftRecord): Promise<DraftPublishResult>
}

/**
 * 认证状态
 */
export interface AuthResult {
  isAuthenticated: boolean
  username?: string
  userId?: string
  avatar?: string
  error?: string
}

/**
 * 平台能力
 */
export type PlatformCapability =
  | 'article'      // 发布文章
  | 'draft'        // 草稿支持
  | 'image_upload' // 图片上传
  | 'categories'   // 分类
  | 'tags'         // 标签
  | 'cover'        // 封面图
  | 'schedule'     // 定时发布
  | 'draft_only'      // 当前只支持创建草稿
  | 'browser_publish' // 使用浏览器登录态执行公开发布
  | 'api_publish'     // 使用平台正式 API 执行公开发布

/**
 * 平台元信息
 */
export interface PlatformMeta {
  id: string
  name: string
  icon: string
  homepage: string
  capabilities: PlatformCapability[]
}

/**
 * Cookie
 */
export interface Cookie {
  name: string
  value: string
  domain: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  expirationDate?: number
}

/**
 * Header 规则
 */
export interface HeaderRule {
  id?: string
  urlFilter: string
  headers: Record<string, string>
  resourceTypes?: string[]
}

/**
 * 请求选项
 */
export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: BodyInit | Record<string, unknown>
  timeout?: number
}
