/**
 * MCP Server - HTTP/SSE 模式
 *
 * Claude Code 通过 HTTP 连接: http://localhost:9528/sse
 * Chrome Extension 通过 WebSocket 连接: ws://localhost:9527
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import express, { type Request, type Response } from 'express'
import { ExtensionBridge } from './ws-bridge.js'
import type {
  DraftPublishResult,
  DraftRecord,
  DraftRecordStatus,
  PlatformInfo,
  SyncArticleResponse,
} from './types.js'

export class SyncAssistantMcpServer {
  private server: Server
  private bridge: ExtensionBridge
  private app: express.Application
  private httpPort: number
  private transport: SSEServerTransport | null = null

  constructor(wsPort: number = 9527, httpPort: number = 9528) {
    this.httpPort = httpPort
    this.bridge = new ExtensionBridge(wsPort)
    this.app = express()

    this.server = new Server(
      {
        name: 'sync-assistant',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    )

    this.setupHandlers()
    this.setupHttpRoutes()
  }

  /**
   * 设置 HTTP 路由
   */
  private setupHttpRoutes(): void {
    // SSE 端点 - Claude Code 连接这里
    this.app.get('/sse', async (req: Request, res: Response) => {
      console.error('[MCP] New SSE connection from Claude Code')

      this.transport = new SSEServerTransport('/message', res)

      res.on('close', () => {
        console.error('[MCP] SSE connection closed')
        this.transport = null
      })

      await this.server.connect(this.transport)
    })

    // 消息端点 - 接收 Claude Code 的请求
    this.app.post('/message', express.json(), async (req: Request, res: Response) => {
      if (this.transport) {
        await this.transport.handlePostMessage(req, res)
      } else {
        res.status(400).json({ error: 'No active SSE connection' })
      }
    })

    // 健康检查
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        extensionConnected: this.bridge.isConnected(),
      })
    })

    // 状态信息
    this.app.get('/', (_req: Request, res: Response) => {
      res.json({
        name: 'Sync Assistant MCP Server',
        version: '1.0.0',
        endpoints: {
          sse: '/sse',
          health: '/health',
        },
        extensionConnected: this.bridge.isConnected(),
      })
    })
  }

  /**
   * 设置 MCP handlers
   */
  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'list_platforms',
            description: '列出所有支持的平台及其登录状态',
            inputSchema: {
              type: 'object',
              properties: {
                forceRefresh: {
                  type: 'boolean',
                  description: '是否强制刷新登录状态（默认使用缓存）',
                },
              },
            },
          },
          {
            name: 'check_auth',
            description: '检查指定平台的登录状态',
            inputSchema: {
              type: 'object',
              properties: {
                platform: {
                  type: 'string',
                  description: '平台 ID，如 zhihu, juejin, toutiao 等',
                },
              },
              required: ['platform'],
            },
          },
          {
            name: 'sync_article',
            description: '同步文章到指定平台（保存为草稿）',
            inputSchema: {
              type: 'object',
              properties: {
                platforms: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '目标平台 ID 列表，如 ["zhihu", "juejin"]',
                },
                title: {
                  type: 'string',
                  description: '文章标题',
                },
                content: {
                  type: 'string',
                  description: '文章内容（HTML 格式）',
                },
                markdown: {
                  type: 'string',
                  description: '文章内容（Markdown 格式，可选）',
                },
                cover: {
                  type: 'string',
                  description: '封面图 URL（可选）',
                },
              },
              required: ['platforms', 'title', 'content'],
            },
          },
          {
            name: 'list_drafts',
            description: '查询已创建的草稿记录。只读取草稿队列，不执行公开发布。',
            inputSchema: {
              type: 'object',
              properties: {
                platform: {
                  type: 'string',
                  description: '按平台 ID 过滤（可选）',
                },
                status: {
                  type: 'string',
                  enum: ['draft_created', 'ready_to_publish', 'publishing', 'published', 'failed'],
                  description: '按草稿状态过滤（可选）',
                },
              },
            },
          },
          {
            name: 'publish_draft',
            description: '通过 Chrome 登录态自动公开发布一个已登记草稿。调用会直接执行平台发布动作；success 表示平台已接受发布操作，status 用于区分已公开与审核中。',
            inputSchema: {
              type: 'object',
              properties: {
                platform: { type: 'string', description: '草稿所属平台 ID' },
                draftId: { type: 'string', description: '草稿 ID' },
                confirmed: {
                  type: 'boolean',
                  const: true,
                  description: '必须显式传 true，表示确认执行公开发布',
                },
                retryUnverified: {
                  type: 'boolean',
                  description: '上一次浏览器发布未出现二维码或无可验证结果时，由用户明确确认后重试',
                },
              },
              required: ['platform', 'draftId', 'confirmed'],
            },
          },
          {
            name: 'extract_article',
            description: '从当前浏览器页面提取文章内容',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      }
    })

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      try {
        // 检查 Extension 是否连接
        if (!this.bridge.isConnected()) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Chrome Extension 未连接。请确保：\n1. 已安装同步助手扩展\n2. 扩展已启用 MCP 连接（点击设置图标开启）',
                }),
              },
            ],
            isError: true,
          }
        }

        let result: unknown

        switch (name) {
          case 'list_platforms':
            result = await this.bridge.request<PlatformInfo[]>('listPlatforms', {
              forceRefresh: (args as { forceRefresh?: boolean })?.forceRefresh,
            })
            break

          case 'check_auth':
            result = await this.bridge.request<PlatformInfo>('checkAuth', {
              platform: (args as { platform: string }).platform,
            })
            break

          case 'sync_article':
            result = await this.bridge.request<SyncArticleResponse>('syncArticle', {
              platforms: (args as { platforms: string[] }).platforms,
              article: {
                title: (args as { title: string }).title,
                content: (args as { content: string }).content,
                markdown: (args as { markdown?: string }).markdown,
                cover: (args as { cover?: string }).cover,
              },
            })
            break

          case 'list_drafts':
            result = await this.bridge.request<DraftRecord[]>('listDrafts', {
              platform: (args as { platform?: string })?.platform,
              status: (args as { status?: DraftRecordStatus })?.status,
            })
            break

          case 'publish_draft': {
            const publishArgs = args as {
              platform?: string
              draftId?: string
              confirmed?: boolean
              retryUnverified?: boolean
            }
            if (!publishArgs?.platform) throw new Error('platform is required')
            if (!publishArgs?.draftId) throw new Error('draftId is required')
            if (publishArgs.confirmed !== true) {
              throw new Error('公开发布必须显式设置 confirmed=true')
            }
            result = await this.bridge.request<DraftPublishResult>('publishDraft', {
              platform: publishArgs.platform,
              draftId: publishArgs.draftId,
              confirmed: true,
              retryUnverified: publishArgs.retryUnverified === true,
            })
            break
          }

          case 'extract_article':
            result = await this.bridge.request('extractArticle')
            break

          default:
            return {
              content: [{ type: 'text', text: `Unknown tool: ${name}` }],
              isError: true,
            }
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: (error as Error).message }),
            },
          ],
          isError: true,
        }
      }
    })
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    // 启动 WebSocket 服务器（Chrome Extension 连接）
    await this.bridge.start()

    // 启动 HTTP 服务器（Claude Code 连接）
    this.app.listen(this.httpPort, () => {
      console.error(`[MCP] Sync Assistant MCP Server started`)
      console.error(`[MCP] HTTP Server: http://localhost:${this.httpPort}`)
      console.error(`[MCP] Claude Code: http://localhost:${this.httpPort}/sse`)
      console.error(`[MCP] Extension WS: ws://localhost:9527`)
    })
  }
}
