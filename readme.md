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

Usá **Chrome o Edge de escritorio**, desde localhost o HTTPS. En la primera visita elegí una carpeta de tu PC. El editor trabaja con un único `mapa-mental.json` y recuerda la carpeta en IndexedDB, sin subir el documento a un servidor.

Si el archivo existe, lo abre. Si no existe, muestra «Nuevo Mapa Mental» y recién crea el archivo cuando editás. Los cambios se guardan después de 500 ms de inactividad; el disquete y Ctrl+S guardan inmediatamente. El indicador distingue cambios pendientes, guardado y errores.

En la próxima visita intenta acceder a la carpeta recordada en segundo plano. Si el permiso venció, presioná **Reconectar carpeta** para renovarlo. El navegador controla si concede acceso persistente; la aplicación no puede autorizarse sola. Cambiar de origen, puerto o perfil de navegador cambia también el registro de la carpeta.

El archivo contiene el JSON nativo de Mind Elixir, imágenes locales en base64 y los ajustes en `meta.editor` (formato versión 1). Si el archivo es inválido no se sobrescribe. Si falla una escritura, los cambios permanecen en memoria: reconectá y guardá antes de cerrar la pestaña. El navegador advertirá si intentás salir con cambios pendientes.

## Editor

- Doble clic o F2: editar. Tab: hijo. Enter: hermano. Ctrl+Enter: padre.
- Clic derecho: operaciones del núcleo, relaciones y resúmenes. Arrastrá nodos para reorganizarlos.
- Sin selección, el panel muestra la configuración global. Seleccioná un nodo para ver **General**, **Imagen** y **Nota**. Clic en el fondo para volver a la configuración.
- La búsqueda encuentra también nodos de ramas plegadas. El icono de mapa alterna con un esquema que comparte documento e historial.
- El teclado de la barra o Shift+/ abre los atajos. Ctrl+Z deshace y Ctrl+Y o Ctrl+Shift+Z rehace.
- La fuente documental acepta texto o una URL como referencia. No se descarga ni analiza ese material.

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
