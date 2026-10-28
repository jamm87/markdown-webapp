// WYSIWYG editor whose document model is Markdown (CommonMark + GFM), so it
// can only produce things a .md file can store.
import { useEffect, useRef, type MouseEvent } from 'react'
import { Editor, defaultValueCtx, editorViewCtx, remarkStringifyOptionsCtx, rootCtx, serializerCtx } from '@milkdown/kit/core'
import {
  commonmark,
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  liftListItemCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import { gfm, insertTableCommand, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { $prose, callCommand, replaceAll } from '@milkdown/kit/utils'
import { lift } from '@milkdown/kit/prose/commands'
import { Plugin, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/kit/prose/tables/style/tables.css'

// The presets don't know about frontmatter, so keep it out of the editor.
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/

function splitFrontmatter(source: string) {
  const match = source.match(FRONTMATTER)
  return match ? { front: match[0], body: source.slice(match[0].length) } : { front: '', body: source }
}

/** Names of the formats active at the cursor, matching FORMAT_GROUPS ids. */
function activeFormats(state: EditorState) {
  const active = new Set<string>()
  const { $from, from, to, empty } = state.selection
  const marks = empty ? state.storedMarks ?? $from.marks() : []
  const markNames: Record<string, string> = { strong: 'bold', emphasis: 'italic', strike_through: 'strike', inlineCode: 'code', link: 'link' }
  for (const [mark, id] of Object.entries(markNames)) {
    const type = state.schema.marks[mark]
    if (!type) continue
    if (empty ? type.isInSet(marks) : state.doc.rangeHasMark(from, to, type)) active.add(id)
  }
  const parent = $from.parent
  if (parent.type.name === 'heading') active.add(`h${parent.attrs.level}`)
  if (parent.type.name === 'code_block') active.add('codeblock')
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'blockquote') active.add('quote')
    if (node.type.name === 'list_item' && node.attrs.checked != null) active.add('task')
    if (node.type.name === 'bullet_list' && !active.has('ul') && !active.has('ol')) active.add(active.has('task') ? 'task' : 'ul')
    if (node.type.name === 'ordered_list' && !active.has('ul') && !active.has('ol')) active.add('ol')
  }
  return active
}

/**
 * Milkdown keeps empty paragraphs (pressing Enter twice) as "<br />" lines.
 * Markdown has no empty paragraphs, so drop them instead of writing HTML.
 */
function cleanMarkdown(markdown: string) {
  return markdown
    .replace(/^<br \/>\n(\n|$)/gm, '')
    .replace(/^(\s*(?:[*+-]|\d+[.)])(?: \[[ xX]\])?) <br \/>$/gm, '$1')
}

/** Bullet lists don't remember their marker, so reuse the one the file already uses. */
function bulletMarker(source: string): '-' | '*' | '+' {
  const match = source.match(/^[ \t]*([-*+]) +(?!\1 *\1)\S/m)
  return (match?.[1] as '-' | '*' | '+') ?? '-'
}

function listItemDepth(state: EditorState) {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'list_item') return d
  return -1
}

/** Toggles the GFM task checkbox on the list item at the cursor (creating a list if needed). */
function toggleTask(editor: Editor) {
  editor.action((ctx) => {
    let view = ctx.get(editorViewCtx)
    if (listItemDepth(view.state) < 0) {
      callCommand(wrapInBulletListCommand.key)(ctx)
      view = ctx.get(editorViewCtx)
    }
    const depth = listItemDepth(view.state)
    if (depth < 0) return
    const pos = view.state.selection.$from.before(depth)
    const node = view.state.doc.nodeAt(pos)!
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: node.attrs.checked == null ? false : null }))
  })
}

function insertLink(editor: Editor) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    if (activeFormats(view.state).has('link')) return void callCommand(toggleLinkCommand.key)(ctx)
    const href = prompt('Dirección del enlace:', 'https://')?.trim()
    if (!href) return
    const { from, to, empty } = view.state.selection
    if (empty) {
      const mark = view.state.schema.marks.link.create({ href })
      view.dispatch(view.state.tr.insert(from, view.state.schema.text(href, [mark])))
    } else {
      view.dispatch(view.state.tr.addMark(from, to, view.state.schema.marks.link.create({ href })))
    }
  })
}

function insertImage(editor: Editor) {
  const src = prompt('Dirección de la imagen:', 'https://')?.trim()
  if (!src) return
  editor.action(callCommand(insertImageCommand.key, { src, alt: '' }))
}

export interface RichApi {
  run: (id: string) => void
}

export function RichEditor({
  value,
  onChange,
  onReady,
  onActiveChange,
}: {
  value: string
  onChange: (markdown: string) => void
  onReady: (api: RichApi | null) => void
  onActiveChange: (active: Set<string>) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const resetRef = useRef<((next: string) => void) | null>(null)
  // Last markdown we emitted or loaded, to tell our own updates from external ones.
  const lastValue = useRef(value)
  const callbacks = useRef({ onChange, onActiveChange })
  callbacks.current = { onChange, onActiveChange }

  useEffect(() => {
    let destroyed = false
    const { front, body } = splitFrontmatter(value)
    let frontmatter = front
    // Serializing normalizes syntax (e.g. "*" bullets become "-"). While the
    // document still serializes to the same text as on load, report the
    // original source unchanged so merely opening a file never rewrites it.
    let baseline: string | null = null
    let original = value

    // Serialize synchronously on every change (Milkdown's listener plugin is
    // debounced and drops the last edit on unmount, which could lose typing
    // right before a save or a view switch).
    const sync = $prose(
      (ctx) =>
        new Plugin({
          view: () => ({
            update: (view, prev) => {
              callbacks.current.onActiveChange(activeFormats(view.state))
              if (baseline === null || view.state.doc.eq(prev.doc)) return
              const markdown = cleanMarkdown(ctx.get(serializerCtx)(view.state.doc))
              const next = markdown === baseline ? original : frontmatter + markdown
              if (next === lastValue.current) return
              lastValue.current = next
              callbacks.current.onChange(next)
            },
          }),
        }),
    )

    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, rootRef.current!)
        ctx.set(defaultValueCtx, body)
        const bullet = bulletMarker(body)
        ctx.update(remarkStringifyOptionsCtx, (options) => ({
          ...options,
          bullet,
          bulletOther: bullet === '-' ? ('*' as const) : ('-' as const),
          rule: '-' as const,
        }))
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(clipboard)
      .use(sync)

    const serialize = () =>
      editor.action((ctx) => cleanMarkdown(ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc)))

    editor.create().then(() => {
      if (destroyed) return void editor.destroy()
      editorRef.current = editor
      baseline = serialize()
      rootRef.current?.setAttribute('data-ready', '')
      const run = (id: string) => {
        const call = (key: Parameters<typeof callCommand>[0], payload?: unknown) => editor.action(callCommand(key, payload))
        const view = editor.action((ctx) => ctx.get(editorViewCtx))
        const active = activeFormats(view.state)
        switch (id) {
          case 'h1': case 'h2': case 'h3':
            return active.has(id) ? call(turnIntoTextCommand.key) : call(wrapInHeadingCommand.key, Number(id[1]))
          case 'bold': return call(toggleStrongCommand.key)
          case 'italic': return call(toggleEmphasisCommand.key)
          case 'strike': return call(toggleStrikethroughCommand.key)
          case 'code': return call(toggleInlineCodeCommand.key)
          case 'ul': return active.has('ul') ? call(liftListItemCommand.key) : call(wrapInBulletListCommand.key)
          case 'ol': return active.has('ol') ? call(liftListItemCommand.key) : call(wrapInOrderedListCommand.key)
          case 'task': return toggleTask(editor)
          case 'quote': return active.has('quote') ? void lift(view.state, view.dispatch) : call(wrapInBlockquoteCommand.key)
          case 'link': return insertLink(editor)
          case 'image': return insertImage(editor)
          case 'codeblock': return active.has('codeblock') ? call(turnIntoTextCommand.key) : call(createCodeBlockCommand.key)
          case 'table': return call(insertTableCommand.key, { row: 3, col: 2 })
          case 'hr': return call(insertHrCommand.key)
        }
      }
      onReady({
        run: (id) => {
          run(id)
          editor.action((ctx) => ctx.get(editorViewCtx).focus())
        },
      })
      // Don't steal a click that landed while the editor was starting up.
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        if (!view.hasFocus()) view.focus()
      })
      // Reload from disk etc. replaces the content: reset the baseline too.
      resetRef.current = (next: string) => {
        const parts = splitFrontmatter(next)
        frontmatter = parts.front
        original = next
        lastValue.current = next
        baseline = null
        editor.action(replaceAll(parts.body))
        baseline = serialize()
      }
    })

    return () => {
      destroyed = true
      onReady(null)
      resetRef.current = null
      editorRef.current?.destroy()
      editorRef.current = null
    }
    // The editor is created once per mount; the parent remounts it per document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Content changed outside this editor (e.g. reloaded from disk).
  useEffect(() => {
    if (value !== lastValue.current) resetRef.current?.(value)
  }, [value])

  // Click on a task item's checkbox (drawn with CSS) toggles it.
  const onMouseDown = (e: MouseEvent) => {
    const li = (e.target as HTMLElement).closest('li[data-item-type="task"]') as HTMLElement | null
    if (!li || e.target !== li || e.clientX >= li.getBoundingClientRect().left) return
    e.preventDefault()
    const editor = editorRef.current
    if (!editor) return
    editor.action((ctx) => {
      const view: EditorView = ctx.get(editorViewCtx)
      const pos = view.posAtDOM(li, 0) - 1
      const node = view.state.doc.nodeAt(pos)
      if (node?.type.name !== 'list_item') return
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked }))
    })
  }

  return <div className="rich-editor markdown-body" ref={rootRef} onMouseDown={onMouseDown} />
}
