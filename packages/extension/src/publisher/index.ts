import type { DraftPublishPreview, DraftPublishResult, DraftPublisher } from '@wechatsync/core'
import { createExtensionRuntime } from '../runtime/extension'
import {
  listDraftRecords,
  isPublishingAttemptStale,
  markDraftPublishing,
  markDraftPublished,
  updateDraftRecordStatus,
} from '../background/draft-registry'
import { ZhihuDraftPublisher } from './zhihu'
import { BROWSER_PUBLISHER_CONFIGS, BrowserPlatformDraftPublisher } from './browser-platform'
import { getPublisherPlatformConfig } from './platforms'
import {
  appendPublishAudit,
  createPublishIdempotencyKey,
} from './audit'

const publisherRuntime = createExtensionRuntime()
const publishers = new Map<string, DraftPublisher>([
  ['zhihu', new ZhihuDraftPublisher(publisherRuntime)],
  ...BROWSER_PUBLISHER_CONFIGS.map(config => (
    [config.platform, new BrowserPlatformDraftPublisher(publisherRuntime, config)] as const
  )),
])
const activePublishKeys = new Set<string>()

function isPublishRateLimited(error: string | null): boolean {
  return Boolean(error && /频率过高|24\s*小时后重试|当日.*上限|投稿上限|too many requests|rate limit/i.test(error))
}

async function getRecord(platform: string, draftId: string) {
  const records = await listDraftRecords({ platform })
  const record = records.find(item => item.draftId === draftId)
  if (!record) throw new Error('草稿记录不存在')
  return record
}

function getPublisher(platform: string): DraftPublisher {
  const config = getPublisherPlatformConfig(platform)
  if (config && !config.publishEnabled) {
    throw new Error(`${config.name}：${config.note}`)
  }
  const publisher = publishers.get(platform)
  if (!publisher) throw new Error(`平台 ${platform} 暂不支持公开发布`)
  return publisher
}

export async function getDraftPublishPreview(
  platform: string,
  draftId: string
): Promise<DraftPublishPreview> {
  const record = await getRecord(platform, draftId)
  const preview = await getPublisher(platform).getPreview(record)
  await updateDraftRecordStatus(platform, draftId, 'ready_to_publish')
  await appendPublishAudit({
    record,
    idempotencyKey: createPublishIdempotencyKey(record),
    event: 'previewed',
  })
  return preview
}

export async function publishDraftByUserAction(
  platform: string,
  draftId: string,
  confirmed: boolean,
  retryUnverified = false,
): Promise<DraftPublishResult> {
  if (!confirmed) throw new Error('公开发布必须由用户明确确认')

  let record = await getRecord(platform, draftId)
  const publisher = getPublisher(platform)
  const idempotencyKey = createPublishIdempotencyKey(record)
  const alreadyPublished = record.status === 'published'
  let publishPending = record.status === 'publishing'
  const recoverFailedSubmission = retryUnverified && record.status === 'failed'

  if ((publishPending && (isPublishingAttemptStale(record) || retryUnverified))
    || recoverFailedSubmission) {
    await appendPublishAudit({
      record,
      idempotencyKey,
      event: 'publish_recovered',
      resultStatus: 'unverified',
      error: recoverFailedSubmission
        ? '用户确认平台已提交成功，先核验平台状态并恢复本地记录'
        : retryUnverified
        ? '用户已明确确认上一次未出现二维码，先核验平台状态后重试'
        : '上一次发布流程已中断或长时间未确认，允许本次显式发布重新尝试',
    })
    const recoveredResult = await publisher.verifyPublished?.(record)
    if (recoveredResult?.success && recoveredResult.postId
      && (recoveredResult.status === 'published' || recoveredResult.status === 'reviewing')) {
      await markDraftPublished(platform, draftId, {
        idempotencyKey,
        postId: recoveredResult.postId,
        postUrl: recoveredResult.postUrl,
        publishedAt: recoveredResult.publishedAt || Date.now(),
      })
      await appendPublishAudit({
        record,
        idempotencyKey,
        event: 'publish_succeeded',
        resultStatus: recoveredResult.status,
      })
      return { ...recoveredResult, idempotencyKey }
    }
    if (recoveredResult?.status === 'reviewing') {
      await markDraftPublishing(platform, draftId)
      await appendPublishAudit({
        record,
        idempotencyKey,
        event: 'publish_submitted',
        resultStatus: recoveredResult.status,
        error: recoveredResult.error,
      })
      return { ...recoveredResult, idempotencyKey }
    }
    await updateDraftRecordStatus(platform, draftId, 'failed')
    record = { ...record, status: 'failed' }
    publishPending = false
  }

  if (alreadyPublished || publishPending || activePublishKeys.has(idempotencyKey)) {
    const blockReason = alreadyPublished
      ? '该草稿已经发布'
      : publishPending
        ? '该草稿已提交发布，正在处理或等待验证'
        : '该草稿正在发布中'
    await appendPublishAudit({
      record,
      idempotencyKey,
      event: 'publish_blocked',
      resultStatus: 'blocked',
      error: blockReason,
    })
    return {
      platform: record.platform,
      platformName: record.platformName,
      success: false,
      status: 'blocked',
      postId: record.publishedPostId || null,
      postUrl: record.publishedPostUrl || null,
      publishedAt: record.publishedAt || null,
      error: alreadyPublished ? '该草稿已经发布，已阻止重复发布' : blockReason,
      idempotencyKey,
    }
  }

  activePublishKeys.add(idempotencyKey)
  try {
    await appendPublishAudit({ record, idempotencyKey, event: 'publish_started' })
    await markDraftPublishing(platform, draftId)
    const result = {
      ...await publisher.publish(record),
      idempotencyKey,
    }

    if (result.success && result.postId
      && (result.status === 'published' || result.status === 'reviewing')) {
      await markDraftPublished(platform, draftId, {
        idempotencyKey,
        postId: result.postId,
        postUrl: result.postUrl,
        publishedAt: result.publishedAt || Date.now(),
      })
      await appendPublishAudit({
        record,
        idempotencyKey,
        event: 'publish_succeeded',
        resultStatus: result.status,
      })
    } else {
      const submitted = result.status === 'reviewing' || result.status === 'unverified'
      const rateLimited = result.status === 'failed' && isPublishRateLimited(result.error)
      await updateDraftRecordStatus(
        platform,
        draftId,
        submitted ? 'publishing' : rateLimited ? 'ready_to_publish' : 'failed'
      )
      await appendPublishAudit({
        record,
        idempotencyKey,
        event: submitted ? 'publish_submitted' : 'publish_failed',
        resultStatus: result.status,
        error: result.error,
      })
    }

    return result
  } finally {
    activePublishKeys.delete(idempotencyKey)
  }
}
