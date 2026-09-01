# 文章同步助手2.0.9 自动发布集成版

基于 Chrome 登录态运行的多平台文章分发工具。它可以把 Markdown、HTML 或浏览器中的文章
同步为平台草稿，并通过扩展内置的独立发布器或 MCP，在用户明确确认后继续执行公开发布。

![License](https://img.shields.io/github/license/axbgs123/Wechatsync-auto-publish)
![Last commit](https://img.shields.io/github/last-commit/axbgs123/Wechatsync-auto-publish/v2)

## 与原版的关系

本仓库基于 [wechatsync/Wechatsync](https://github.com/wechatsync/Wechatsync) 修改，基线为
上游提交 [`a98e428`](https://github.com/wechatsync/Wechatsync/commit/a98e42865387285afcc027c61836488748f3b30f)。

`axbgs123` 于 2026-09-01 在原项目基础上增加独立草稿发布、MCP 自动发布、发布状态核验、
失败恢复及相关界面。本仓库由 `axbgs123` 独立维护，不代表原作者对本修改版提供认可、
维护或担保。

本项目继续依据 [GNU General Public License v3.0](LICENSE) 发布。使用、修改或再分发时，
请保留许可证、原作者信息及本修改版声明。

## 主要功能

- 多平台批量创建文章草稿
- 扩展内置独立发布器，草稿与公开发布分离
- MCP 创建草稿、查询草稿和确认后自动发布
- 发布前预览与显式确认
- 防止同一草稿重复发布
- 发布中断后的状态核验和恢复
- 识别已发布、审核中、未确认、失败和阻止发布等状态
- 发布失败时保留平台草稿
- 使用本机 Chrome 已有的平台登录态
- 网页文章提取、Markdown、HTML、本地图片和封面处理
- WordPress 与 MetaWeblog CMS 支持

## 当前支持的平台

公开源码注册了 20 个内置适配器：

| 平台 | ID | 草稿同步/导出 | 独立自动发布 |
|---|---|---:|---:|
| 微信公众号 | `weixin` | ✅ | ✅ 已接入 |
| 知乎 | `zhihu` | ✅ | ✅ 已接入 |
| 今日头条 | `toutiao` | ✅ | ✅ 已接入 |
| 百家号 | `baijiahao` | ✅ | ✅ 已接入 |
| B站专栏 | `bilibili` | ✅ | ✅ 已接入 |
| 搜狐号 | `sohu` | ✅ | ⏳ 待验证 |
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

此外还支持 WordPress API 与 MetaWeblog 协议，可用于 WordPress、Typecho 等自建站点。

“已接入”表示代码已经实现浏览器发布流程；“待验证”表示流程已经接入，但仍需真实平台账号
完成验收。平台接口、账号权限和审核规则可能变化，首次使用请先用测试文章验证。

## 发布流程

```text
网页 / Markdown / HTML
        ↓
选择一个或多个平台
        ↓
创建并登记平台草稿
        ↓
用户检查草稿并确认发布
        ↓
独立发布器提交公开发布
        ↓
已发布 / 审核中 / 未确认 / 失败
```

`syncArticle` 和 MCP `sync_article` 只负责创建草稿，不会直接公开文章。只有用户在扩展发布器
中确认，或通过 MCP 调用 `publish_draft` 并传入 `confirmed: true`，才会执行公开发布。

## 从源码安装扩展

本自动发布集成版目前从本仓库源码构建，不使用原版 Chrome 商店包或原版 ZIP：

```bash
git clone https://github.com/axbgs123/Wechatsync-auto-publish.git
cd Wechatsync-auto-publish
git checkout v2
pnpm install
pnpm --filter @wechatsync/extension build
```

构建完成后：

1. 打开 Chrome 的“管理扩展程序”。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择 `packages/extension/dist`。
5. 登录需要使用的内容平台。

## 扩展内自动发布

1. 打开文章页面，点击扩展图标。
2. 选择目标平台并同步，平台会先创建草稿。
3. 打开扩展顶部的“发布器”。
4. 选择草稿并检查预览。
5. 明确确认后执行公开发布。
6. 根据结果查看公开链接、审核状态或失败原因。

## MCP 自动发布

### 构建并启用

```bash
pnpm --filter @wechatsync/mcp-server build
```

然后在扩展设置中开启 MCP 连接并配置 Token。MCP 客户端中的 Token 必须与扩展设置一致。

Claude Desktop 或其他兼容客户端可以使用类似配置：

```json
{
  "mcpServers": {
    "sync-assistant": {
      "command": "node",
      "args": [
        "/绝对路径/Wechatsync-auto-publish/packages/mcp-server/dist/index.js"
      ],
      "env": {
        "MCP_TOKEN": "与扩展设置相同的 Token"
      }
    }
  }
}
```

不要把真实 Token 提交到 GitHub。

### MCP 工具

| 工具 | 功能 |
|---|---|
| `list_platforms` | 查询平台和登录状态 |
| `check_auth` | 检查指定平台登录状态 |
| `sync_article` | 把文章同步为一个或多个平台草稿 |
| `list_drafts` | 查询草稿 ID、平台和发布状态 |
| `publish_draft` | 在显式确认后公开发布草稿 |
| `extract_article` | 从当前浏览器页面提取文章 |
| `upload_image_file` | 上传本地图片并返回公开 URL |

### 标准 MCP 流程

1. 调用 `sync_article` 创建草稿。
2. 调用 `list_drafts` 获取平台草稿 ID。
3. 用户检查草稿内容并明确同意公开发布。
4. 调用 `publish_draft`：

```json
{
  "platform": "zhihu",
  "draftId": "草稿 ID",
  "confirmed": true
}
```

5. 根据返回状态处理结果：

| 状态 | 含义 |
|---|---|
| `published` | 已确认公开发布 |
| `reviewing` | 平台已接受，正在审核 |
| `unverified` | 已提交操作，但暂时无法确认公开结果 |
| `failed` | 发布失败，草稿保留 |
| `blocked` | 重复发布或状态不允许，操作被阻止 |

## 本版本的主要改动

- 增加独立草稿发布器与发布确认界面
- 增加 MCP `list_drafts`、`publish_draft` 工具
- 增加草稿登记、内容摘要和发布历史
- 增加发布幂等键和并发发布保护
- 增加审核中状态识别与中断恢复
- 接入知乎、微信公众号、搜狐号、百家号、B站专栏、今日头条发布流程
- 微信公众号自动关闭群发通知并适配封面比例
- 发布失败时保留平台草稿
- 增加相关类型检查与自动化测试

## 已知限制

- 平台网页接口可能变化，需要持续适配。
- 自动发布依赖本机 Chrome 中有效的平台登录态。
- 微信公众号、今日头条等平台可能要求封面或触发平台审核。
- 搜狐号自动发布流程仍处于待验证状态。
- 仓库中的私有适配器子模块不属于本公开修改版，不包含在公开源码能力列表中。
- 本项目不提供跨电脑部署方案。

## 开发与验证

项目结构：

```text
packages/
├── core/          # 类型、平台适配器和内容处理
├── extension/     # Chrome 扩展、草稿登记和独立发布器
├── mcp-server/    # MCP 工具和扩展桥接
└── cli/           # 本地命令行入口
```

常用命令：

```bash
# 类型检查
pnpm --filter @wechatsync/core typecheck
pnpm --filter @wechatsync/extension typecheck

# 测试
cd packages/core && pnpm exec vitest run
cd ../extension && pnpm exec vitest run
```

当前自动化测试覆盖草稿登记、发布幂等、发布恢复、平台结果识别，以及微信公众号、知乎、
今日头条和百家号等关键适配流程。

## 安全说明

- 不要把平台 Cookie、密码、Token 或私钥提交到仓库。
- MCP Token 只用于桥接鉴权，应保存在本地配置中。
- 平台登录态由 Chrome 管理，扩展通过浏览器会话访问平台。
- 公开发布前应检查草稿内容、目标账号和平台状态。

## 作者与维护者

- 原项目作者：**fun** · [GitHub](https://github.com/lljxx1) · [主页](https://fun0.netlify.app/about/)
- 自动发布集成版维护者：[**axbgs123**](https://github.com/axbgs123)

## License

[GNU General Public License v3.0](LICENSE)
