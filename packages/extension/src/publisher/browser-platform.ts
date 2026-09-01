import type {
  DraftPublishPreview,
  DraftPublishResult,
  DraftPublisher,
  DraftRecord,
  RuntimeInterface,
} from '@wechatsync/core'
import { summarizeHtml } from './zhihu'

export interface BrowserPublisherConfig {
  platform: string
  draftUrlBuilder?: (draftId: string) => string
  titleSelectors: string[]
  contentSelectors: string[]
  publishSelectors: string[]
  publishLabels: string[]
  preConfirmDisableToggleLabels?: string[]
  /** 新版发布弹窗可能已移除该开关；缺失时直接进入确认流程。 */
  preConfirmToggleOptional?: boolean
  /** 异步发布弹窗中等待通知开关出现或状态更新的最大次数。 */
  preConfirmToggleLookupAttempts?: number
  confirmLabels: string[]
  confirmOptionalAfterNavigation?: boolean
  /** 异步编辑器中等待发布按钮出现的最大查找次数。 */
  publishLookupAttempts?: number
  /** 点击发布后等待平台成功页或审核页出现的最大检查次数。 */
  postPublishTransitionAttempts?: number
  /** 异步弹窗中等待最终确认按钮出现的最大查找次数。 */
  confirmLookupAttempts?: number
  /** 平台发布流程中最多依次点击的确认步骤数。 */
  confirmSteps?: number
  /** 各确认步骤的平台精确选择器，文字匹配仅作后备。 */
  confirmStepSelectors?: string[][]
  /** 首次发布点击未打开确认流程时，允许重新触发发布按钮的次数。 */
  publishTransitionRetries?: number
  reviewStatusTabQueries?: string[]
  /** Build a freshly loaded status page so platforms that keep the editor open can still be verified. */
  reviewStatusUrlBuilder?: (record: DraftRecord) => string | null
  /** 状态列表页必须包含当前草稿标题或 ID，避免命中其他作品的审核状态。 */
  reviewStatusRequiresDraftMatch?: boolean
  publicTabQueries: string[]
  publicUrlPatterns: RegExp[]
  postIdPatterns: RegExp[]
  reviewingTexts: string[]
  /** 平台明确显示提交成功时，将审核中视为本次发布操作成功。 */
  reviewingIsSuccess?: boolean
  awaitingUserActionTexts?: string[]
  awaitingUserActionMessage?: string
  successTexts: string[]
}

interface PageState {
  url: string
  title: string
  content: string
  bodyText: string
}

interface ClickResult {
  clicked: boolean
  text: string | null
  disabled: boolean
  ambiguous?: boolean
}

interface ToggleResult {
  found: boolean
  on: boolean | null
  clicked: boolean
  ambiguous: boolean
}

interface BrowserPublisherTiming {
  confirmDelayMs?: number
  pollIntervalMs?: number
  pollAttempts?: number
}

export class BrowserPlatformDraftPublisher implements DraftPublisher {
  readonly platform: string
  private readonly confirmDelayMs: number
  private readonly pollIntervalMs: number
  private readonly pollAttempts: number

  constructor(
    private readonly runtime: RuntimeInterface,
    private readonly config: BrowserPublisherConfig,
    timing: BrowserPublisherTiming = {},
  ) {
    this.platform = config.platform
    this.confirmDelayMs = timing.confirmDelayMs ?? 700
    this.pollIntervalMs = timing.pollIntervalMs ?? 1200
    this.pollAttempts = timing.pollAttempts ?? 10
  }

  async getPreview(record: DraftRecord): Promise<DraftPublishPreview> {
    const tabId = await this.getDraftTab(record)
    const page = await this.readPage(tabId)
    return {
      platform: record.platform,
      platformName: record.platformName,
      draftId: record.draftId,
      draftName: page.title || record.draftName,
      draftUrl: record.draftUrl,
      summary: summarizeHtml(page.content || page.bodyText || '', 160),
    }
  }

  async verifyPublished(record: DraftRecord): Promise<DraftPublishResult | null> {
    try {
      const tabId = await this.getDraftTab(record)
      const page = await this.readPage(tabId)
      const result = this.classify(record, page)
      if (result.status === 'published' || result.status === 'reviewing') return result
    } catch {
      // 草稿标签页可能已跳转到平台的提交成功页，继续检查状态页。
    }
    if (this.runtime.tabs && this.config.reviewStatusTabQueries?.length) {
      for (const query of this.config.reviewStatusTabQueries) {
        const tabs = await this.runtime.tabs.query(query)
        for (const tab of tabs) {
          try {
            const page = await this.readReviewStatusPage(tab.id, record)
            if (this.config.reviewStatusRequiresDraftMatch) {
              const pageText = `${page.title}\n${page.content}\n${page.bodyText}`.replace(/\s+/g, '')
              const draftName = record.draftName.replace(/\s+/g, '')
              if (!pageText.includes(record.draftId) && !pageText.includes(draftName)) continue
            }
            const result = this.classify(record, page)
            if (result.status === 'published' || result.status === 'reviewing') return result
          } catch {
            // 忽略已经关闭或仍在跳转的状态页。
          }
        }
      }
    }
    const freshStatus = await this.readFreshReviewStatusPage(record)
    if (freshStatus) {
      const result = this.classify(record, freshStatus)
      if (result.status === 'published' || result.status === 'reviewing') return result
    }
    return null
  }

  async publish(record: DraftRecord): Promise<DraftPublishResult> {
    try {
      const tabId = await this.getDraftTab(record)
      const initial = await this.readPage(tabId)
      const existingPublicTabIds = await this.getPublicTabIds()
      await this.pause(this.confirmDelayMs)
      const publishClick = await this.clickPublishControl(tabId)
      if (publishClick.disabled) {
        throw new Error(`${record.platformName}发布按钮当前不可用，请检查平台必填项`)
      }
      if (!publishClick.clicked) {
        throw new Error(publishClick.ambiguous
          ? `${record.platformName}找到多个发布按钮，已停止操作，请在平台页面关闭多余弹窗后重试`
          : `${record.platformName}发布按钮未找到，请确认草稿编辑页已完整加载`)
      }

      await this.pause(this.confirmDelayMs)
      if (this.config.confirmOptionalAfterNavigation) {
        const attempts = Math.max(1, this.config.postPublishTransitionAttempts ?? 1)
        for (let attempt = 0; attempt < attempts; attempt++) {
          try {
            const afterPublish = this.classify(record, await this.readPage(tabId))
            if (afterPublish.status !== 'unverified') return afterPublish
          } catch {
            // 页面正在跳转时继续等待。
          }
          if (attempt + 1 < attempts) await this.pause(this.confirmDelayMs)
        }
      }
      if (this.config.preConfirmDisableToggleLabels?.length) {
        const labels = this.config.preConfirmDisableToggleLabels
        const toggleAttempts = Math.max(1, this.config.preConfirmToggleLookupAttempts ?? 1)
        let toggle: ToggleResult = {
          found: false, on: null, clicked: false, ambiguous: false,
        }
        for (let attempt = 0; attempt < toggleAttempts; attempt++) {
          toggle = await this.setToggleOff(tabId, labels, true)
          if (toggle.found || toggle.ambiguous) break
          if (attempt + 1 < toggleAttempts) await this.pause(this.confirmDelayMs)
        }
        if (toggle.ambiguous) {
          throw new Error(`${record.platformName}找到多个“${labels[0]}”开关，已停止操作`)
        }
        if (toggle.found) {
          await this.pause(this.confirmDelayMs)
          let verified: ToggleResult = toggle
          for (let attempt = 0; attempt < toggleAttempts; attempt++) {
            verified = await this.setToggleOff(tabId, labels, false)
            if (verified.found && !verified.ambiguous && verified.on === false) break
            if (attempt + 1 < toggleAttempts) await this.pause(this.confirmDelayMs)
          }
          if (!verified.found || verified.ambiguous || verified.on !== false) {
            throw new Error(`${record.platformName}未能确认“${labels[0]}”已关闭，已停止发布`)
          }
        } else if (!this.config.preConfirmToggleOptional) {
          throw new Error(`${record.platformName}未找到“${labels[0]}”开关，已停止发布`)
        }
      }
      const confirmSteps = Math.max(1, this.config.confirmSteps ?? 1)
      const publishTransitionRetries = Math.max(0, this.config.publishTransitionRetries ?? 0)
      let publishTransitionRetry = 0
      let step = 0
      while (step < confirmSteps) {
        const confirmClick = await this.clickConfirmControl(tabId, step)
        if (confirmClick.disabled) {
          throw new Error(`${record.platformName}确认发布按钮当前不可用`)
        }
        if (confirmClick.ambiguous) {
          throw new Error(`${record.platformName}找到多个确认按钮，已停止操作，请关闭多余弹窗后重试`)
        }
        if (!confirmClick.clicked) {
          const transitioned = await this.readPage(tabId)
          if (this.isReviewStatusUrl(transitioned.url)) break
          if (step === 0 && publishTransitionRetry < publishTransitionRetries) {
            publishTransitionRetry++
            const retryClick = await this.clickPublishControl(tabId)
            if (retryClick.disabled || retryClick.ambiguous || !retryClick.clicked) {
              throw new Error(`${record.platformName}未能重新触发发布流程，已停止操作`)
            }
            await this.pause(this.confirmDelayMs)
            continue
          }
          if (step > 0) break
          throw new Error(confirmSteps === 1
            ? `${record.platformName}弹窗内的确认发布按钮未找到，已停止操作`
            : `${record.platformName}第 1 个确认发布按钮未找到，已停止操作`)
        }
        step++
        if (step < confirmSteps) await this.pause(this.confirmDelayMs)
      }

      let latest = initial
      for (let attempt = 0; attempt < this.pollAttempts; attempt++) {
        await this.pause(this.pollIntervalMs)
        try {
          latest = await this.readPage(tabId)
          if (this.isReviewStatusUrl(latest.url)) {
            latest = await this.readReviewStatusPage(tabId, record)
          }
        } catch {
          // 编辑页可能正在跳转；继续检查平台新打开的公开文章标签页。
        }
        const classified = this.classify(record, latest)
        if (classified.status !== 'unverified') return classified
        const publicPage = await this.findNewPublicPage(existingPublicTabIds)
        if (publicPage) return this.classify(record, publicPage)
      }

      const freshStatus = await this.readFreshReviewStatusPage(record)
      if (freshStatus) {
        const classified = this.classify(record, freshStatus)
        if (classified.status !== 'unverified') return classified
      }

      return this.result(record, 'unverified', null, latest.url || null,
        `${record.platformName}已执行发布操作，但尚未获得可验证的公开地址`)
    } catch (error) {
      return this.result(record, 'failed', null, null, (error as Error).message)
    }
  }

  private async getDraftTab(record: DraftRecord): Promise<number> {
    const draftUrl = this.config.draftUrlBuilder?.(record.draftId) || record.draftUrl
    if (!draftUrl) throw new Error(`${record.platformName}草稿缺少编辑地址`)
    if (!this.runtime.tabs) throw new Error(`${record.platformName}公开发布仅支持 Chrome 扩展运行时`)

    const url = new URL(draftUrl)
    const pattern = `${url.protocol}//${url.host}/*`
    const existing = (await this.runtime.tabs.query(pattern))
      .find(tab => tab.url === draftUrl || tab.url?.includes(record.draftId))
    if (existing) return existing.id

    const tab = await this.runtime.tabs.create(draftUrl, false)
    await this.runtime.tabs.waitForLoad(tab.id, 30000)
    return tab.id
  }

  private async readPage(tabId: number): Promise<PageState> {
    return this.runtime.tabs!.executeScript<PageState, [string[], string[]]>(
      tabId,
      (titleSelectors, contentSelectors) => {
        const read = (selectors: string[]): string => {
          for (const selector of selectors) {
            const element = document.querySelector(selector) as HTMLInputElement | HTMLElement | null
            if (!element) continue
            const value = 'value' in element ? String(element.value || '') : ''
            const text = value || element.innerText || element.textContent || element.innerHTML || ''
            if (text.trim()) return text.trim()
          }
          return ''
        }
        return {
          url: location.href,
          title: read(titleSelectors),
          content: read(contentSelectors),
          bodyText: (document.body?.innerText || '').slice(0, 30000),
        }
      },
      [this.config.titleSelectors, this.config.contentSelectors],
    )
  }

  private async readReviewStatusPage(tabId: number, record: DraftRecord): Promise<PageState> {
    return this.runtime.tabs!.executeScript<PageState, [string, string]>(
      tabId,
      (draftId, draftName) => {
        const normalize = (text: string | null | undefined) => (text || '').replace(/\s+/g, '')
        const expectedName = normalize(draftName)
        const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[]
        const matched = anchors.find(anchor => anchor.href.includes(draftId))
          || anchors.find(anchor => normalize(anchor.textContent).includes(expectedName))
        let matchedText = ''
        if (matched) {
          let container: HTMLElement | null = matched
          for (let depth = 0; container && depth < 6; depth++) {
            const text = container.innerText || container.textContent || ''
            if (/审核中|已发布|审核未通过|仅我可见/.test(text) && text.length <= 1500) {
              matchedText = text
              break
            }
            container = container.parentElement
          }
        }
        return {
          url: matched?.href || location.href,
          title: matched?.textContent?.trim() || '',
          content: '',
          bodyText: matchedText,
        }
      },
      [record.draftId, record.draftName],
    )
  }

  private async readFreshReviewStatusPage(record: DraftRecord): Promise<PageState | null> {
    if (!this.runtime.tabs || !this.config.reviewStatusUrlBuilder) return null
    const statusUrl = this.config.reviewStatusUrlBuilder(record)
    if (!statusUrl) return null
    try {
      const tab = await this.runtime.tabs.create(statusUrl, false)
      await this.runtime.tabs.waitForLoad(tab.id, 30000)
      return await this.readReviewStatusPage(tab.id, record)
    } catch {
      return null
    }
  }

  private isReviewStatusUrl(url: string): boolean {
    return Boolean(url && this.config.reviewStatusTabQueries?.some(query => (
      url.startsWith(query.replace(/\*.*$/, ''))
    )))
  }

  private async getPublicTabIds(): Promise<Set<number>> {
    const ids = new Set<number>()
    if (!this.runtime.tabs) return ids
    for (const query of this.config.publicTabQueries) {
      for (const tab of await this.runtime.tabs.query(query)) ids.add(tab.id)
    }
    return ids
  }

  private async findNewPublicPage(existingIds: Set<number>): Promise<PageState | null> {
    if (!this.runtime.tabs) return null
    for (const query of this.config.publicTabQueries) {
      const tabs = await this.runtime.tabs.query(query)
      for (const tab of tabs) {
        if (existingIds.has(tab.id) || !tab.url) continue
        if (!this.config.publicUrlPatterns.some(pattern => pattern.test(tab.url!))) continue
        try {
          const page = await this.readPage(tab.id)
          return { ...page, url: tab.url }
        } catch {
          return { url: tab.url, title: '', content: '', bodyText: '' }
        }
      }
    }
    return null
  }

  private async clickControl(tabId: number, selectors: string[], labels: string[]): Promise<ClickResult> {
    return this.runtime.tabs!.executeScript<ClickResult, [string[], string[]]>(
      tabId,
      (controlSelectors, controlLabels) => {
        if (controlSelectors.length > 0) {
          const scrollingElement = document.scrollingElement || document.documentElement
          scrollingElement.scrollTo({ top: scrollingElement.scrollHeight, behavior: 'instant' })
          document.querySelectorAll('main, [class*="scroll"], [class*="editor"]')
            .forEach(element => {
              const html = element as HTMLElement
              if (html.scrollHeight > html.clientHeight) html.scrollTop = html.scrollHeight
            })
        }
        const visible = (element: Element): boolean => {
          const html = element as HTMLElement
          const style = getComputedStyle(html)
          const rect = html.getBoundingClientRect()
          if (style.display === 'none' || style.visibility === 'hidden'
            || rect.width <= 0 || rect.height <= 0) return false
          const hit = document.elementFromPoint(
            Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2)),
            Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2)),
          )
          return Boolean(hit && (hit === element || element.contains(hit) || hit.contains(element)))
        }
        const normalize = (text: string | null | undefined) => (text || '').replace(/\s+/g, '')
        const labelsNormalized = controlLabels.map(normalize)
        const selectorCandidates: Element[] = []
        for (const selector of controlSelectors) {
          document.querySelectorAll(selector).forEach(element => selectorCandidates.push(element))
        }
        const dialog = controlSelectors.length === 0
          ? Array.from(document.querySelectorAll(
            '[role="dialog"], .weui-desktop-dialog, .weui-desktop-dialog__wrp, [class*="dialog"]',
          )).filter(visible).sort((a, b) => {
            const aRect = a.getBoundingClientRect()
            const bRect = b.getBoundingClientRect()
            return bRect.width * bRect.height - aRect.width * aRect.height
          })[0]
          : null
        const candidateRoot = dialog || document
        const generalCandidates = Array.from(candidateRoot.querySelectorAll(
          'button, a, [role="button"], .weui-desktop-btn, .ant-btn, .arco-btn, .semi-button, .byte-btn, [class*="button"], [class*="-btn"], [class*="_btn"]',
        ))
        const matches = (elements: Element[]) => Array.from(new Set(elements)).filter(element => {
          if (!visible(element)) return false
          const text = normalize(element.textContent)
          return labelsNormalized.some(label => text === label || text.includes(label))
        })
        const exactMatches = (elements: Element[]) => matches(elements).filter(element => {
          const text = normalize(element.textContent)
          return labelsNormalized.includes(text)
        })

        const leafTextCandidates = Array.from(candidateRoot.querySelectorAll('span, div, p'))
          .filter(element => {
            if (!visible(element) || !labelsNormalized.includes(normalize(element.textContent))) return false
            return !Array.from(element.children).some(child => (
              labelsNormalized.includes(normalize(child.textContent))
            ))
          })
          .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)

        const preferred = exactMatches(selectorCandidates)
        const visibleSelectorCandidates = Array.from(new Set(selectorCandidates))
          .filter(visible)
          .filter(element => !selectorCandidates.some(other => (
            other !== element && element.contains(other) && visible(other)
          )))
        const selectorFallback = preferred.length > 0
          ? preferred
          : matches(selectorCandidates).length > 0
            ? matches(selectorCandidates)
            : visibleSelectorCandidates
        const standardFallbackRaw = selectorFallback.length > 0
          ? selectorFallback
          : exactMatches(generalCandidates).length > 0
            ? exactMatches(generalCandidates)
            : matches(generalCandidates)
        const standardFallback = standardFallbackRaw.filter(element => (
          !standardFallbackRaw.some(other => other !== element && element.contains(other))
        ))
        const fallback = standardFallback.length > 0
          ? standardFallback
          : leafTextCandidates.length > 0
            ? [leafTextCandidates[0]]
            : []

        if (fallback.length > 1) {
          return { clicked: false, text: null, disabled: false, ambiguous: true }
        }
        const target = fallback[0] as HTMLButtonElement | HTMLElement | undefined

        if (!target) return { clicked: false, text: null, disabled: false, ambiguous: false }
        const disabled = Boolean((target as HTMLButtonElement).disabled)
          || target.getAttribute('aria-disabled') === 'true'
          || target.classList.contains('disabled')
        if (!disabled) target.click()
        return { clicked: !disabled, text: target.textContent?.trim() || null, disabled, ambiguous: false }
      },
      [selectors, labels],
    )
  }

  private async clickPublishControl(tabId: number): Promise<ClickResult> {
    const attempts = Math.max(1, this.config.publishLookupAttempts ?? 1)
    let latest: ClickResult = { clicked: false, text: null, disabled: false, ambiguous: false }
    for (let attempt = 0; attempt < attempts; attempt++) {
      latest = await this.clickControl(
        tabId,
        this.config.publishSelectors,
        this.config.publishLabels,
      )
      if (latest.clicked || latest.disabled || latest.ambiguous) return latest
      if (attempt + 1 < attempts) await this.pause(this.confirmDelayMs)
    }
    return latest
  }

  private async clickConfirmControl(tabId: number, step: number): Promise<ClickResult> {
    const attempts = Math.max(1, this.config.confirmLookupAttempts ?? 1)
    const selectors = this.config.confirmStepSelectors?.[step] || []
    let latest: ClickResult = { clicked: false, text: null, disabled: false, ambiguous: false }
    for (let attempt = 0; attempt < attempts; attempt++) {
      latest = await this.clickControl(tabId, selectors, this.config.confirmLabels)
      if (latest.clicked || latest.ambiguous) return latest
      if (attempt + 1 < attempts) await this.pause(this.confirmDelayMs)
    }
    return latest
  }

  private async setToggleOff(tabId: number, labels: string[], clickIfOn: boolean): Promise<ToggleResult> {
    return this.runtime.tabs!.executeScript<ToggleResult, [string[], boolean]>(
      tabId,
      (toggleLabels, shouldClick) => {
        const normalize = (text: string | null | undefined) => (text || '').replace(/\s+/g, '')
        const expected = toggleLabels.map(normalize)
        const visible = (element: Element): boolean => {
          const html = element as HTMLElement
          const style = getComputedStyle(html)
          return style.display !== 'none' && style.visibility !== 'hidden'
            && html.getBoundingClientRect().width > 0 && html.getBoundingClientRect().height > 0
        }

        // WeChat's current publish panel keeps the actual state on a hidden
        // input.weui-desktop-switch__input. Clicking the visible shell does
        // not consistently trigger the controlled checkbox, so target the
        // exact form row and dispatch the native change event as well.
        const dialogs = Array.from(document.querySelectorAll(
          '.weui-desktop-dialog__wrp, .weui-desktop-dialog, [role="dialog"]',
        )).filter(visible)
        for (const dialog of dialogs) {
          const formLabels = Array.from(dialog.querySelectorAll(
            'label.weui-desktop-form__label, .weui-desktop-form__label',
          )).filter(label => expected.some(text => normalize(label.textContent).includes(text)))
          for (const formLabel of formLabels) {
            const row = formLabel.closest(
              '.weui-desktop-form__control-group, .mass-send__td, .mass-send__td-setting',
            ) || formLabel.parentElement
            const input = row?.querySelector<HTMLInputElement>(
              'input.weui-desktop-switch__input, input[type="checkbox"]',
            )
            if (!input) continue
            const on = input.checked
            const shouldToggle = on && shouldClick && !input.disabled
            if (shouldToggle) {
              input.click()
              input.dispatchEvent(new Event('change', { bubbles: true }))
            }
            return { found: true, on, clicked: shouldToggle, ambiguous: false }
          }
        }

        const labelsFound = Array.from(document.querySelectorAll(
          'label, span, p, div, .weui-desktop-form__label',
        )).filter(element => {
          if (!visible(element)) return false
          const text = normalize(element.textContent)
          return expected.some(labelText => text.includes(labelText))
        })
        const leafLabels = labelsFound.filter(element => (
          !Array.from(element.children).some(child => (
            expected.some(labelText => normalize(child.textContent).includes(labelText))
          ))
        ))
        const matches = (leafLabels.length ? leafLabels : labelsFound).sort((a, b) => {
          const textDifference = normalize(a.textContent).length - normalize(b.textContent).length
          if (textDifference !== 0) return textDifference
          const aRect = a.getBoundingClientRect()
          const bRect = b.getBoundingClientRect()
          return aRect.width * aRect.height - bRect.width * bRect.height
        })
        if (matches.length === 0) {
          return { found: false, on: null, clicked: false, ambiguous: false }
        }

        const label = matches[0] as HTMLElement
        let container: HTMLElement | null = label
        let controls: Element[] = []
        for (let depth = 0; container && depth < 5; depth++) {
          // WeChat renders “群发通知” as a slider. Its real checkbox may be
          // visually hidden, so use it for state but click the visible switch shell.
          const inputControls = Array.from(container.querySelectorAll('input[type="checkbox"]'))
          const roleControls = Array.from(container.querySelectorAll('[role="switch"]'))
            .filter(control => visible(control))
          const wechatSwitchControls = Array.from(container.querySelectorAll(
            '.weui-desktop-switch, .weui-desktop-switch__box, [class*="weui-desktop-switch"]',
          ))
            .filter(control => visible(control))
          const buttonControls = Array.from(container.querySelectorAll(
            'button[class*="switch"], label[class*="switch"]',
          ))
            .filter(control => visible(control))
          const classControls = Array.from(container.querySelectorAll('[class*="switch"]'))
            .filter(control => visible(control))
          controls = roleControls.length > 0
            ? roleControls
            : wechatSwitchControls.length > 0
              ? wechatSwitchControls
              : buttonControls.length > 0
                ? buttonControls
                : classControls.length > 0
                  ? classControls
                  : inputControls
          if (controls.length > 0) break
          container = container.parentElement
        }
        if (controls.length === 0) {
          const labelRect = label.getBoundingClientRect()
          const labelCenterY = labelRect.top + labelRect.height / 2
          const dialog = label.closest('[role="dialog"], .weui-desktop-dialog, .weui-desktop-dialog__wrp')
            || document.body
          const nearby = Array.from(dialog.querySelectorAll('button, input, label, div, span, i'))
            .filter(candidate => {
              if (!visible(candidate) || candidate === label || candidate.contains(label)) return false
              const rect = candidate.getBoundingClientRect()
              const centerY = rect.top + rect.height / 2
              return rect.left > labelRect.right
                && Math.abs(centerY - labelCenterY) <= 36
                && rect.width >= 24 && rect.width <= 80
                && rect.height >= 14 && rect.height <= 48
                && normalize(candidate.textContent) === ''
            })
            .map(candidate => {
              const rect = candidate.getBoundingClientRect()
              const style = getComputedStyle(candidate as HTMLElement)
              const score = Math.abs((rect.top + rect.height / 2) - labelCenterY)
                + Math.abs(rect.width - 40)
                + Math.abs(rect.height - 24)
                + (style.cursor === 'pointer' ? 0 : 30)
              return { candidate, score }
            })
            .sort((a, b) => a.score - b.score)
          if (nearby[0]) {
            controls = [nearby[0].candidate]
          }
        }
        let uniqueControls = Array.from(new Set(controls)).filter(control => (
          !controls.some(other => other !== control && other.contains(control))
        ))
        if (uniqueControls.length > 1) {
          const labelRect = label.getBoundingClientRect()
          const labelCenterY = labelRect.top + labelRect.height / 2
          const ranked = uniqueControls
            .map(control => {
              const rect = control.getBoundingClientRect()
              const score = Math.abs((rect.top + rect.height / 2) - labelCenterY)
                + Math.abs(rect.width - 40)
                + Math.abs(rect.height - 24)
              return { control, score }
            })
            .sort((a, b) => a.score - b.score)
          if (ranked[0]) uniqueControls = [ranked[0].control]
        }
        if (uniqueControls.length !== 1) {
          return {
            found: uniqueControls.length > 0,
            on: null,
            clicked: false,
            ambiguous: uniqueControls.length > 1,
          }
        }

        const control = uniqueControls[0] as HTMLInputElement | HTMLElement
        const nestedInput = control instanceof HTMLInputElement
          ? control
          : control.querySelector<HTMLInputElement>('input[type="checkbox"]')
            || container?.querySelector<HTMLInputElement>('input[type="checkbox"]')
            || null
        const wrapper = control instanceof HTMLInputElement && !visible(control)
          ? control.closest<HTMLElement>(
            '[role="switch"], .weui-desktop-switch, .weui-desktop-switch__box, button[class*="switch"], label[class*="switch"], [class*="switch"]',
          )
          : control as HTMLElement
        const clickTarget = wrapper && visible(wrapper) ? wrapper : control
        const stateElement = wrapper || control
        const visualElements = [
          stateElement,
          ...Array.from(stateElement.querySelectorAll('*')).filter(visible),
        ] as HTMLElement[]
        const className = visualElements.map(element => (
          typeof element.className === 'string' ? element.className : ''
        )).join(' ').toLowerCase()
        const ariaChecked = visualElements
          .map(element => element.getAttribute('aria-checked'))
          .find(value => value !== null)
          ?? nestedInput?.getAttribute('aria-checked')
          ?? null
        const inputChecked = nestedInput ? nestedInput.checked : null
        const greenBackground = visualElements.some(element => {
          const backgrounds = [
            getComputedStyle(element).backgroundColor,
            getComputedStyle(element, '::before').backgroundColor,
            getComputedStyle(element, '::after').backgroundColor,
          ]
          return backgrounds.some(background => {
            const rgb = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
            return Boolean(rgb
              && Number(rgb[2]) > Number(rgb[1]) * 1.2
              && Number(rgb[2]) > Number(rgb[3]) * 1.2)
          })
        })
        const visualOn = /checked|selected|active|\bon\b/.test(className) || greenBackground
        const on = ariaChecked !== null
          ? ariaChecked === 'true'
          : visualOn
            ? true
            : inputChecked
        const shouldToggle = on === true && shouldClick
        if (shouldToggle) (clickTarget as HTMLElement).click()
        return { found: true, on, clicked: shouldToggle, ambiguous: false }
      },
      [labels, clickIfOn],
    )
  }

  private classify(record: DraftRecord, page: PageState): DraftPublishResult {
    const publicUrl = this.config.publicUrlPatterns.some(pattern => pattern.test(page.url))
    if (publicUrl) {
      const postId = this.extractPostId(page.url) || record.draftId
      return {
        ...this.result(record, 'published', postId, page.url, null),
        success: true,
        publishedAt: Date.now(),
      }
    }

    const body = page.bodyText.replace(/\s+/g, '')
    if (this.config.awaitingUserActionTexts?.some(text => body.includes(text.replace(/\s+/g, '')))) {
      return this.result(record, 'reviewing', record.draftId, null,
        this.config.awaitingUserActionMessage
          || `${record.platformName}正在等待用户完成平台验证`)
    }
    if (this.config.reviewingTexts.some(text => body.includes(text.replace(/\s+/g, '')))) {
      const result = this.result(
        record,
        'reviewing',
        record.draftId,
        null,
        this.config.reviewingIsSuccess
          ? null
          : `${record.platformName}已提交，正在审核或等待平台处理`,
      )
      return this.config.reviewingIsSuccess ? { ...result, success: true } : result
    }
    if (this.config.successTexts.some(text => body.includes(text.replace(/\s+/g, '')))) {
      return this.result(record, 'unverified', record.draftId, null,
        `${record.platformName}页面提示提交成功，但尚未获得可验证的公开地址`)
    }
    return this.result(record, 'unverified', record.draftId, null,
      `${record.platformName}发布结果尚未确认`)
  }

  private extractPostId(url: string): string | null {
    for (const pattern of this.config.postIdPatterns) {
      const match = url.match(pattern)
      if (match?.[1]) return match[1]
    }
    return null
  }

  private result(
    record: DraftRecord,
    status: DraftPublishResult['status'],
    postId: string | null,
    postUrl: string | null,
    error: string | null,
  ): DraftPublishResult {
    return {
      platform: record.platform,
      platformName: record.platformName,
      success: false,
      status,
      postId,
      postUrl,
      publishedAt: null,
      error,
    }
  }

  private pause(ms: number): Promise<void> {
    return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve()
  }
}

export const BROWSER_PUBLISHER_CONFIGS: BrowserPublisherConfig[] = [
  {
    platform: 'weixin',
    titleSelectors: ['#title', 'textarea[name="title"]', 'input[name="title"]', 'textarea[placeholder*="标题"]'],
    contentSelectors: ['.ProseMirror', '#ueditor_0', '.edui-editor-body', '[contenteditable="true"]'],
    publishSelectors: ['button.mass_send', '#js_submit', '#js_send button', '#js_send', '.js_submit'],
    publishLabels: ['发表', '发布'],
    preConfirmDisableToggleLabels: ['群发通知'],
    preConfirmToggleLookupAttempts: 5,
    confirmLabels: ['继续发表', '发表', '确定发表', '确认发表', '确认发布', '确定'],
    confirmLookupAttempts: 5,
    confirmSteps: 2,
    confirmStepSelectors: [
      [
        '.weui-desktop-dialog__wrp .weui-desktop-dialog__ft .weui-desktop-popover__wrp > button',
      ],
      [
        '.weui-desktop-dialog__wrp .weui-desktop-dialog__ft > div > button.weui-desktop-btn.weui-desktop-btn_primary',
        '.weui-desktop-dialog__wrp .weui-desktop-dialog__ft button.weui-desktop-btn_primary',
      ],
    ],
    reviewStatusTabQueries: ['https://mp.weixin.qq.com/cgi-bin/appmsgpublish*'],
    reviewStatusUrlBuilder: record => {
      try {
        if (!record.draftUrl) return null
        const draftUrl = new URL(record.draftUrl)
        const token = draftUrl.searchParams.get('token')
        if (!token) return null
        return `https://mp.weixin.qq.com/cgi-bin/appmsgpublish?sub=list&begin=0&count=10&token=${encodeURIComponent(token)}&lang=zh_CN`
      } catch {
        return null
      }
    },
    reviewStatusRequiresDraftMatch: true,
    publicTabQueries: ['https://mp.weixin.qq.com/s/*'],
    publicUrlPatterns: [/^https:\/\/mp\.weixin\.qq\.com\/s(?:\/|\?)/],
    postIdPatterns: [/[?&]mid=(\d+)/, /\/s\/([^/?#]+)/],
    reviewingTexts: ['审核中', '已提交审核', '发表成功', '发布成功', '已发表'],
    reviewingIsSuccess: true,
    successTexts: ['发表成功', '发布成功', '已发表'],
  },
  {
    platform: 'sohu',
    titleSelectors: ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]', '.article-title input'],
    contentSelectors: ['.ProseMirror', '.ql-editor', '[contenteditable="true"]'],
    publishSelectors: ['button[type="submit"]', '.publish-btn'],
    publishLabels: ['发布文章', '发布'],
    confirmLabels: ['确认发布', '确定发布', '确定'],
    publicTabQueries: ['https://www.sohu.com/a/*', 'https://m.sohu.com/a/*'],
    publicUrlPatterns: [/^https:\/\/www\.sohu\.com\/a\//, /^https:\/\/m\.sohu\.com\/a\//],
    postIdPatterns: [/\/a\/(\d+)/],
    reviewingTexts: ['审核中', '等待审核', '已提交审核'],
    successTexts: ['发布成功', '提交成功'],
  },
  {
    platform: 'baijiahao',
    titleSelectors: ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]', '.input-title'],
    contentSelectors: ['.ProseMirror', '.ql-editor', '.editor-content', '[contenteditable="true"]'],
    publishSelectors: ['button[type="submit"]', '.publish-btn'],
    publishLabels: ['发布文章', '发布'],
    confirmLabels: ['确认发布', '确定发布', '确定'],
    confirmOptionalAfterNavigation: true,
    publishLookupAttempts: 8,
    postPublishTransitionAttempts: 8,
    reviewStatusTabQueries: ['https://baijiahao.baidu.com/builder/rc/clue*'],
    publicTabQueries: ['https://baijiahao.baidu.com/s*'],
    publicUrlPatterns: [/^https:\/\/baijiahao\.baidu\.com\/s(?:\?|\/)/],
    postIdPatterns: [/[?&]id=(\d+)/],
    reviewingTexts: ['审核中', '等待审核', '已提交审核'],
    reviewingIsSuccess: true,
    successTexts: ['发布成功', '提交成功'],
  },
  {
    platform: 'bilibili',
    draftUrlBuilder: draftId => `https://member.bilibili.com/york/read-editor?aid=${encodeURIComponent(draftId)}`,
    titleSelectors: ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]', '.article-title input'],
    contentSelectors: ['.ProseMirror', '.ql-editor', '.article-editor', '[contenteditable="true"]'],
    publishSelectors: ['button[type="submit"]', '.submit-btn', '.publish-btn'],
    publishLabels: ['提交文章', '确认投稿', '投稿', '发布'],
    confirmLabels: ['确认投稿', '确认提交', '确定'],
    confirmOptionalAfterNavigation: true,
    publishLookupAttempts: 8,
    postPublishTransitionAttempts: 8,
    publicTabQueries: ['https://www.bilibili.com/read/cv*', 'https://www.bilibili.com/opus/*'],
    publicUrlPatterns: [/^https:\/\/www\.bilibili\.com\/read\/cv\d+/, /^https:\/\/www\.bilibili\.com\/opus\/\d+/],
    postIdPatterns: [/\/read\/cv(\d+)/, /\/opus\/(\d+)/],
    reviewingTexts: ['审核中', '等待审核', '投稿审核', '你的专栏已提交成功'],
    reviewingIsSuccess: true,
    awaitingUserActionTexts: ['请完成验证', '请输入图片中的内容'],
    awaitingUserActionMessage: '哔哩哔哩已打开图片验证码，请用户完成验证后确认',
    successTexts: ['投稿成功', '提交成功', '发布成功'],
  },
  {
    platform: 'toutiao',
    titleSelectors: ['textarea[placeholder*="标题"]', 'input[placeholder*="标题"]', '.article-title textarea'],
    contentSelectors: ['.ProseMirror', '.ql-editor', '.editor-content', '[contenteditable="true"]'],
    publishSelectors: ['button[type="submit"]', '.publish-btn'],
    publishLabels: ['预览并发布', '发布文章', '发布'],
    confirmLabels: ['确认发布', '确定发布', '确定'],
    confirmLookupAttempts: 8,
    confirmSteps: 3,
    publishTransitionRetries: 2,
    reviewStatusTabQueries: ['https://mp.toutiao.com/profile_v4/graphic/articles*'],
    reviewStatusRequiresDraftMatch: true,
    publicTabQueries: [
      'https://www.toutiao.com/article/*',
      'https://www.toutiao.com/item/*',
      'https://www.toutiao.com/i*',
    ],
    publicUrlPatterns: [
      /^https:\/\/www\.toutiao\.com\/article\/\d+/,
      /^https:\/\/www\.toutiao\.com\/item\/\d+/,
      /^https:\/\/www\.toutiao\.com\/i\d+/,
    ],
    postIdPatterns: [/\/article\/(\d+)/, /\/item\/(\d+)/, /\/i(\d+)/],
    reviewingTexts: ['审核中', '等待审核', '已提交审核'],
    reviewingIsSuccess: true,
    successTexts: ['发布成功', '提交成功'],
  },
]
