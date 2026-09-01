import { describe, expect, it } from 'vitest'
import { isExtractableTabUrl } from '../src/lib/tab-url'
import { parseWindowMessage } from '../src/lib/window-message'

describe('tab extraction guard', () => {
  it('allows normal web pages and rejects Chrome internal pages', () => {
    expect(isExtractableTabUrl('https://example.com/article')).toBe(true)
    expect(isExtractableTabUrl('http://localhost:3000/article')).toBe(true)
    expect(isExtractableTabUrl('chrome://extensions')).toBe(false)
    expect(isExtractableTabUrl('chrome-extension://id/popup.html')).toBe(false)
    expect(isExtractableTabUrl(undefined)).toBe(false)
  })
})

describe('window message parser', () => {
  it('ignores empty, non-JSON and truncated messages', () => {
    expect(parseWindowMessage('')).toBeNull()
    expect(parseWindowMessage('hello')).toBeNull()
    expect(parseWindowMessage('{"type":')).toBeNull()
  })

  it('accepts valid JSON and object messages', () => {
    expect(parseWindowMessage('{"type":"EDITOR_READY"}')).toEqual({ type: 'EDITOR_READY' })
    expect(parseWindowMessage({ type: 'START_SYNC' })).toEqual({ type: 'START_SYNC' })
  })
})
