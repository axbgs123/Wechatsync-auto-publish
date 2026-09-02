import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Github, Globe, Heart, MessageSquare, ExternalLink } from 'lucide-react'

const linkItemClass =
  'flex items-center gap-2.5 px-4 py-2.5 rounded-lg border hover:bg-muted transition-colors text-sm'
const staticItemClass =
  'flex items-center gap-2.5 px-4 py-2.5 rounded-lg border bg-muted/30 text-sm'

export function AboutPage() {
  const navigate = useNavigate()
  const version = chrome.runtime.getManifest().version

  return (
    <div className="flex flex-col h-[500px]">
      <header className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-semibold">关于</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div className="flex flex-col items-center pt-5">
          <img src="/assets/icon-128.png" alt="Logo" className="w-14 h-14 mb-2" />
          <h2 className="text-lg font-semibold">文章同步助手2.0.9 自动发布集成版</h2>
          <p className="text-sm text-muted-foreground mt-1">v{version}</p>
          <p className="text-sm text-muted-foreground text-center mt-3 leading-relaxed">
            一键将文章同步到多个平台
          </p>
        </div>

        <section className="mt-5 w-full max-w-[260px] mx-auto">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">修改者</h3>
          <div className="flex flex-col gap-2">
            <a
              href="https://github.com/axbgs123"
              target="_blank"
              rel="noopener noreferrer"
              className={linkItemClass}
            >
              <Github className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">GitHub</span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </a>
            <div className={staticItemClass}>
              <Heart className="w-4 h-4 flex-shrink-0 text-sky-500" />
              <span className="flex-1">修改者: axbgs123</span>
            </div>
            <div className={staticItemClass}>
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">问题反馈</span>
              <span className="text-xs text-muted-foreground">待实现</span>
            </div>
          </div>
        </section>

        <section className="mt-5 w-full max-w-[260px] mx-auto">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">原作者</h3>
          <div className="flex flex-col gap-2">
            <a
              href="https://github.com/wechatsync/Wechatsync"
              target="_blank"
              rel="noopener noreferrer"
              className={linkItemClass}
            >
              <Github className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">GitHub</span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </a>
            <a
              href="https://www.wechatsync.com/?utm_source=extension_about"
              target="_blank"
              rel="noopener noreferrer"
              className={linkItemClass}
            >
              <Globe className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">官网</span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </a>
            <a
              href="https://fun0.netlify.app/about/?utm_source=wechatsync"
              target="_blank"
              rel="noopener noreferrer"
              className={linkItemClass}
            >
              <Heart className="w-4 h-4 flex-shrink-0 text-red-400" />
              <span className="flex-1">原作者: fun</span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </a>
            <a
              href="https://txc.qq.com/products/105772"
              target="_blank"
              rel="noopener noreferrer"
              className={linkItemClass}
            >
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">问题反馈</span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </a>
          </div>
        </section>

        <p className="text-xs text-muted-foreground text-center mt-5">
          本项目基于{' '}
          <a
            href="https://github.com/wechatsync/Wechatsync"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Wechatsync
          </a>{' '}
          开发
        </p>
      </div>
    </div>
  )
}
