# Árbol · Editor de mapas mentales

Editor web en español con [Mind Elixir Core](https://github.com/SSShooter/mind-elixir-core) **6.0.3**, instalado desde npm sin modificar su motor. La interfaz reproduce la distribución del editor de Mind Elixir App: lienzo, barras de herramientas, propiedades y atajos. No incluye IA ni cuentas.

## Desarrollo

Requiere Node.js 22.12+ y npm.

```sh
npm ci
npm run dev
```

En PowerShell, si la política impide ejecutar `npm.ps1`, usá `npm.cmd`. El alias `npm run dev:app` también está disponible.

## Carpeta y archivo

Usá **Chrome o Edge de escritorio**, desde localhost o HTTPS. En la primera visita elegí una carpeta de tu PC. El editor recuerda la carpeta en IndexedDB, sin subir los documentos a un servidor. Cada mapa se guarda como `Nombre del nodo raíz.json`. Al editar la raíz, se escribe el nuevo archivo y después se retira la versión anterior. Los caracteres que Windows no permite se reemplazan por `_`; un nombre repetido bloquea el guardado sin sobrescribir el otro mapa. Los archivos anteriores, incluido `mapa-mental.json`, siguen abriéndose.

Al volver, abre el mapa actualizado más recientemente. Si la carpeta está vacía, muestra «Nuevo Mapa Mental» y recién crea el archivo cuando editás. Los cambios se guardan después de 500 ms de inactividad; Ctrl+S permite confirmarlos inmediatamente. No hay botón Guardar ni avisos de estado rutinarios. Los problemas de acceso o escritura muestran una acción para reconectar.

El botón **<** abre la biblioteca con búsqueda, miniaturas y **Crear nuevo**. El menú de cada mapa permite moverlo a la papelera (subcarpeta `.papelera`); desde **Papelera de reciclaje**, hacé clic en el mapa para restaurarlo. Etiquetas, Configuración y Usuario quedan sin acción. No se muestra Importar ni IA desde Doc: esa función pertenece a Mind Elixir App y no está incluida en el paquete Core instalado. Conectar un proveedor como Groq requiere desarrollar la extracción de documentos/URL y la generación y validación del mapa.

En la próxima visita intenta acceder a la carpeta recordada en segundo plano. Si el permiso venció, presioná **Reconectar carpeta** para renovarlo. El navegador controla si concede acceso persistente; la aplicación no puede autorizarse sola. Cambiar de origen, puerto o perfil de navegador cambia también el registro de la carpeta.

El archivo contiene el JSON nativo de Mind Elixir, imágenes locales en base64 y los ajustes en `meta.editor` (formato versión 1). Si el archivo es inválido no se sobrescribe. Si falla una escritura, los cambios permanecen en memoria: reconectá y guardá antes de cerrar la pestaña. El navegador advertirá si intentás salir con cambios pendientes.

## Editor

- `*` activa o desactiva el recorrido cuando no estás escribiendo. El árbol completo conserva su distribución: el grupo local de hojas y su padre se destacan, las demás ramas quedan desvanecidas y el camino hasta la raíz permanece iluminado. `↓` revela la siguiente hermana o destaca el siguiente subárbol; `↑` recupera el paso anterior. La mira acerca la hoja activa y su padre sin retirar el contexto del árbol. El encuadre cambia suavemente, respetando la preferencia de movimiento reducido del navegador. Escape también sale. El recorrido no modifica el archivo, el historial ni la vista original.
- Doble clic o F2: editar. Tab: hijo. Enter: hermano. Ctrl+Enter: padre.
- Arrastrá con el botón central del mouse para mover la pizarra. El icono de mano de la barra izquierda permite moverla arrastrando con el botón izquierdo, incluso sobre los nodos.
- Clic derecho: operaciones del núcleo, relaciones y resúmenes. Arrastrá nodos para reorganizarlos.
- Sin selección, el panel muestra la configuración global. Seleccioná un nodo para ver **General**, **Imagen** y **Nota**. Clic en el fondo para volver a la configuración.
- Los hijos heredan el color de texto de sus padres, salvo que tengan uno propio. Sin colores personalizados, todas las ramas usan el mismo color legible del tema; el blanco predeterminado de la raíz queda reservado a su fondo oscuro. **Limpiar** vuelve a heredar el color.
- La búsqueda encuentra también nodos de ramas plegadas. El icono de mapa alterna con un esquema que comparte documento e historial.
- El teclado de la barra o Shift+/ abre los atajos. Ctrl+Z deshace y Ctrl+Y o Ctrl+Shift+Z rehace.
- La fuente documental acepta texto o una URL como referencia. No se descarga ni analiza ese material.
- Los nodos y el esquema renderizan Markdown y fórmulas con KaTeX: `$E = mc^2$` en línea y `$$…$$` en bloque. Al editar se muestra el código original; se guarda ese texto, no el HTML renderizado. El HTML se sanitiza con DOMPurify.

## Verificación y compilación

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Las pruebas de almacenamiento usan un adaptador de carpeta; las pruebas de navegador simulan el selector y sus permisos. El diálogo nativo debe comprobarse manualmente: elegir una carpeta real, editar, comprobar el archivo en el Explorador, cerrar y volver a abrir el navegador, renovar permisos y probar una carpeta movida o eliminada.

`npm run build` genera `dist/`. Vercel puede usar la configuración incluida; no requiere variables de entorno ni funciones de servidor. Este cambio no publica el proyecto.

El historial Git original se conserva. Se mantiene la licencia MIT en `LICENSE`; las dependencias conservan sus licencias.

## Descendientes, imágenes y exportación

Al seleccionar la raíz, el color y tamaño de su texto, junto con los controles de **Nodos descendientes**, establecen valores predeterminados para todos los mapas de este navegador. Se aplican a mapas existentes, nuevos y exportados, y se conservan después de recargar. Los estilos individuales de los descendientes tienen prioridad. **Limpiar** recupera los valores predeterminados y los cambios admiten deshacer/rehacer. Los valores efectivos también se guardan con el mapa.

**Escape** confirma la edición y conserva la selección, el zoom y la posición. **Ctrl+V** pega una imagen en el nodo seleccionado cuando no estás escribiendo; también podés usar **Pegar imagen del portapapeles** en la pestaña Imagen. Se conservan los píxeles originales en el archivo del mapa.

Desde los tres puntos de una tarjeta de biblioteca, **Exportar** permite descargar **SVG** o **PDF**, incluyendo todas las ramas plegadas. El PDF tiene una sola página adaptada al árbol. Si supera el máximo de 14.400 puntos por lado, se reduce proporcionalmente sin rasterizar las líneas ni los contornos del texto. SVG y PDF usan fuentes Noto redistribuibles para texto normal y fuentes KaTeX para fórmulas; los emojis y caracteres no cubiertos se incrustan como imágenes individuales. Las imágenes mantienen su resolución original. Las imágenes externas requieren acceso CORS; si no se pueden incrustar, la exportación muestra un error.

GitHub Actions se ejecuta únicamente de forma manual: no se compila ni se lanzan pruebas automáticamente al hacer push o abrir un pull request. Desde **Actions → CI → Run workflow**, la opción **cambios** ejecuta las pruebas de carpetas, papelera, valores compartidos, zoom y exportación junto con la compilación. La suite completa sigue disponible como opción manual. Los reportes y archivos de las pruebas de exportación se guardan como artefactos durante siete días.

El zoom admite valores desde 5% hasta 500%, mediante los controles del mapa y la rueda del mouse. **Ctrl+0** vuelve al 100%.

## Carpetas y organización de mapas

**Crear nuevo** despliega **Carpeta** y **Mapa**. Las carpetas son subcarpetas reales del directorio elegido y pueden anidarse. Los mapas nuevos y sus cambios se guardan en la carpeta que estás viendo. Usá la ruta superior para volver a una carpeta anterior o a **Todas las carpetas**.

Solo se muestran carpetas identificadas desde la interfaz mediante un archivo `.arbol-folder.json`; las demás carpetas del directorio no aparecen. Para agregar una carpeta existente, incluso una creada con una versión anterior, elegí **Crear nuevo → Carpeta** y escribí su nombre: se identifica sin modificar los archivos que contiene. Abrir o cerrar el panel de propiedades conserva el desplazamiento y zoom del lienzo.

Arrastrá un mapa sobre una carpeta, sobre la ruta superior o sobre **Biblioteca** para moverlo. Los tres puntos de cada mapa también incluyen **Mover a** y **Copiar a**: aparece una barra inferior que permite recorrer carpetas y confirmar con **Mover aquí** o **Copiar aquí**, o cancelar. Durante esa selección podés crear carpetas. Mover nunca reemplaza un mapa existente; copiar genera nombres como `Original (copia)` cuando hace falta y asigna identificadores nuevos al documento y sus relaciones.

La papelera reúne los mapas de todas las carpetas y muestra su ubicación de origen. Un clic restaura el mapa en esa carpeta. El clic derecho y los tres puntos permiten **Eliminar definitivamente**. **Vaciar** elimina todos los mapas de la papelera, incluso si hay una búsqueda activa; ambas eliminaciones piden confirmación. Los archivos ajenos a los mapas se conservan.
