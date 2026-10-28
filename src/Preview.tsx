import { Component, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { evaluate } from '@mdx-js/mdx'
import * as runtime from 'react/jsx-runtime'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import type { Kind } from './fs'

type MDXContent = ComponentType<{ components?: Record<string, unknown> }>

// Components available to every .mdx file without importing them.
const builtins: Record<string, ComponentType<any>> = {
  Callout: ({ type = 'info', children }: { type?: string; children?: ReactNode }) => (
    <div className={`callout callout-${type}`}>{children}</div>
  ),
  Note: ({ children }: { children?: ReactNode }) => <div className="callout callout-info">{children}</div>,
  Warning: ({ children }: { children?: ReactNode }) => <div className="callout callout-warning">{children}</div>,
}

function missing(name: string) {
  const Missing = ({ children }: { children?: ReactNode }) => (
    <div className="mdx-missing">
      <code>&lt;{name}&gt;</code>
      {children}
    </div>
  )
  return Missing
}

/**
 * Imports can't be resolved in the browser, so drop them and render
 * placeholders for any JSX component we don't know about.
 */
function prepare(source: string, kind: Kind) {
  if (kind === 'md') return { source, components: builtins }
  const stripped = source.replace(/^import\s.+?from\s+['"].+?['"];?\s*$/gm, '')
  const components: Record<string, ComponentType<any>> = { ...builtins }
  for (const [, name] of stripped.matchAll(/<([A-Z][\w]*)/g)) {
    components[name] ??= missing(name)
  }
  return { source: stripped, components }
}

export function Preview({ source, kind }: { source: string; kind: Kind }) {
  const [result, setResult] = useState<{ Content: MDXContent; components: Record<string, unknown> } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      const { source: src, components } = prepare(source, kind)
      try {
        const mod = await evaluate(src, {
          ...runtime,
          format: kind,
          remarkPlugins: [remarkGfm, remarkFrontmatter],
          baseUrl: import.meta.url,
        })
        if (cancelled) return
        setResult({ Content: mod.default as MDXContent, components })
        setError(null)
      } catch (err) {
        if (!cancelled) setError(String((err as Error).message ?? err))
      }
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [source, kind])

  return (
    <div className="preview markdown-body">
      {error && <pre className="preview-error">{error}</pre>}
      {result && (
        <ErrorBoundary key={source}>
          <result.Content components={result.components} />
        </ErrorBoundary>
      )}
    </div>
  )
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) return <pre className="preview-error">{this.state.error.message}</pre>
    return this.props.children
  }
}
