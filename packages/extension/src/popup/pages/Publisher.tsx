import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Loader2, Send } from 'lucide-react'
import type {
  DraftPublishPreview,
  DraftPublishResult,
  DraftRecord,
  PublishAuditRecord,
} from '@wechatsync/core'
import { Button } from '../components/ui/Button'
import { PUBLISHER_PLATFORMS } from '../../publisher/platforms'

const STATUS_LABELS: Record<DraftRecord['status'], string> = {
  draft_created: '草稿已创建',
  ready_to_publish: '等待发布',
  publishing: '发布处理中',
  published: '发布成功',
  failed: '发布失败',
}

const STALE_PUBLISHING_MS = 10 * 60 * 1000

function getPlatformDisplayName(platformId: string): string {
  return PUBLISHER_PLATFORMS.find(platform => platform.id === platformId)?.name || platformId
}

function isRecoverablePublishing(record: DraftRecord): boolean {
  return record.status === 'publishing'
    && (!record.lastPublishAttemptAt || Date.now() - record.lastPublishAttemptAt >= STALE_PUBLISHING_MS)
}

export function PublisherPage() {
  const navigate = useNavigate()
  const [records, setRecords] = useState<DraftRecord[]>([])
  const [selectedPlatform, setSelectedPlatform] = useState('zhihu')
  const [selectedDraftId, setSelectedDraftId] = useState('')
  const [preview, setPreview] = useState<DraftPublishPreview | null>(null)
  const [result, setResult] = useState<DraftPublishResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [auditRecords, setAuditRecords] = useState<PublishAuditRecord[]>([])

  const platformRecords = useMemo(
    () => records.filter(record => (
      record.platform === selectedPlatform
      && record.status !== 'published'
      && (record.status !== 'publishing' || isRecoverablePublishing(record))
    )),
    [records, selectedPlatform]
  )
  const selectedRecord = platformRecords.find(record => record.draftId === selectedDraftId)
  const platformConfig = PUBLISHER_PLATFORMS.find(item => item.id === selectedPlatform)!

  const loadRecords = async () => {
    const [draftResponse, auditResponse] = await Promise.all([
      chrome.runtime.sendMessage({
        type: 'LIST_DRAFT_RECORDS',
        payload: { platform: selectedPlatform },
      }),
      chrome.runtime.sendMessage({ type: 'LIST_PUBLISH_AUDIT' }),
    ])
    if (draftResponse?.error) throw new Error(draftResponse.error)
    if (auditResponse?.error) throw new Error(auditResponse.error)
    setRecords(draftResponse?.records || [])
    setAuditRecords(auditResponse?.records || [])
  }

  useEffect(() => {
    setSelectedDraftId('')
    setPreview(null)
    setResult(null)
    setError(null)
    setLoading(true)
    loadRecords()
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [selectedPlatform])

  const loadPreview = async () => {
    if (!selectedRecord) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_DRAFT_PREVIEW',
        payload: { platform: selectedRecord.platform, draftId: selectedRecord.draftId },
      })
      if (response?.error) throw new Error(response.error)
      setPreview(response.preview)
      await loadRecords()
    } catch (err) {
      setPreview(null)
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const publish = async () => {
    if (!selectedRecord || !preview) return
    setPublishing(true)
    setError(null)
    setResult(null)
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'PUBLISH_DRAFT',
        payload: {
          platform: selectedRecord.platform,
          draftId: selectedRecord.draftId,
          confirmed: true,
        },
      })
      if (response?.error) throw new Error(response.error)
      setResult(response.result)
      await loadRecords()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="p-4 h-full flex flex-col gap-4 overflow-auto">
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground self-start"
      >
        <ArrowLeft className="w-4 h-4" />
        返回
      </button>

      <div>
        <h1 className="text-base font-semibold">草稿发布器</h1>
        <p className="text-xs text-muted-foreground mt-1">选择具体平台和草稿，预览后手动公开发布。</p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium">平台</label>
        <select
          className="w-full h-9 rounded-md border bg-background px-3 text-sm"
          value={selectedPlatform}
          onChange={event => setSelectedPlatform(event.target.value)}
        >
          {PUBLISHER_PLATFORMS.map(platform => (
            <option key={platform.id} value={platform.id}>{platform.name}</option>
          ))}
        </select>

        <p className={`text-[11px] ${platformConfig.publishEnabled ? 'text-green-700' : 'text-amber-700'}`}>
          {platformConfig.note}
        </p>

        <label className="text-xs font-medium block pt-1">草稿</label>
        <select
          className="w-full h-9 rounded-md border bg-background px-3 text-sm"
          value={selectedDraftId}
          onChange={event => {
            setSelectedDraftId(event.target.value)
            setPreview(null)
            setResult(null)
            setError(null)
          }}
          disabled={loading || platformRecords.length === 0}
        >
          <option value="">请选择草稿</option>
          {platformRecords.map(record => (
            <option key={`${record.platform}:${record.draftId}`} value={record.draftId}>
              {record.draftName} · {STATUS_LABELS[record.status]}
              {isRecoverablePublishing(record) ? '（可恢复）' : ''}
            </option>
          ))}
        </select>

        {selectedRecord?.draftUrl && (
          <a
            href={selectedRecord.draftUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            打开{platformConfig.name}草稿 <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />加载中
        </div>
      )}

      {!loading && platformRecords.length === 0 && !result && (
        <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
          暂无可用的{platformConfig.name}草稿，请先同步文章并创建草稿。
        </div>
      )}

      {!platformConfig.publishEnabled && selectedRecord && !loading && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          该平台目前只完成草稿接入。公开发布按钮会在真实账号完成提交与结果验证后启用。
        </div>
      )}

      {!preview && selectedRecord && !loading && platformConfig.publishEnabled && (
        <Button variant="outline" onClick={loadPreview}>加载发布预览</Button>
      )}

      {preview && (
        <div className="rounded-lg border bg-card p-3 space-y-2">
          <div className="text-xs text-muted-foreground">发布前确认</div>
          <h2 className="text-sm font-semibold">{preview.draftName}</h2>
          <div className="text-xs">平台：{preview.platformName}</div>
          <p className="text-xs leading-relaxed text-muted-foreground max-h-24 overflow-auto">
            {preview.summary || '暂无正文摘要'}
          </p>
          {preview.draftUrl && (
            <a href={preview.draftUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
              {preview.draftUrl}
            </a>
          )}
          <Button
            variant="destructive"
            className="w-full"
            disabled={publishing || result?.success || Boolean(result && result.status !== 'failed')}
            onClick={publish}
          >
            {publishing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            {publishing
              ? '正在发布…'
              : result?.success
                ? result.status === 'reviewing' ? '已提交审核' : '已公开发布'
                : result
                  ? result.status === 'failed' ? '再次手动尝试' : '暂不可重试'
                  : '确认并公开发布'}
          </Button>
          {result?.status === 'failed' && (
            <p className="text-[11px] text-muted-foreground text-center">
              失败后不会自动重试，只有再次点击才会重新发布。
            </p>
          )}
        </div>
      )}

      {result && (
        <div className={`rounded-lg border p-3 text-sm ${result.success ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
          <p className="font-medium">
            {result.success
              ? result.status === 'reviewing' ? '发布成功（审核中）' : '发布成功'
              : '未确认发布成功'}
          </p>
          {result.error && <p className="text-xs mt-1">{result.error}</p>}
          {result.postId && <p className="text-xs mt-1">文章 ID：{result.postId}</p>}
          {result.publishedAt && <p className="text-xs mt-1">发布时间：{new Date(result.publishedAt).toLocaleString()}</p>}
          {result.postUrl && (
            <a href={result.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1">
              查看公开文章 <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">{error}</div>}

      {auditRecords.length > 0 && (
        <div className="border-t pt-3 space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground">最近发布记录</h2>
          {auditRecords.slice(0, 5).map(audit => (
            <div key={audit.id} className="text-[11px] flex justify-between gap-2">
              <span className="truncate">
                {getPlatformDisplayName(audit.platform)} · {audit.draftName} · {audit.event}
              </span>
              <span className="text-muted-foreground whitespace-nowrap">
                {new Date(audit.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
