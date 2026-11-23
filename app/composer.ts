export function listEdit(value: string, start: number, end: number, ordered: boolean) {
  const from = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1
  const next = value.indexOf('\n', end)
  const to = next < 0 ? value.length : next
  const lines = value.slice(from, to).split('\n')
  const same = lines.every(line => ordered ? /^\s*\d+[.)] /.test(line) : /^\s*[-*+] /.test(line))
  const text = lines.map((line, index) => {
    const indent = /^\s*/.exec(line)![0]
    const content = line.slice(indent.length).replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    return `${indent}${same ? '' : ordered ? `${index + 1}. ` : '- '}${content}`
  }).join('\n')
  return { from, to, text }
}
export function listNewline(value: string, start: number, end: number) {
  const from = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1
  const line = value.slice(from, start)
  const match = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
  if (!match) return { from: start, to: end, text: '\n' }
  if (!match[3].trim()) return { from, to: end, text: '' }
  const marker = /^\d/.test(match[2]) ? `${parseInt(match[2]) + 1}.` : match[2]
  return { from: start, to: end, text: `\n${match[1]}${marker} ` }
}
