import type {
  DraftPublishPreview,
  DraftPublishResult,
  DraftPublisher,
  DraftRecord,
  RuntimeInterface,
} from '@wechatsync/core'

const PUBLISH_INCLUDE = 'is_visible,paid_info,paid_info_content,has_column,admin_closed_comment,reward_info,annotation_action,annotation_detail,collapse_reason,is_normal,is_sticky,collapsed_by,suggest_edit,comment_count,thanks_count,favlists_count,can_comment,content,editable_content,voteup_count,reshipment_settings,comment_permission,created_time,updated_time,review_info,relevant_info,question,excerpt,attachment,content_source,is_labeled,endorsements,reaction_instruction,ip_info,relationship.is_authorized,voting,is_thanked,is_author,is_nothelp,is_favorited;author.vip_info,kvip_info,badge[*].topics;settings.table_of_content.enabled'

interface ZhihuDraft {
  title?: string
  content?: string
}

interface PublishVerification {
  published: boolean
  diagnostic: string
}

const DEFAULT_VERIFICATION_RETRY_DELAYS = [1000, 2000, 4000]

export function summarizeHtml(html: string, maxLength = 160): string {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&ensp;|&emsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()

  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

export class ZhihuDraftPublisher implements DraftPublisher {
  readonly platform = 'zhihu'

  constructor(
    private readonly runtime: RuntimeInterface,
    private readonly verificationRetryDelays = DEFAULT_VERIFICATION_RETRY_DELAYS
  ) {}

  async getPreview(record: DraftRecord): Promise<DraftPublishPreview> {
    const draft = await this.getDraft(record.draftId)

    return {
      platform: record.platform,
      platformName: record.platformName,
      draftId: record.draftId,
      draftName: draft.title || record.draftName,
      draftUrl: record.draftUrl,
      summary: summarizeHtml(draft.content || ''),
    }
  }

  async verifyPublished(record: DraftRecord): Promise<DraftPublishResult | null> {
    try {
      // 中断恢复发生在发布尝试已超时后，无需再次等待完整重试窗口。
      const verification = await this.verifyPublicArticle(record.draftId, record.draftName)
      if (!verification.published) return null
      return {
        platform: record.platform,
        platformName: record.platformName,
        success: true,
        status: 'published',
        postId: record.draftId,
        postUrl: `https://zhuanlan.zhihu.com/p/${record.draftId}`,
        publishedAt: Date.now(),
        error: null,
      }
    } catch {
      return null
    }
  }

  async publish(record: DraftRecord): Promise<DraftPublishResult> {
    try {
      const draft = await this.getDraft(record.draftId)
      const title = draft.title || record.draftName
      const content = draft.content || ''
      if (!content) throw new Error('知乎草稿内容为空，无法发布')

      return await this.withHeaderRules(async () => {
        const response = await this.runtime.fetch('https://www.zhihu.com/api/v4/content/publish', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'x-requested-with': 'fetch',
          },
          body: JSON.stringify(this.createPublishBody(record.draftId, content)),
        })
        const responseText = await response.text()
        if (!response.ok) {
          throw new Error(`知乎发布失败: HTTP ${response.status} - ${responseText.substring(0, 200)}`)
        }

        let data: { code?: number; message?: string; data?: { result?: string } }
        try {
          data = JSON.parse(responseText)
        } catch {
          throw new Error('知乎发布失败: 返回内容不是有效 JSON')
        }
        if (data.code !== 0) {
          throw new Error(`知乎发布失败: ${data.message || `错误码 ${data.code ?? 'unknown'}`}`)
        }

        let postId = record.draftId
        let reviewing = false
        if (data.data?.result) {
          try {
            const publishResult = JSON.parse(data.data.result) as {
              publish?: { id?: string | number; review_info?: { is_reviewing?: boolean } }
            }
            if (publishResult.publish?.id) postId = String(publishResult.publish.id)
            reviewing = Boolean(publishResult.publish?.review_info?.is_reviewing)
          } catch {
            // 发布接口本身成功时，无法解析嵌套结果则继续使用草稿 ID 做只读验证。
          }
        }

        const postUrl = `https://zhuanlan.zhihu.com/p/${postId}`
        if (reviewing) {
          return {
            platform: record.platform,
            platformName: record.platformName,
            success: false,
            status: 'reviewing',
            postId,
            postUrl,
            publishedAt: null,
            error: '文章已提交知乎审核，暂未公开',
          }
        }

        const verification = await this.verifyPublicArticleWithRetry(postId, title)
        if (!verification.published) {
          return {
            platform: record.platform,
            platformName: record.platformName,
            success: false,
            status: 'unverified',
            postId,
            postUrl,
            publishedAt: null,
            error: `知乎已接受发布请求，但公开页面尚未验证成功（${verification.diagnostic}）`,
          }
        }

        return {
          platform: record.platform,
          platformName: record.platformName,
          success: true,
          status: 'published',
          postId,
          postUrl,
          publishedAt: Date.now(),
          error: null,
        }
      })
    } catch (error) {
      return {
        platform: record.platform,
        platformName: record.platformName,
        success: false,
        status: 'failed',
        postId: null,
        postUrl: null,
        publishedAt: null,
        error: (error as Error).message,
      }
    }
  }

  private async getDraft(draftId: string): Promise<ZhihuDraft> {
    return this.withHeaderRules(async () => {
      const response = await this.runtime.fetch(
        `https://zhuanlan.zhihu.com/api/articles/${draftId}/draft`,
        {
          method: 'GET',
          credentials: 'include',
          headers: { 'x-requested-with': 'fetch' },
        }
      )
      if (!response.ok) throw new Error(`读取知乎草稿失败: HTTP ${response.status}`)
      return await response.json() as ZhihuDraft
    })
  }

  private async verifyPublicArticleWithRetry(
    postId: string,
    expectedTitle: string
  ): Promise<PublishVerification> {
    let verification = await this.verifyPublicArticle(postId, expectedTitle)
    if (verification.published) return verification

    for (const delay of this.verificationRetryDelays) {
      await new Promise(resolve => setTimeout(resolve, delay))
      verification = await this.verifyPublicArticle(postId, expectedTitle)
      if (verification.published) return verification
    }

    return verification
  }

  private async verifyPublicArticle(
    postId: string,
    expectedTitle: string
  ): Promise<PublishVerification> {
    const diagnostics: string[] = []

    try {
      const response = await this.runtime.fetch(`https://www.zhihu.com/api/v4/articles/${postId}`, {
        method: 'GET',
        credentials: 'omit',
        headers: { 'x-requested-with': 'fetch' },
      })
      if (response.ok) {
        const article = await response.json() as {
          id?: string | number
          title?: string
          is_published?: boolean
          review_info?: { is_reviewing?: boolean }
        }
        const idMatches = String(article.id ?? '') === postId
        const titleMatches = article.title?.trim() === expectedTitle.trim()
        const isPublic = article.is_published !== false && !article.review_info?.is_reviewing
        if (idMatches && titleMatches && isPublic) {
          return { published: true, diagnostic: '知乎公开 API 验证成功' }
        }
        diagnostics.push(
          `公开 API 内容未就绪（ID ${idMatches ? '匹配' : '不匹配'}、标题${titleMatches ? '匹配' : '不匹配'}、状态${isPublic ? '公开' : '未公开'}）`
        )
      } else {
        diagnostics.push(`公开 API HTTP ${response.status}`)
      }
    } catch (error) {
      diagnostics.push(`公开 API 请求异常：${(error as Error).message}`)
    }

    try {
      const publicUrl = `https://zhuanlan.zhihu.com/p/${postId}`
      const response = await this.runtime.fetch(publicUrl, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'follow',
      })
      if (response.ok) {
        const html = await response.text()
        const pageTitle = extractHtmlTitle(html)
        if (pageTitle.includes(expectedTitle.trim())) {
          return { published: true, diagnostic: '知乎公开文章页验证成功' }
        }
        diagnostics.push('公开文章页标题未匹配')
      } else {
        diagnostics.push(`公开文章页 HTTP ${response.status}`)
      }
    } catch (error) {
      diagnostics.push(`公开文章页请求异常：${(error as Error).message}`)
    }

    const browserVerification = await this.verifyPublicArticleInTab(postId, expectedTitle)
    if (browserVerification.published) return browserVerification
    diagnostics.push(browserVerification.diagnostic)

    return { published: false, diagnostic: diagnostics.join('；') }
  }

  private async verifyPublicArticleInTab(
    postId: string,
    expectedTitle: string
  ): Promise<PublishVerification> {
    if (!this.runtime.tabs) {
      return { published: false, diagnostic: '浏览器页面验证不可用' }
    }

    let tabId: number | null = null
    try {
      const publicUrl = `https://zhuanlan.zhihu.com/p/${postId}`
      const tab = await this.runtime.tabs.create(publicUrl, false)
      tabId = tab.id
      await this.runtime.tabs.waitForLoad(tab.id, 15000)
      const page = await this.runtime.tabs.executeScript<{
        href: string
        title: string
        heading: string
        hasArticle: boolean
      }, []>(tab.id, () => ({
        href: window.location.href,
        title: document.title.trim(),
        heading: document.querySelector('h1')?.textContent?.trim() || '',
        hasArticle: Boolean(document.querySelector('article')),
      }), [])
      const expectedUrl = `/p/${postId}`
      const urlMatches = new URL(page.href).pathname === expectedUrl
      const titleMatches = page.heading === expectedTitle.trim()
        || page.title.includes(expectedTitle.trim())
      if (urlMatches && titleMatches && page.hasArticle) {
        return { published: true, diagnostic: '知乎浏览器公开页验证成功' }
      }
      return {
        published: false,
        diagnostic: `浏览器公开页未匹配（URL ${urlMatches ? '匹配' : '不匹配'}、标题${titleMatches ? '匹配' : '不匹配'}、正文${page.hasArticle ? '存在' : '不存在'}）`,
      }
    } catch (error) {
      return { published: false, diagnostic: `浏览器公开页验证异常：${(error as Error).message}` }
    } finally {
      if (tabId !== null && this.runtime.tabs.remove) {
        try {
          await this.runtime.tabs.remove(tabId)
        } catch {
          // 临时标签页可能已被用户关闭，无需影响发布结果。
        }
      }
    }
  }

  private createPublishBody(draftId: string, content: string): Record<string, unknown> {
    const textLength = summarizeHtml(content, Number.MAX_SAFE_INTEGER).length
    const businessParams = {
      article_id: draftId,
      reward_setting: { can_reward: false },
      reshipment_settings: 'allowed',
      thank_inviter: '',
      comment_permission: 'all',
      commercial_zhitask_bind_info: null,
      column: null,
      is_report: false,
      thank_inviter_status: 'close',
      table_of_contents_enabled: false,
      disclaimer_status: 'close',
      disclaimer_type: 'none',
      commercial_report_info: { is_report: false },
    }

    return {
      action: 'article',
      data: {
        hybridInfo: {},
        toFollower: {},
        publish: { traceId: `${Math.floor(Date.now() / 1000)},${crypto.randomUUID()}` },
        extra_info: {
          publisher: 'pc',
          include: PUBLISH_INCLUDE,
          pc_business_params: JSON.stringify(businessParams),
        },
        draft: { disabled: 1, isPublished: true, id: draftId },
        hybrid: { html: content, textLength },
        reprint: { reshipment_settings: 'allowed' },
        commentsPermission: { comment_permission: 'all' },
        appreciate: { can_reward: false, tagline: '' },
        publishSwitch: { draft_type: 'normal' },
        creationStatement: { disclaimer_type: 'none', disclaimer_status: 'closed' },
        contentsTables: { table_of_contents_enabled: false },
        commercialReportInfo: { isReport: 0 },
        thanksInvitation: { thank_inviter_status: 'close', thank_inviter: '' },
      },
    }
  }

  private async withHeaderRules<T>(operation: () => Promise<T>): Promise<T> {
    const ruleIds: string[] = []
    const rules = [
      '*://www.zhihu.com/api/*',
      '*://zhuanlan.zhihu.com/api/*',
    ]

    if (this.runtime.headerRules) {
      for (const urlFilter of rules) {
        ruleIds.push(await this.runtime.headerRules.add({
          urlFilter,
          headers: { 'x-requested-with': 'fetch' },
          resourceTypes: ['xmlhttprequest'],
        }))
      }
    }

    try {
      return await operation()
    } finally {
      if (this.runtime.headerRules) {
        for (const ruleId of ruleIds) await this.runtime.headerRules.remove(ruleId)
      }
    }
  }
}

function extractHtmlTitle(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''
  return title
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
