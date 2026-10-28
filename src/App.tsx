import { useCallback, useEffect, useMemo, useState } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { Preview } from './Preview'
import {
  createInFolder,
  docFromHandle,
  isMarkdown,
  makeDoc,
  openFiles,
  openFolder,
  saveAs,
  scanFolder,
  supportsFsAccess,
  writeToHandle,
  type Doc,
  type Folder,
} from './fs'

type View = 'edit' | 'split' | 'preview'

const WELCOME = `# Hola 👋

Esto es un editor de **Markdown** y **MDX**.

- **Abrir archivo** o **Abrir carpeta** para editar tus ficheros.
- \`Ctrl/Cmd + S\` guarda directamente en el archivo original.
- Arrastra un \`.md\` o \`.mdx\` sobre la ventana para abrirlo.

| Atajo | Acción |
| --- | --- |
| Ctrl/Cmd + S | Guardar |
| Ctrl/Cmd + Shift + S | Guardar como |
| Ctrl/Cmd + O | Abrir archivo |

- [x] Tablas, listas de tareas y ~~tachado~~ (GFM)
- [ ] Escribir algo
`

const prefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches

export default function App() {
  const [docs, setDocs] = useState<Doc[]>(() => [makeDoc('bienvenida.md', WELCOME)])
  const [activeId, setActiveId] = useState(() => docs[0].id)
  const [folder, setFolder] = useState<Folder | null>(null)
  const [view, setView] = useState<View>(() => (window.innerWidth < 800 ? 'edit' : 'split'))
  const [dark, setDark] = useState(prefersDark)
  const [status, setStatus] = useState<string | null>(null)

  const active = docs.find((d) => d.id === activeId) ?? docs[0]
  const dirtyCount = docs.filter((d) => d.content !== d.saved).length

  const flash = useCallback((msg: string) => {
    setStatus(msg)
    setTimeout(() => setStatus((s) => (s === msg ? null : s)), 2500)
  }, [])

  const fail = useCallback((err: unknown) => flash(`Error: ${(err as Error).message ?? err}`), [flash])

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

  useEffect(() => {
    document.title = active ? `${active.content !== active.saved ? '• ' : ''}${active.name} — Markdown Editor` : 'Markdown Editor'
  }, [active])

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (!dirtyCount) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirtyCount])

  const updateDoc = useCallback((id: string, patch: Partial<Doc>) => {
    setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }, [])

  /** Adds docs, reusing an already-open tab if it points to the same file. */
  const addDocs = useCallback(async (incoming: Doc[]) => {
    if (!incoming.length) return
    let focus = incoming[incoming.length - 1].id
    const current = docs
    const fresh: Doc[] = []
    for (const doc of incoming) {
      let existing: Doc | undefined
      for (const d of current) {
        if (d.handle && doc.handle && (await d.handle.isSameEntry(doc.handle))) existing = d
      }
      if (existing) focus = existing.id
      else fresh.push(doc)
    }
    // Drop untouched scratch docs (e.g. the welcome page) once real files are opened.
    setDocs((ds) => [...ds.filter((d) => d.handle || d.content !== d.saved), ...fresh])
    setActiveId(fresh.length ? fresh[fresh.length - 1].id : focus)
  }, [docs])

  const handleOpenFiles = useCallback(async () => {
    try {
      await addDocs(await openFiles())
    } catch (err) {
      fail(err)
    }
  }, [addDocs, fail])

  const handleOpenFolder = useCallback(async () => {
    try {
      const f = await openFolder()
      if (f) setFolder(f)
    } catch (err) {
      fail(err)
    }
  }, [fail])

  const refreshFolder = useCallback(async () => {
    if (!folder) return
    setFolder({ ...folder, entries: await scanFolder(folder.handle) })
  }, [folder])

  const openFromFolder = useCallback(async (path: string, handle: FileSystemFileHandle) => {
    const existing = docs.find((d) => d.path === path && d.handle)
    if (existing) return setActiveId(existing.id)
    try {
      await addDocs([await docFromHandle(handle, path)])
    } catch (err) {
      fail(err)
    }
  }, [docs, addDocs, fail])

  const handleNew = useCallback(async () => {
    if (folder) {
      const path = prompt('Nombre del nuevo archivo (puede incluir subcarpetas):', 'nuevo.md')?.trim()
      if (!path) return
      const name = isMarkdown(path) ? path : `${path}.md`
      try {
        const handle = await createInFolder(folder.handle, name)
        await refreshFolder()
        await addDocs([await docFromHandle(handle, name)])
      } catch (err) {
        fail(err)
      }
      return
    }
    const n = docs.filter((d) => d.name.startsWith('sin-titulo')).length
    const doc = makeDoc(`sin-titulo${n ? `-${n + 1}` : ''}.md`, '')
    setDocs((ds) => [...ds, doc])
    setActiveId(doc.id)
  }, [folder, docs, refreshFolder, addDocs, fail])

  const handleSaveAs = useCallback(async (doc: Doc) => {
    try {
      const handle = await saveAs(doc.name, doc.content)
      if (handle === null) return
      if (handle === undefined) {
        updateDoc(doc.id, { saved: doc.content })
        return flash(`Descargado ${doc.name}`)
      }
      updateDoc(doc.id, { handle, name: handle.name, path: handle.name, saved: doc.content, kind: handle.name.endsWith('.mdx') ? 'mdx' : 'md' })
      flash(`Guardado ${handle.name}`)
    } catch (err) {
      fail(err)
    }
  }, [updateDoc, flash, fail])

  const handleSave = useCallback(async (doc: Doc) => {
    if (!doc.handle) return handleSaveAs(doc)
    try {
      await writeToHandle(doc.handle, doc.content)
      updateDoc(doc.id, { saved: doc.content })
      flash(`Guardado ${doc.path}`)
    } catch (err) {
      fail(err)
    }
  }, [handleSaveAs, updateDoc, flash, fail])

  const handleReload = useCallback(async (doc: Doc) => {
    if (!doc.handle) return
    if (doc.content !== doc.saved && !confirm('Descartar los cambios y recargar desde disco?')) return
    const text = await (await doc.handle.getFile()).text()
    updateDoc(doc.id, { content: text, saved: text })
    flash('Recargado desde disco')
  }, [updateDoc, flash])

  const closeDoc = useCallback((doc: Doc) => {
    if (doc.content !== doc.saved && !confirm(`"${doc.name}" tiene cambios sin guardar. ¿Cerrar igualmente?`)) return
    const idx = docs.findIndex((d) => d.id === doc.id)
    const rest = docs.filter((d) => d.id !== doc.id)
    const next = rest.length ? rest : [makeDoc('sin-titulo.md', '')]
    setDocs(next)
    if (doc.id === activeId) setActiveId(next[Math.min(idx, next.length - 1)].id)
  }, [docs, activeId])

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 's') {
        e.preventDefault()
        if (e.shiftKey) handleSaveAs(active)
        else handleSave(active)
      } else if (key === 'o') {
        e.preventDefault()
        handleOpenFiles()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, handleSave, handleSaveAs, handleOpenFiles])

  // Drag & drop files onto the window.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => e.preventDefault()
    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      const items = Array.from(e.dataTransfer?.items ?? []).filter((i) => i.kind === 'file')
      // Grab handles synchronously: the DataTransfer is cleared after the first await.
      const pending = items.map((item) =>
        'getAsFileSystemHandle' in item
          ? (item as any).getAsFileSystemHandle() as Promise<FileSystemHandle | null>
          : Promise.resolve(null),
      )
      const files = items.map((i) => i.getAsFile())
      const out: Doc[] = []
      for (let i = 0; i < items.length; i++) {
        const handle = await pending[i]
        if (handle?.kind === 'directory') {
          const dir = handle as FileSystemDirectoryHandle
          setFolder({ name: dir.name, handle: dir, entries: await scanFolder(dir) })
        } else if (handle?.kind === 'file' && isMarkdown(handle.name)) {
          out.push(await docFromHandle(handle as FileSystemFileHandle))
        } else if (files[i] && isMarkdown(files[i]!.name)) {
          out.push(makeDoc(files[i]!.name, await files[i]!.text()))
        }
      }
      addDocs(out).catch(fail)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [addDocs, fail])

  const extensions = useMemo(
    () => [markdown({ base: markdownLanguage, codeLanguages: languages }), EditorView.lineWrapping],
    [],
  )

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-group">
          <button onClick={handleNew} title="Nuevo archivo">＋ Nuevo</button>
          <button onClick={handleOpenFiles} title="Abrir archivo (Ctrl+O)">Abrir archivo</button>
          {supportsFsAccess && <button onClick={handleOpenFolder}>Abrir carpeta</button>}
          <button className="primary" onClick={() => handleSave(active)} disabled={active.content === active.saved && !!active.handle} title="Guardar (Ctrl+S)">
            Guardar
          </button>
          <button onClick={() => handleSaveAs(active)} title="Guardar como (Ctrl+Shift+S)">Guardar como…</button>
          {active.handle && <button onClick={() => handleReload(active)} title="Recargar desde disco">↻</button>}
        </div>
        <div className="toolbar-group">
          <div className="segmented">
            {(['edit', 'split', 'preview'] as const).map((v) => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {{ edit: 'Editor', split: 'Dividido', preview: 'Vista' }[v]}
              </button>
            ))}
          </div>
          <button onClick={() => setDark((d) => !d)} title="Cambiar tema">{dark ? '☀︎' : '☾'}</button>
        </div>
      </header>

      {!supportsFsAccess && (
        <div className="banner">
          Tu navegador no permite escribir directamente en archivos: al guardar se descargará una copia. Usa Chrome, Edge o Brave para editar los archivos en su sitio.
        </div>
      )}

      <div className="main">
        <aside className="sidebar">
          <section>
            <h3>Abiertos</h3>
            <ul>
              {docs.map((d) => (
                <li key={d.id} className={d.id === active.id ? 'active' : ''}>
                  <button className="file" onClick={() => setActiveId(d.id)} title={d.path}>
                    {d.content !== d.saved && <span className="dot">●</span>}
                    {d.name}
                    <span className="badge">{d.kind}</span>
                  </button>
                  <button className="close" onClick={() => closeDoc(d)} title="Cerrar">×</button>
                </li>
              ))}
            </ul>
          </section>
          {folder && (
            <section>
              <h3>
                <span title={folder.name}>📁 {folder.name}</span>
                <button className="icon" onClick={refreshFolder} title="Actualizar">↻</button>
                <button className="icon" onClick={() => setFolder(null)} title="Cerrar carpeta">×</button>
              </h3>
              <ul>
                {folder.entries.length === 0 && <li className="empty">Sin archivos .md / .mdx</li>}
                {folder.entries.map((e) => {
                  const depth = e.path.split('/').length - 1
                  const name = e.path.split('/').pop()
                  const dir = e.path.split('/').slice(0, -1).join('/')
                  const open = docs.find((d) => d.handle && d.path === e.path)
                  return (
                    <li key={e.path} className={open?.id === active.id ? 'active' : ''}>
                      <button className="file" style={{ paddingLeft: 8 + depth * 10 }} onClick={() => openFromFolder(e.path, e.handle)} title={e.path}>
                        {open && open.content !== open.saved && <span className="dot">●</span>}
                        {name}
                        {dir && <span className="dir">{dir}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </aside>

        <div className={`panes view-${view}`}>
          {view !== 'preview' && (
            <div className="pane editor">
              <CodeMirror
                key={active.id}
                value={active.content}
                height="100%"
                theme={dark ? 'dark' : 'light'}
                extensions={extensions}
                onChange={(value) => updateDoc(active.id, { content: value })}
                basicSetup={{ foldGutter: false }}
                autoFocus
              />
            </div>
          )}
          {view !== 'edit' && (
            <div className="pane">
              <Preview source={active.content} kind={active.kind} />
            </div>
          )}
        </div>
      </div>

      <footer className="statusbar">
        <span>{active.handle ? active.path : `${active.name} (sin guardar en disco)`}</span>
        <span>{status ?? `${active.content.length} caracteres · ${active.content.split(/\s+/).filter(Boolean).length} palabras`}</span>
      </footer>
    </div>
  )
}
