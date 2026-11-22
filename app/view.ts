import { icon, iconButton } from './icons'

export const emojis = ['⭐', '✅', '❌', '⚠️', '📝', '💡', '📌', '🔍', '🔥', '🗓️', '⌛', '🔒', '🚀', '🌟', '🛠️', '📚', '🎯', '🖍️', '💬', '🌍', '🎨', '❤️', '🔄', '🎉']
export const shortcuts = [
  ['Añadir nodo hijo', 'Tab'], ['Añadir nodo padre', 'Ctrl + Enter'], ['Añadir nodo hermano', 'Enter'],
  ['Eliminar', 'Delete'], ['Mover arriba', 'Alt + ↑'], ['Mover abajo', 'Alt + ↓'],
  ['Mostrar lateral', 'Ctrl + ↑'], ['Mostrar izquierda', 'Ctrl + ←'], ['Mostrar derecha', 'Ctrl + →'], ['Guardar', 'Ctrl + S'],
  ['Deshacer', 'Ctrl + Z'], ['Rehacer', 'Ctrl + Y'], ['Copiar', 'Ctrl + C'], ['Pegar', 'Ctrl + V'], ['Cortar', 'Ctrl + X'],
  ['Mover al centro', 'F1'], ['Editar tema', 'F2'], ['Buscar', 'Ctrl + F'], ['Acercar', 'Ctrl + +'], ['Alejar', 'Ctrl + -'],
  ['Restablecer zoom', 'Ctrl + 0'], ['Añadir hermano antes', 'Shift + Enter'], ['Seleccionar nodo', '↑ ↓ ← →'], ['Ver atajos', 'Shift + /'],
]
const colorField = (id: string, label: string) => `<div class="field"><label for="${id}">${label}</label><div class="color-row"><input type="color" id="${id}" value="#ffffff"/><button type="button" class="text-button" id="${id}-clear" aria-label="Limpiar ${label.toLowerCase()}">Limpiar</button></div></div>`

export function renderApp() {
  document.querySelector('#app')!.innerHTML = `
  <main id="editor" aria-label="Editor de mapas mentales">
    <section id="stage" aria-label="Área de trabajo">
      <div id="map" aria-label="Mapa mental"></div>
      <div id="outline" aria-label="Esquema del mapa" hidden></div>
      <nav class="topbar" aria-label="Archivo e historial">
        ${iconButton('file-menu-button', 'Menú de archivo', 'back', 'aria-expanded="false" aria-controls="file-menu"')}
        ${iconButton('save', 'Guardar (Ctrl + S)', 'save')}
        ${iconButton('undo', 'Deshacer (Ctrl + Z)', 'undo', 'disabled')}
        ${iconButton('redo', 'Rehacer (Ctrl + Y)', 'redo', 'disabled')}
      </nav>
      <div id="file-menu" class="popover file-menu" hidden>
        <div class="menu-title">Archivo</div>
        <p id="folder-name">Sin carpeta seleccionada</p>
        <button type="button" id="choose-folder">${icon('folder')} Seleccionar otra carpeta</button>
        <button type="button" id="reconnect-folder">${icon('link')} Reconectar carpeta</button>
        <button type="button" id="retry-save">${icon('save')} Guardar ahora</button>
        <div class="menu-foot">mapa-mental.json · Guardado local</div>
      </div>
      <div id="save-status" role="status" aria-live="polite">Seleccioná una carpeta para guardar</div>
      <div id="connection-banner" hidden><span id="connection-message"></span><button type="button" id="connect-banner">Seleccionar carpeta</button></div>
      <nav class="tool-rail" aria-label="Herramientas del mapa">
        ${iconButton('fullscreen', 'Pantalla completa', 'full')}
        ${iconButton('center', 'Centrar mapa (F1)', 'center')}
        ${iconButton('zoom-out', 'Alejar', 'minus')}
        ${iconButton('zoom-in', 'Acercar', 'plus')}
        ${iconButton('layout-right', 'Mostrar derecha', 'right')}
        ${iconButton('layout-left', 'Mostrar izquierda', 'left')}
        ${iconButton('layout-side', 'Mostrar lateral', 'side')}
        ${iconButton('search-button', 'Buscar (Ctrl + F)', 'search', 'aria-expanded="false"')}
        ${iconButton('outline-button', 'Alternar mapa y esquema', 'outline', 'aria-pressed="false"')}
        ${iconButton('shortcuts-button', 'Atajos de teclado', 'keyboard')}
      </nav>
      <section id="search-panel" class="popover" aria-label="Buscar en el mapa" hidden>
        <div class="search-heading"><label for="search-input">Buscar en el mapa</label>${iconButton('search-close', 'Cerrar búsqueda', 'close')}</div>
        <input id="search-input" type="search" placeholder="Texto del nodo…" autocomplete="off"/>
        <div id="search-results" role="list" aria-live="polite"></div>
      </section>
      <div id="toast" role="status" hidden></div>
    </section>
    <aside id="inspector" aria-label="Propiedades del mapa">
      <button type="button" id="collapse-panel" aria-label="Contraer panel" aria-expanded="true">${icon('chevron')}</button>
      <div id="global-panel">
        <div class="panel-heading">Configuración</div>
        <div class="panel-body">
          <div class="field"><label for="theme">Tema</label><select id="theme"><option>Latte</option><option>Claro</option><option>Oscuro</option></select></div>
          <div class="field"><label for="branch-style">Estilo de rama</label><select id="branch-style"><option value="curve">Curva clásica</option><option value="straight">Recta</option><option value="orthogonal">Ortogonal</option></select></div>
          ${colorField('global-color', 'Color de texto global')}
          <div class="field"><label for="font-family">Fuente</label><select id="font-family"><option>Times New Roman</option><option>Georgia</option><option>Arial</option><option>Verdana</option><option>monospace</option></select></div>
          <div class="field switch-row"><label for="compact">Modo compacto</label><input type="checkbox" id="compact" class="switch" role="switch"/></div>
          <div class="field"><label for="source">Fuente documental</label><input id="source" type="text" placeholder="Texto o URL del material"/></div>
          <div class="file-info"><h2>Información del archivo</h2><dl><div><dt>Creado en:</dt><dd id="created-at"></dd></div><div><dt>Actualizado en:</dt><dd id="updated-at"></dd></div></dl></div>
        </div>
      </div>
      <div id="node-panel" hidden>
        <div class="tabs" role="tablist" aria-label="Propiedades del nodo">
          <button type="button" id="tab-general" role="tab" aria-selected="true" aria-controls="panel-general">General</button>
          <button type="button" id="tab-image" role="tab" aria-selected="false" aria-controls="panel-image">Imagen</button>
          <button type="button" id="tab-note" role="tab" aria-selected="false" aria-controls="panel-note">Nota</button>
        </div>
        <div class="panel-body">
          <section id="panel-general" role="tabpanel" aria-labelledby="tab-general">
            ${colorField('node-color', 'Color')}
            ${colorField('node-background', 'Color de fondo')}
            <div class="field"><label for="node-font-size">Tamaño de letra</label><div class="range-row"><output id="font-size-value" for="node-font-size">16px</output><input id="node-font-size" type="range" min="10" max="64" value="16"/></div></div>
            <div class="field"><label for="node-tags">Etiquetas</label><input id="node-tags" placeholder="Etiquetas"/><p class="hint">Separá las etiquetas con comas.</p></div>
            <div class="field"><span class="field-label">Iconos</span><div class="emoji-grid">${emojis.map((emoji, i) => `<button type="button" class="emoji" data-emoji="${i}" aria-label="Icono ${emoji}" aria-pressed="false">${emoji}</button>`).join('')}</div></div>
            <div class="field"><label for="node-url">URL</label><input type="url" id="node-url" placeholder="https://…"/><p class="hint">Añadí un enlace a este nodo.</p></div>
          </section>
          <section id="panel-image" role="tabpanel" aria-labelledby="tab-image" hidden>
            <div class="field"><label for="image-type">Tipo de imagen</label><select id="image-type"><option value="local">Imagen local</option><option value="url">URL de imagen</option></select></div>
            <div id="image-local-field"><button type="button" class="wide-button" id="image-upload">${icon('upload')} Seleccionar imagen local</button><input id="image-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden/></div>
            <div id="image-url-field" hidden><label for="image-url">URL de imagen</label><input id="image-url" type="url" placeholder="https://…"/><button type="button" id="image-url-apply" class="wide-button">Aplicar imagen</button></div>
            <div class="field image-size-field"><span class="field-label">Ancho y alto</span><div class="size-row"><input id="image-width" type="number" min="1" max="4000" placeholder="0" aria-label="Ancho de imagen"/>${iconButton('image-ratio', 'Mantener proporción', 'link', 'aria-pressed="true"')}<input id="image-height" type="number" min="1" max="4000" placeholder="0" aria-label="Alto de imagen"/></div></div>
            <div class="field"><label for="image-fit">Ajuste de objeto</label><select id="image-fit"><option value="contain">Contener</option><option value="cover">Cubrir</option><option value="fill">Estirar</option></select></div>
            <button type="button" id="image-clear" class="wide-button">Limpiar imagen</button>
          </section>
          <section id="panel-note" role="tabpanel" aria-labelledby="tab-note" hidden>
            <div class="field"><label for="node-note">Nota del nodo</label><textarea id="node-note" rows="14" placeholder="Escribí una nota…"></textarea><p class="hint">La nota se guarda con el mapa.</p></div>
          </section>
        </div>
      </div>
    </aside>
  </main>
  <dialog id="folder-dialog" aria-labelledby="folder-title">
    ${iconButton('folder-close', 'Cerrar selector de carpeta', 'close')}
    <div class="folder-art">${icon('folder')}</div><h1 id="folder-title">Tu mapa, en tu carpeta</h1>
    <p>Elegí dónde guardar <strong>mapa-mental.json</strong>. Tus cambios se guardarán automáticamente y volveremos a abrirlo en tu próxima visita.</p>
    <p id="folder-dialog-message" class="hint">El archivo permanece en tu PC.</p>
    <button type="button" id="folder-start" class="primary-button">${icon('folder')} Seleccionar carpeta</button>
  </dialog>
  <dialog id="shortcuts-dialog" aria-labelledby="shortcuts-title">
    ${iconButton('shortcuts-close', 'Cerrar atajos', 'close')}
    <h2 id="shortcuts-title">Atajos de teclado</h2><p class="shortcut-hint">Presioná Shift + / para mostrar este diálogo nuevamente</p>
    <div class="shortcuts-scroll"><table><thead><tr><th>Acción</th><th>Atajo de teclado</th></tr></thead><tbody>${shortcuts.map(([name, key]) => `<tr><td>${name}</td><td><kbd>${key}</kbd></td></tr>`).join('')}</tbody></table></div>
  </dialog>`
}
