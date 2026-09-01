/**
 * 今日头条适配器。
 *
 * 当前仅创建并验证云端草稿。头条发布页会在 MAIN world 注入请求签名，
 * 因此扩展运行时优先复用发布页发起请求，但始终固定 save=0。
 */
import { CodeAdapter, type ImageUploadResult } from '../code-adapter'
import type { Article, AuthResult, PlatformMeta, SyncResult } from '../../types'
import type { PublishOptions } from '../types'

type JsonObject = Record<string, unknown>

interface ToutiaoResponse extends JsonObject {
  code?: number | string
  errno?: number | string
  message?: string
  reason?: string
  data?: JsonObject
  pgcId?: string | number
  pgc_id?: string | number
}

interface PageFetchResult {
  ok: boolean
  status: number
  text: string
}

export class ToutiaoAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: 'toutiao',
    name: '今日头条',
    icon: 'https://mp.toutiao.com/favicon.ico',
    homepage: 'https://mp.toutiao.com/profile_v4/',
    capabilities: ['article', 'draft', 'image_upload', 'browser_publish'],
  }

  readonly preprocessConfig = { outputFormat: 'html' as const }

  private readonly publishPage = 'https://mp.toutiao.com/profile_v4/graphic/publish'
  private readonly headerRules = [{
    urlFilter: '*://mp.toutiao.com/*',
    headers: { Origin: 'https://mp.toutiao.com', Referer: this.publishPage },
    resourceTypes: ['xmlhttprequest'],
  }]

  async checkAuth(): Promise<AuthResult> {
    try {
      return await this.withHeaderRules(this.headerRules, async () => {
        const response = await this.runtime.fetch(
          'https://mp.toutiao.com/mp/agw/creator_center/user_info',
          { credentials: 'include' },
        )
        const res = await this.readJson(response, '今日头条登录检查')
        const identity = this.extractIdentity(res)
        return identity
          ? { isAuthenticated: true, ...identity }
          : { isAuthenticated: false, error: this.apiMessage(res) || '未检测到已登录的头条号账号' }
      })
    } catch (error) {
      return { isAuthenticated: false, error: (error as Error).message }
    }
  }

  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    return this.withHeaderRules(this.headerRules, async () => {
      const auth = await this.checkAuth()
      if (!auth.isAuthenticated) throw new Error(auth.error || '请先登录头条号')

      let content = article.html || article.markdown || ''
      content = await this.processImages(content, src => this.uploadImageByUrl(src), {
        skipPatterns: ['toutiao.com', 'toutiaocdn.com', 'toutiaoimg.com', 'byteimg.com'],
        onProgress: options?.onImageProgress,
      })

      const payload = new URLSearchParams({
        article_type: '0',
        pgc_id: '',
        source: '29',
        title: article.title,
        title_id: '',
        content,
        save: '0',
        entrance: '',
        timer_status: '0',
        timer_time: '',
        search_creation_info: JSON.stringify({ searchTopOne: 0, abstract: '', clue_id: null, activity_type: 1 }),
        ic_uri_list: '[]',
        pgc_feed_covers: '[]',
        draft_form_data: JSON.stringify({ coverType: 1 }),
        article_ad_type: '2',
        claim_origin: '0',
        is_fans_article: '0',
        extra: JSON.stringify({ content_source: 100000000402, content_word_cnt: this.textLength(content) }),
      })

      const saved = await this.saveDraft(payload)
      const draftId = this.value(saved.data?.pgcId, saved.data?.pgc_id, saved.pgcId, saved.pgc_id)
      if (!this.isSuccess(saved) || !draftId) {
        throw new Error(this.apiMessage(saved) || '今日头条草稿保存失败')
      }

      const draftUrl = `${this.publishPage}?pgc_id=${encodeURIComponent(draftId)}`
      await this.verifyDraft(draftId, article.title)
      return this.createResult(true, {
        postId: draftId,
        postUrl: draftUrl,
        draftOnly: true,
        message: options?.draftOnly === false
          ? '当前头条适配器仅支持草稿，已保存草稿但未公开发布'
          : '头条号草稿已保存并验证',
      })
    }).catch(error => this.createResult(false, {
      draftOnly: true,
      error: (error as Error).message,
    }))
  }

  protected async uploadImageByUrl(url: string): Promise<ImageUploadResult> {
    const response = await this.runtime.fetch(
      'https://mp.toutiao.com/spice/image?upload_source=20020003&need_enhance=true&aid=1231&device_platform=web&scene=paste',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ imageUrl: url }),
      },
    )
    const res = await this.readJson(response, '今日头条图片上传')
    const uploadedUrl = this.value(res.data?.origin_image_url, res.data?.image_url, res.data?.url)
    if (!this.isSuccess(res) || !uploadedUrl) throw new Error(this.apiMessage(res) || '今日头条图片上传失败')
    return { url: uploadedUrl }
  }

  private async saveDraft(payload: URLSearchParams): Promise<ToutiaoResponse> {
    const url = 'https://mp.toutiao.com/mp/agw/article/publish?source=mp&type=article&aid=1231&mp_publish_ab_val=0'
    if (!this.runtime.tabs) {
      const response = await this.runtime.fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: payload,
      })
      return this.readJson(response, '今日头条草稿保存')
    }

    let [tab] = await this.runtime.tabs.query('https://mp.toutiao.com/profile_v4/graphic/publish*')
    if (!tab) {
      tab = await this.runtime.tabs.create(this.publishPage, false)
      await this.runtime.tabs.waitForLoad(tab.id, 30000)
    }
    const result = await this.runtime.tabs.executeScript<PageFetchResult, [string, string]>(
      tab.id,
      async (requestUrl, body) => {
        const response = await fetch(requestUrl, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body,
        })
        return { ok: response.ok, status: response.status, text: await response.text() }
      },
      [url, payload.toString()],
    )
    if (!result.ok) throw new Error(`今日头条草稿保存失败: HTTP ${result.status}`)
    return this.parseJson(result.text, '今日头条草稿保存')
  }

  private async verifyDraft(draftId: string, expectedTitle: string): Promise<void> {
    const response = await this.runtime.fetch(
      `https://mp.toutiao.com/mp/agw/article/edit?pgc_id=${encodeURIComponent(draftId)}&wxstyle=0&format=json`,
      { credentials: 'include' },
    )
    const res = await this.readJson(response, '今日头条草稿验证')
    const root = res.data || res
    const article = this.object(root.articlePgc) || this.object(root.article_pgc)
    const actualTitle = this.value(root.title, article?.title)
    const actualId = this.value(root.pgcId, root.pgc_id, article?.pgcId, article?.pgc_id, article?.id) || draftId
    if (!this.isSuccess(res) || actualTitle !== expectedTitle || actualId !== draftId) {
      throw new Error(`头条草稿验证失败：预期“${expectedTitle}”/${draftId}，实际“${actualTitle || '空'}”/${actualId}`)
    }
  }

  private async readJson(response: Response, action: string): Promise<ToutiaoResponse> {
    const text = await response.text()
    if (!response.ok) throw new Error(`${action}失败: HTTP ${response.status} - ${text.slice(0, 200)}`)
    return this.parseJson(text, action)
  }

  private parseJson(text: string, action: string): ToutiaoResponse {
    try { return JSON.parse(text) as ToutiaoResponse }
    catch { throw new Error(`${action}失败：响应不是有效 JSON`) }
  }

  private isSuccess(res: ToutiaoResponse): boolean {
    return Number(res.code ?? res.errno ?? 0) === 0
  }

  private apiMessage(res: ToutiaoResponse): string {
    return this.value(res.message, res.reason) || ''
  }

  private extractIdentity(res: ToutiaoResponse): Pick<AuthResult, 'userId' | 'username' | 'avatar'> | null {
    const data = res.data || res
    const candidates = [
      this.object(data.user), this.object(data.user_info), this.object(data.account_info),
      this.object(data.creator_info), data,
    ].filter((item): item is JsonObject => Boolean(item))
    for (const item of candidates) {
      const userId = this.value(item.user_id_str, item.user_id, item.id_str, item.id)
      const username = this.value(item.display_name, item.user_name, item.name, item.screen_name)
      if (userId && username) {
        return { userId, username, avatar: this.value(item.https_avatar_url, item.avatar_url, item.avatar) || undefined }
      }
      for (const child of Object.values(item)) {
        const nested = this.object(child)
        if (!nested) continue
        const nestedId = this.value(nested.user_id_str, nested.user_id, nested.id_str, nested.id)
        const nestedName = this.value(nested.display_name, nested.user_name, nested.name, nested.screen_name)
        if (nestedId && nestedName) return { userId: nestedId, username: nestedName }
      }
    }
    return null
  }

  private object(value: unknown): JsonObject | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
  }

  private value(...values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    }
    return null
  }

  private textLength(html: string): number {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length
  }
}
