// Markdown formatting commands for the CodeMirror editor.
import { EditorSelection, type ChangeSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/** Wraps each selection in `before`/`after`, or unwraps it if already wrapped. */
export function wrap(view: EditorView, before: string, after = before, placeholder = 'texto') {
  const { state } = view
  view.dispatch(
    state.changeByRange((range) => {
      const outerFrom = range.from - before.length
      const outerTo = range.to + after.length
      const isWrapped =
        outerFrom >= 0 &&
        state.sliceDoc(outerFrom, range.from) === before &&
        state.sliceDoc(range.to, outerTo) === after
      if (isWrapped) {
        return {
          changes: [
            { from: outerFrom, to: range.from },
            { from: range.to, to: outerTo },
          ],
          range: EditorSelection.range(outerFrom, range.to - before.length),
        }
      }
      const text = range.empty ? placeholder : state.sliceDoc(range.from, range.to)
      const from = range.from + before.length
      return {
        changes: { from: range.from, to: range.to, insert: before + text + after },
        range: EditorSelection.range(from, from + text.length),
      }
    }),
    { scrollIntoView: true, userEvent: 'input.format' },
  )
  view.focus()
}

const BLOCK_PREFIX = /^(#{1,6} |> |[-*+] \[[ xX]\] |[-*+] |\d+\. )/

/**
 * Toggles a line prefix (heading, list, quote) on every selected line.
 * Any other block prefix already on the line is replaced.
 * `prefix` may be a function of the line index, for numbered lists.
 */
export function toggleLinePrefix(view: EditorView, prefix: string | ((i: number) => string)) {
  const { state } = view
  const lines = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  const prefixFor = (i: number) => (typeof prefix === 'string' ? prefix : prefix(i))
  const numbers = [...lines].sort((a, b) => a - b)
  // If every line already has this kind of prefix, remove it instead.
  const allHave = numbers.every((n, i) => {
    const text = state.doc.line(n).text
    return typeof prefix === 'string' ? text.startsWith(prefixFor(i)) : /^\d+\. /.test(text)
  })
  const changes: ChangeSpec[] = numbers.map((n, i) => {
    const line = state.doc.line(n)
    const existing = line.text.match(BLOCK_PREFIX)?.[0] ?? ''
    return { from: line.from, to: line.from + existing.length, insert: allHave ? '' : prefixFor(i) }
  })
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'input.format' })
  view.focus()
}

/** Inserts a block on its own lines at the cursor, selecting `select` within it if given. */
export function insertBlock(view: EditorView, block: string, select?: string) {
  const { state } = view
  const range = state.selection.main
  const line = state.doc.lineAt(range.from)
  const selected = state.sliceDoc(range.from, range.to)
  const body = select && selected ? block.replace(select, selected) : block
  // Start on a fresh paragraph if the cursor is after text on its line.
  const lead = state.sliceDoc(line.from, range.from).trim() ? '\n\n' : ''
  const insert = lead + body + '\n'
  const at = range.from
  const target = select ? (selected || select) : ''
  const offset = target ? insert.indexOf(target) : insert.length
  view.dispatch({
    changes: { from: at, to: range.to, insert },
    selection: EditorSelection.range(at + offset, at + offset + target.length),
    scrollIntoView: true,
    userEvent: 'input.format',
  })
  view.focus()
}

export function insertLink(view: EditorView, image = false) {
  const { state } = view
  const range = state.selection.main
  const text = state.sliceDoc(range.from, range.to) || (image ? 'descripción' : 'texto')
  const url = 'https://'
  const insert = `${image ? '!' : ''}[${text}](${url})`
  const urlFrom = range.from + insert.length - url.length - 1
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.range(urlFrom, urlFrom + url.length),
    scrollIntoView: true,
    userEvent: 'input.format',
  })
  view.focus()
}

export interface FormatAction {
  id: string
  label: string
  title: string
  run: (view: EditorView) => void
  /** CodeMirror key binding, e.g. "Mod-b". */
  key?: string
}

const TABLE = `| Columna 1 | Columna 2 |
| --- | --- |
| celda | celda |`

export const FORMAT_GROUPS: FormatAction[][] = [
  [
    { id: 'h1', label: 'H1', title: 'Título 1', run: (v) => toggleLinePrefix(v, '# ') },
    { id: 'h2', label: 'H2', title: 'Título 2', run: (v) => toggleLinePrefix(v, '## ') },
    { id: 'h3', label: 'H3', title: 'Título 3', run: (v) => toggleLinePrefix(v, '### ') },
  ],
  [
    { id: 'bold', label: 'B', title: 'Negrita (Ctrl+B)', run: (v) => wrap(v, '**'), key: 'Mod-b' },
    { id: 'italic', label: 'I', title: 'Cursiva (Ctrl+I)', run: (v) => wrap(v, '*'), key: 'Mod-i' },
    { id: 'strike', label: 'S', title: 'Tachado', run: (v) => wrap(v, '~~') },
    { id: 'code', label: '</>', title: 'Código en línea (Ctrl+E)', run: (v) => wrap(v, '`', '`', 'código'), key: 'Mod-e' },
  ],
  [
    { id: 'ul', label: '•', title: 'Lista', run: (v) => toggleLinePrefix(v, '- ') },
    { id: 'ol', label: '1.', title: 'Lista numerada', run: (v) => toggleLinePrefix(v, (i) => `${i + 1}. `) },
    { id: 'task', label: '☐', title: 'Lista de tareas', run: (v) => toggleLinePrefix(v, '- [ ] ') },
    { id: 'quote', label: '❝', title: 'Cita', run: (v) => toggleLinePrefix(v, '> ') },
  ],
  [
    { id: 'link', label: '🔗', title: 'Enlace (Ctrl+K)', run: (v) => insertLink(v), key: 'Mod-k' },
    { id: 'image', label: '🖼', title: 'Imagen', run: (v) => insertLink(v, true) },
    { id: 'codeblock', label: '{ }', title: 'Bloque de código', run: (v) => insertBlock(v, '```\ncódigo\n```', 'código') },
    { id: 'table', label: '▦', title: 'Tabla', run: (v) => insertBlock(v, TABLE, 'Columna 1') },
    { id: 'hr', label: '—', title: 'Separador', run: (v) => insertBlock(v, '---') },
  ],
]
