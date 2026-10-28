// Images stored next to the Markdown file, in an "imagenes/" folder, and
// referenced with relative paths so the .md stays portable.

export const IMAGE_DIR = 'imagenes'

/** Where a document lives: a granted folder plus the path to the doc's directory inside it. */
export interface DocLocation {
  root: FileSystemDirectoryHandle
  dirParts: string[]
}

/** Finds `file` inside `root`; null if it isn't there. */
export async function locate(root: FileSystemDirectoryHandle, file: FileSystemFileHandle): Promise<DocLocation | null> {
  const parts = await root.resolve(file)
  return parts ? { root, dirParts: parts.slice(0, -1) } : null
}

async function getDir(root: FileSystemDirectoryHandle, parts: string[], create: boolean) {
  let dir = root
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create })
  return dir
}

export function imageFiles(data: DataTransfer | null): File[] {
  return Array.from(data?.files ?? []).filter((f) => f.type.startsWith('image/'))
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' }

function baseName(file: File) {
  const ext = EXT[file.type] ?? file.name.split('.').pop() ?? 'png'
  // Pasted screenshots arrive as "image.png" (or unnamed): give them a dated name.
  if (!file.name || /^image\.\w+$/i.test(file.name)) {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return { stem: `captura-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`, ext }
  }
  const stem = file.name.replace(/\.[^.]+$/, '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'imagen'
  return { stem, ext }
}

/** Writes the image into `<doc dir>/imagenes/` and returns its path relative to the doc. */
export async function saveImage(loc: DocLocation, file: File): Promise<{ path: string; alt: string }> {
  const dir = await getDir(loc.root, [...loc.dirParts, IMAGE_DIR], true)
  const { stem, ext } = baseName(file)
  let name = `${stem}.${ext}`
  for (let i = 2; await exists(dir, name); i++) name = `${stem}-${i}.${ext}`
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(file)
  await writable.close()
  return { path: `${IMAGE_DIR}/${name}`, alt: stem.startsWith('captura-') ? 'captura' : stem }
}

async function exists(dir: FileSystemDirectoryHandle, name: string) {
  try {
    await dir.getFileHandle(name)
    return true
  } catch {
    return false
  }
}

/** Fallback for browsers without the File System Access API: embed the image. */
export function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function markdownImage(alt: string, path: string) {
  // Spaces and parentheses would break the link: wrap in <> when needed.
  const target = /[\s()]/.test(path) ? `<${path}>` : path
  return `![${alt.replace(/[[\]]/g, '')}](${target})`
}

export type ImageResolver = (src: string) => Promise<string | null>

const isRemote = (src: string) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)

/**
 * Turns relative image paths into blob: URLs read from the doc's folder, so
 * the preview and the visual editor can show local images. URLs are cached
 * per resolver and revoked by `dispose`.
 */
export function createResolver(loc: DocLocation | null) {
  const cache = new Map<string, Promise<string | null>>()
  const resolve: ImageResolver = (src) => {
    if (!src || isRemote(src)) return Promise.resolve(src || null)
    if (!loc) return Promise.resolve(null)
    let hit = cache.get(src)
    if (!hit) {
      hit = (async () => {
        try {
          const clean = decodeURI(src.replace(/^<|>$/g, '')).split(/[?#]/)[0]
          const parts = [...loc.dirParts]
          for (const seg of clean.split('/')) {
            if (seg === '..') parts.pop()
            else if (seg && seg !== '.') parts.push(seg)
          }
          const name = parts.pop()!
          const dir = await getDir(loc.root, parts, false)
          const file = await (await dir.getFileHandle(name)).getFile()
          return URL.createObjectURL(file)
        } catch {
          return null
        }
      })()
      cache.set(src, hit)
    }
    return hit
  }
  const dispose = () => {
    for (const url of cache.values()) url.then((u) => u?.startsWith('blob:') && URL.revokeObjectURL(u))
    cache.clear()
  }
  return { resolve, dispose }
}
