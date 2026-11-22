import { Marked, type Token } from 'marked'
import katex from 'katex'
import DOMPurify from 'dompurify'
import 'katex/dist/katex.min.css'

type MathToken = Token & { math: string; display: boolean }
const mathHtml = (token: MathToken) => katex.renderToString(token.math.trim(), {
  displayMode: token.display, throwOnError: false, trust: false,
  maxExpand: 1000, maxSize: 20,
})

// Tokenize math before Markdown consumes LaTeX backslashes and underscores.
// Code spans and code blocks keep their literal source through marked's parser.
const parser = new Marked({ gfm: true, breaks: true, extensions: [
  {
    name: 'blockMath', level: 'block',
    tokenizer(source) {
      const match = /^ {0,3}\$\$[ \t]*\n([\s\S]+?)\n[ \t]*\$\$[ \t]*(?:\n|$)/.exec(source)
      if (match) return { type: 'blockMath', raw: match[0], math: match[1], display: true }
    },
    renderer: token => mathHtml(token as MathToken),
  },
  {
    name: 'inlineMath', level: 'inline',
    start: source => source.indexOf('$'),
    tokenizer(source) {
      const block = /^\$\$([\s\S]+?)\$\$/.exec(source)
      const inline = /^\$([^$\n]+?)\$(?!\$)/.exec(source)
      const match = block ?? inline
      if (match) return { type: 'inlineMath', raw: match[0], math: match[1], display: !!block }
    },
    renderer: token => mathHtml(token as MathToken),
  },
] })

DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(parser.parse(source, { async: false }).trim(), {
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  })
}
