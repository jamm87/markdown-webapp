// Thin wrapper around the File System Access API, with download/upload
// fallbacks for browsers that don't support it (Firefox, Safari).

export type Kind = 'md' | 'mdx'

export interface Doc {
  id: string
  name: string
  /** Path relative to the opened folder, or just the name for loose files. */
  path: string
  kind: Kind
  content: string
  /** Content as last read from / written to disk. Used for the dirty flag. */
  saved: string
  handle?: FileSystemFileHandle
}

export const EXTENSIONS = ['.md', '.mdx', '.markdown']
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next'])

export const supportsFsAccess =
  typeof window !== 'undefined' && 'showOpenFilePicker' in window

export function kindOf(name: string): Kind {
  return name.toLowerCase().endsWith('.mdx') ? 'mdx' : 'md'
}

export function isMarkdown(name: string) {
  const lower = name.toLowerCase()
  return EXTENSIONS.some((ext) => lower.endsWith(ext))
}

let counter = 0
export function makeDoc(
  name: string,
  content: string,
  opts: { path?: string; handle?: FileSystemFileHandle; saved?: string } = {},
): Doc {
  return {
    id: `doc-${Date.now()}-${counter++}`,
    name,
    path: opts.path ?? name,
    kind: kindOf(name),
    content,
    saved: opts.saved ?? content,
    handle: opts.handle,
  }
}

const pickerTypes: FilePickerAcceptType[] = [
  {
    description: 'Markdown / MDX',
    accept: { 'text/markdown': ['.md', '.mdx', '.markdown'] },
  },
]

function isAbort(err: unknown) {
  return err instanceof DOMException && err.name === 'AbortError'
}

/** Fallback: plain <input type="file">, read-only (saving will download). */
function pickWithInput(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = EXTENSIONS.join(',')
    input.onchange = () => resolve(Array.from(input.files ?? []))
    input.click()
  })
}

export async function openFiles(): Promise<Doc[]> {
  if (!supportsFsAccess) {
    const files = await pickWithInput()
    return Promise.all(files.map(async (f) => makeDoc(f.name, await f.text())))
  }
  try {
    const handles = await window.showOpenFilePicker({ multiple: true, types: pickerTypes })
    return Promise.all(handles.map((h) => docFromHandle(h)))
  } catch (err) {
    if (isAbort(err)) return []
    throw err
  }
}

export async function docFromHandle(handle: FileSystemFileHandle, path?: string): Promise<Doc> {
  const file = await handle.getFile()
  return makeDoc(handle.name, await file.text(), { handle, path })
}

export interface FolderEntry {
  path: string
  handle: FileSystemFileHandle
}

export interface Folder {
  name: string
  handle: FileSystemDirectoryHandle
  entries: FolderEntry[]
}

export async function openFolder(): Promise<Folder | null> {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    return { name: handle.name, handle, entries: await scanFolder(handle) }
  } catch (err) {
    if (isAbort(err)) return null
    throw err
  }
}

export async function scanFolder(dir: FileSystemDirectoryHandle, prefix = ''): Promise<FolderEntry[]> {
  const out: FolderEntry[] = []
  for await (const entry of dir.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.kind === 'directory') {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      out.push(...(await scanFolder(entry, path)))
    } else if (isMarkdown(entry.name)) {
      out.push({ path, handle: entry })
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** Creates `relPath` (e.g. "notes/idea.md") inside `root`, creating subfolders as needed. */
export async function createInFolder(root: FileSystemDirectoryHandle, relPath: string) {
  const parts = relPath.split('/').filter(Boolean)
  const fileName = parts.pop()!
  let dir = root
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
  const handle = await dir.getFileHandle(fileName, { create: true })
  return handle
}

async function ensureWritable(handle: FileSystemHandle) {
  const opts: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' }
  if ((await handle.queryPermission(opts)) === 'granted') return true
  return (await handle.requestPermission(opts)) === 'granted'
}

export async function writeToHandle(handle: FileSystemFileHandle, content: string) {
  if (!(await ensureWritable(handle))) throw new Error('Permiso de escritura denegado')
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
}

/**
 * Asks where to save. Returns the new handle, `null` if the user cancelled,
 * or `undefined` when the browser can only download the file.
 */
export async function saveAs(name: string, content: string): Promise<FileSystemFileHandle | null | undefined> {
  if (!('showSaveFilePicker' in window)) {
    download(name, content)
    return undefined
  }
  try {
    const handle = await window.showSaveFilePicker({ suggestedName: name, types: pickerTypes })
    await writeToHandle(handle, content)
    return handle
  } catch (err) {
    if (isAbort(err)) return null
    throw err
  }
}

export function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
