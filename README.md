# 文章同步助手2.0.9 自动发布集成版

基于 Chrome 登录态运行的多平台内容分发工具。除了将 Markdown、HTML 或网页文章同步为
平台草稿，本版本还增加了独立发布器，可在扩展界面或通过 MCP 完成“创建草稿 → 确认发布
→ 状态核验”的完整流程。

> [!IMPORTANT]
> 本仓库是基于 [wechatsync/Wechatsync](https://github.com/wechatsync/Wechatsync)
> 修改的独立版本，基线提交为
> [`a98e428`](https://github.com/wechatsync/Wechatsync/commit/a98e42865387285afcc027c61836488748f3b30f)。
> `axbgs123` 于 2026-09-01 对项目进行了修改，增加了独立草稿发布、自动发布集成、
> 发布状态核验与相关界面调整。本修改版由 `axbgs123` 独立维护，不代表原项目作者
> 对本版本提供认可、维护或担保。
>
> 原项目及本修改版均依据 [GNU General Public License v3.0](LICENSE) 发布。
> 使用、修改和再分发时须继续遵守 GPL-3.0，并保留原作者及许可证声明。

![License](https://img.shields.io/github/license/axbgs123/Wechatsync-auto-publish)
![Last commit](https://img.shields.io/github/last-commit/axbgs123/Wechatsync-auto-publish/v2)

## 本版本提供什么

- **多平台草稿同步**：一次提交到多个内容平台，默认先保存为草稿。
- **独立自动发布器**：草稿创建后可单独预览、确认并公开发布，不改变草稿优先原则。
- **MCP 自动发布**：Claude Desktop、Claude Code 等 MCP 客户端可创建草稿、查询草稿，并在显式确认后执行发布。
- **发布状态核验**：区分已发布、审核中、结果未确认、失败和已阻止重复发布等状态。
- **发布幂等与恢复**：阻止同一草稿重复发布，并支持中断后的状态核验与恢复。
- **浏览器登录态**：直接使用用户已经登录的平台会话，不要求在项目中保存平台密码或 Cookie。
- **网页与本地文章输入**：支持网页正文提取、Markdown、HTML、本地图片和封面处理。
- **CMS 支持**：支持 WordPress 与 MetaWeblog 协议账号。

## 工作原理

**文章同步助手不提供平台账号托管，也不要求把 Cookie、Token 或密码交给第三方服务器。**

它是一个 Chrome 浏览器扩展，工作方式与浏览器本身一致：

1. **使用你自己的登录态**：你在浏览器里正常登录各平台账号，扩展直接使用浏览器中已有的 Cookie，无需额外授权，无需输入密码
2. **调用平台网页端接口**：扩展通过平台编辑器使用的接口创建草稿或提交发布
3. **数据不离开你的设备**：所有请求直接从你的浏览器发往各平台，没有中间服务器，没有数据上传，源代码完全开源可审计
4. **草稿与发布分离**：`syncArticle` 只创建草稿；公开发布由独立发布器或 MCP `publish_draft` 显式触发

```
你的浏览器（已登录各平台）
    ↓  扩展读取 Cookie
    ↓  调用平台官方 Web API
平台草稿 → 用户确认 → 独立发布器 → 公开文章或平台审核
```

## 安装方式

本集成版当前建议从源码构建安装：

```bash
git clone https://github.com/axbgs123/Wechatsync-auto-publish.git
cd Wechatsync-auto-publish
git checkout v2
pnpm install
pnpm build:extension
```

然后在 Chrome 的“管理扩展程序”中开启开发者模式，加载 `packages/extension/dist`。

> 原版 Chrome 商店版本不包含本仓库新增的独立自动发布能力。

## 当前支持的平台

公开源码当前注册 20 个内置适配器，并支持 WordPress、Typecho 等 CMS 账号：

| 平台 | ID | 草稿同步/导出 | 独立自动发布 |
|---|---|---:|---:|
| 微信公众号 | `weixin` | ✅ | ✅ 已接入 |
| 知乎 | `zhihu` | ✅ | ✅ 已验证 |
| 今日头条 | `toutiao` | ✅ | ✅ 已接入 |
| 百家号 | `baijiahao` | ✅ | ✅ 已接入 |
| B站专栏 | `bilibili` | ✅ | ✅ 已接入 |
| 搜狐号 | `sohu` | ✅ | ✅ 已接入 |
| 掘金 | `juejin` | ✅ | — |
| CSDN | `csdn` | ✅ | — |
| 微博 | `weibo` | ✅ | — |
| 语雀 | `yuque` | ✅ | — |
| 豆瓣 | `douban` | ✅ | — |
| 雪球 | `xueqiu` | ✅ | — |
| 东方财富 | `eastmoney` | ✅ | — |
| 人人都是产品经理 | `woshipm` | ✅ | — |
| 51CTO | `51cto` | ✅ | — |
| 慕课网 | `imooc` | ✅ | — |
| 开源中国 | `oschina` | ✅ | — |
| SegmentFault | `segmentfault` | ✅ | — |
| 博客园 | `cnblogs` | ✅ | — |
| Markdown ZIP 导出 | `zip-download` | ✅ | 不适用 |

CMS 还支持 WordPress API 与 MetaWeblog 协议，可用于 WordPress、Typecho 等自建站点。

> “已接入”表示代码已实现浏览器发布流程；平台接口、账号权限和审核策略可能变化，
> 首次使用请先用测试文章验证。公开发布始终需要显式确认。

## CLI 命令行工具

最简单的使用方式，无需配置 MCP，安装即用：

```bash
npm install -g @wechatsync/cli
```

需要先安装 Chrome 扩展并在扩展设置中启用「MCP 连接」获取 Token，然后：

```bash
export WECHATSYNC_TOKEN="你的token"

# 同步文章到多个平台
wechatsync sync article.md -p zhihu,juejin,csdn

# 查看平台登录状态
wechatsync platforms --auth

# 从浏览器当前页面提取文章
wechatsync extract -o article.md
```

### Claude Code Skill 集成

安装后可在 Claude Code 中直接用自然语言操作：

```bash
/plugin marketplace add wechatsync
/plugin install wechatsync
```

然后直接说"把这篇文章同步到掘金和知乎"即可。

### OpenClaw 集成

通过 [ClawHub](https://clawhub.ai/lljxx1/wechatsync) 技能市场一键安装：

```bash
clawhub install lljxx1/wechatsync
```

详细文档见 [packages/cli/README.md](packages/cli/README.md)

## MCP 自动发布

通过 MCP，Claude Desktop、Claude Code 等客户端不仅能同步文章草稿，还能继续查询草稿并调用
独立发布器完成公开发布。MCP 使用本机 Chrome 的登录态，文章和账号会话不需要交给远端服务。

标准流程：

1. 调用 `sync_article`，向一个或多个平台创建草稿。
2. 调用 `list_drafts`，读取草稿 ID、平台和当前状态。
3. 用户检查草稿并明确同意发布。
4. 调用 `publish_draft`，同时传入 `confirmed: true`。
5. 根据返回值区分 `published`、`reviewing`、`unverified`、`failed` 或 `blocked`。

其中 `sync_article` 不会直接公开文章；只有 `publish_draft` 会执行公开发布动作。

### 配置步骤

1. 构建项目: `pnpm build`
2. 在 Chrome 扩展设置中启用「MCP 连接」，并设置 Token
3. 在 `~/.claude/claude_desktop_config.json` 中添加配置：

```json
{
  "mcpServers": {
    "sync-assistant": {
      "command": "node",
      "args": ["/path/to/Wechatsync-auto-publish/packages/mcp-server/dist/index.js"],
      "env": {
        "MCP_TOKEN": "your-secret-token-here"
      }
    }
  }
}
```

**重要**: `MCP_TOKEN` 必须与 Chrome 扩展中设置的 Token 一致。

### 自然语言使用示例

```
"把这篇文章同步到知乎和今日头条，先保存草稿"
"列出刚才创建的草稿"
"我已经确认草稿内容，发布知乎草稿 draft-id"
"检查下哪些平台已登录"
```

直接调用发布工具时的核心参数为：

```json
{
  "platform": "zhihu",
  "draftId": "sync_article 返回的草稿 ID",
  "confirmed": true
}
```

### 可用工具

| 工具 | 说明 |
|-----|------|
| `list_platforms` | 列出所有平台及登录状态 |
| `check_auth` | 检查指定平台登录状态 |
| `sync_article` | 同步文章到指定平台（草稿） |
| `list_drafts` | 查询草稿记录与发布状态 |
| `publish_draft` | 在显式确认后自动公开发布草稿 |
| `extract_article` | 从当前浏览器页面提取文章 |
| `upload_image_file` | 上传本地图片到平台 |

详细文档见 [packages/mcp-server/README.md](packages/mcp-server/README.md)

## 网页发起同步

如果你是文章编辑器开发者，或有内容库需要同步多个渠道，可以使用 JS SDK：

- [article-syncjs](https://github.com/wechatsync/article-syncjs) - 网页端 SDK
- [API 文档](API.md)

```javascript
// 拉起同步任务框
window.syncPost(article)
```

## 开发

### 项目结构

```
Wechatsync/
├── packages/
│   ├── extension/     # Chrome 扩展 (MV3)
│   ├── mcp-server/    # MCP Server (stdio/SSE)
│   ├── cli/           # 命令行工具
│   └── core/          # 核心逻辑 (共享)
```

### 本地开发

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build
```

然后在 Chrome 中加载 `packages/extension/dist` 目录。

## 更新日志

### 自动发布集成版（2026-09-01）

- 增加独立草稿发布器与发布确认界面
- 增加 MCP `list_drafts`、`publish_draft` 自动发布工具
- 增加发布幂等、审核中状态识别、中断恢复与审计记录
- 接入知乎、微信公众号、搜狐号、百家号、B站专栏、今日头条自动发布流程
- 微信公众号自动关闭群发通知并适配封面比例
- 发布失败时保留平台草稿，便于检查和重试

### 上游 v2.0.9（2026-03-24）

- 🆕 文章识别和提取更准确，支持更多网页
- 🆕 CLI/MCP 同步 HTML 文件时自动保留排版样式
- 🆕 同步对话框增加使用提示
- 🔧 修复部分网页悬浮按钮显示异常

### v2.0.8 (2026-03-17)

- 🆕 新增抖音图文
- 🆕 统一同步对话框和悬浮按钮
- 🔧 修复 CLI 同步格式异常
- 🔧 改善 CLI/MCP 桥接重连稳定性

### v2.0.7 (2026-03-10)

- 🆕 新增什么值得买、网易号平台
- 🆕 简书支持 Markdown 格式发布
- 🔧 重新适配简书、一点号、搜狐号

### v2.0.6 (2026-02-25)

- 🆕 新增东方财富
- 🆕 新增悬浮同步按钮

### v2.0.5 (2025-02-05)

- 🔧 代码块提取兼容性提升
- 🆕 新增 Markdown 压缩包下载

以上 v2.0.5–v2.0.9 记录来自上游项目，完整日志见[上游更新日志](https://www.wechatsync.com/changelog)。

## 贡献代码

欢迎参与项目开发！

- [待支持的平台列表](https://airtable.com/shrLSJMnTC2BlmP29)
- [如何开发一个适配器](docs/adapter-spec.md)
- [API 文档](API.md)

## 使用场景

- **自媒体运营者**: 公众号文章一键同步到知乎、头条、百家号等多平台，提升内容分发效率
- **技术博主**: 技术博客同步到掘金、CSDN、SegmentFault、开源中国等技术社区
- **内容创作者**: 告别重复复制粘贴，一次编写多处发布，多平台发文不再繁琐
- **AI 写作用户**: 配合 Claude / GPT 等 AI 写作工具，AIGC 内容一键发布到多平台
- **独立博主**: WordPress、Typecho 博客文章同步到各大自媒体平台引流

## 常见问题

**Q: 这是什么工具？**

文章同步助手2.0.9 自动发布集成版是一款开源 Chrome 扩展，可将文章批量保存到多个平台草稿，并通过独立发布器或 MCP 在用户确认后继续公开发布。

**Q: 支持同步微信公众号文章吗？**

支持。可以从微信公众号文章或编辑器提取内容，再同步到当前公开源码注册的 20 个内置平台适配器。具体平台和自动发布状态以本文“当前支持的平台”表格为准。

**Q: 支持 AI 写作工具吗？**

支持。MCP 客户端可以调用 `sync_article` 创建草稿、使用 `list_drafts` 查询草稿，并在用户明确确认后调用 `publish_draft` 自动公开发布。

**Q: 数据安全吗？会上传我的账号信息吗？**

平台登录态由本机 Chrome 管理，项目不会要求把 Cookie 或平台密码写入源码。MCP Token 用于本地桥接鉴权，应由用户自行配置并妥善保存。代码可在[本仓库](https://github.com/axbgs123/Wechatsync-auto-publish)审计。

**Q: 和微小宝、新媒体管家、简媒、蚁小二有什么区别？**

文章同步助手是**开源免费**的，代码完全公开透明，无需付费订阅。作为浏览器扩展运行，数据本地存储，账号信息不上传，支持 MCP 协议可与 AI 工具集成。

**Q: 如何同步文章到多个平台？**

1. 安装 Chrome 浏览器扩展
2. 登录各平台账号（知乎、掘金、头条等）
3. 打开要同步的文章页面
4. 点击扩展图标，选择目标平台，一键同步

## 作者与维护者

- 原项目作者：**fun** · [GitHub](https://github.com/lljxx1) · [主页](https://fun0.netlify.app/about/)
- 自动发布集成版维护者：[**axbgs123**](https://github.com/axbgs123)

## License

GPL-3.0
