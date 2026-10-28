# Markdown / MDX Editor

Editor y lector sencillo de Markdown y MDX que funciona en el navegador y **escribe directamente sobre tus archivos locales** (File System Access API).

## Uso

```bash
npm install
npm run dev      # desarrollo en http://localhost:5173
npm run build    # genera una web estática en dist/
```

`dist/` es estático: se puede servir en cualquier hosting (GitHub Pages, Netlify, Vercel…) o probar con `npm run preview`.

## Despliegue en GitHub Pages

El workflow `.github/workflows/deploy.yml` compila y publica la app en cada push a `main` (o a mano desde *Actions → Deploy to GitHub Pages → Run workflow*).

Configuración única: en el repo, *Settings → Pages → Build and deployment → Source* = **GitHub Actions**.

Queda publicada en `https://jamm87.github.io/markdown-webapp/`.

## Instalar como app (Chrome / Edge)

Es una PWA: abre la web servida por `https://` (o `http://localhost`) y pulsa el icono de **Instalar** en la barra de direcciones (o menú ⋮ → *Transmitir, guardar y compartir* → *Instalar página como app*). Se abre en su propia ventana y funciona sin conexión.

Una vez instalada se registra para `.md`, `.mdx` y `.markdown`: en el explorador de archivos, *Abrir con → Markdown Editor* abre el archivo listo para editar y guardar.

## Funciones

- **Abrir archivo** (`Ctrl/Cmd+O`) o **Abrir carpeta**: lista todos los `.md`, `.mdx` y `.markdown` (ignora `node_modules`, `.git`, carpetas ocultas…).
- **Guardar** (`Ctrl/Cmd+S`) sobrescribe el archivo original; **Guardar como** (`Ctrl/Cmd+Shift+S`) elige destino.
- **Nuevo**: con una carpeta abierta crea el archivo dentro (admite subcarpetas, p. ej. `notas/idea.md`).
- Arrastrar y soltar archivos o carpetas sobre la ventana.
- Barra de formato: títulos, negrita (`Ctrl+B`), cursiva (`Ctrl+I`), tachado, código (`Ctrl+E`), listas, tareas, citas, enlaces (`Ctrl+K`), imágenes, bloques de código, tablas y separadores. Los botones de estilo y de línea se activan y desactivan.
- Columnas redimensionables: arrastra el separador del panel lateral o entre editor y vista previa (doble clic para restablecer; también con las flechas del teclado). El ancho se recuerda. `☰` oculta el panel lateral.
- Vista editor / dividida / previsualización, tema claro/oscuro, aviso de cambios sin guardar, recargar desde disco.
- Markdown con GFM (tablas, tareas, tachado) y frontmatter (se oculta en la vista previa).
- MDX: expresiones `{...}` y JSX. Los `import` se ignoran en la vista previa (no se pueden resolver en el navegador) y los componentes desconocidos se muestran como un recuadro con su nombre. Incluye `<Callout type="info|warning|danger">`, `<Note>` y `<Warning>`.

## Compatibilidad

Escribir en el archivo original requiere **Chrome, Edge, Brave u Opera** (escritorio). En Firefox y Safari se puede abrir y editar, pero al guardar se descarga una copia.

> El MDX se ejecuta en tu navegador (es código JavaScript). Abre solo archivos MDX en los que confíes.
