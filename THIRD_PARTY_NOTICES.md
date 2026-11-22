# Dependencias y referencias

- **Mind Elixir Core 6.0.3** — Copyright DjZhou y colaboradores, licencia MIT. [Código original](https://github.com/SSShooter/mind-elixir-core). Instalado desde el paquete oficial `mind-elixir`; su licencia se incluye en la distribución npm. Se conserva además la licencia original de este repositorio en `LICENSE`.
- **Mind Elixir App** — referencia visual proporcionada por el usuario. Los paneles de esta app se implementaron aquí; no se incorpora código de su aplicación de escritorio.
- Los iconos de herramientas se dibujan como SVG en `app/icons.ts`. Los pictogramas de nodos son emojis del sistema operativo.
- **marked**, **KaTeX** y **DOMPurify** — renderizado de Markdown y LaTeX mediante la opción `markdown` de Core, con sanitización del HTML. Se incluyen sus licencias en los respectivos paquetes npm. La integración sigue la [documentación oficial](https://docs.mind-elixir.com/docs/advanced-guides/markdown-latex).

- **jsPDF**, **svg2pdf.js** (MIT) y **opentype.js** (MIT): exportación local a PDF y contornos SVG.
- **Noto Serif**, **Noto Sans** y **Noto Sans Mono**, distribuidas por Fontsource (SIL Open Font License 1.1): fuentes redistribuibles usadas al exportar. Las fuentes KaTeX conservan su licencia SIL OFL. Se distribuyen las licencias en `public/licenses/`.
