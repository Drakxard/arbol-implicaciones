import MindElixir, { type NodeObj, type Theme, type MainLineParams, type SubLineParams } from 'mind-elixir'
import type { EditorSettings } from './document'

export function themeFor(settings: EditorSettings): Theme {
  const base = settings.theme === 'Oscuro' ? MindElixir.DARK_THEME : MindElixir.THEME
  const theme: Theme = { ...base, name: settings.theme, palette: [...base.palette], cssVar: { ...base.cssVar } }
  const css = theme.cssVar!
  if (settings.theme === 'Claro') css['--bgcolor'] = '#ffffff'
  if (settings.theme !== 'Oscuro') css['--main-color'] = '#000000'
  css['--color'] = css['--main-color']
  if (settings.textColor) css['--root-color'] = css['--main-color'] = css['--color'] = settings.textColor
  if (settings.rootColor) css['--root-color'] = settings.rootColor
  if (settings.branchStyle !== 'curve') {
    const branch = ({ pL, pT, pW, pH, cL, cT, cW, cH, direction }: MainLineParams | SubLineParams) => {
      const left = direction === 'lhs', down = direction === 'down'
      const x1 = down ? pL + pW / 2 : left ? pL : pL + pW
      const y1 = down ? pT + pH : pT + pH / 2
      const x2 = down ? cL + cW / 2 : left ? cL + cW : cL
      const y2 = down ? cT : cT + cH / 2
      return settings.branchStyle === 'straight' ? `M ${x1} ${y1} L ${x2} ${y2}` : down
        ? `M ${x1} ${y1} V ${(y1 + y2) / 2} H ${x2} V ${y2}`
        : `M ${x1} ${y1} H ${(x1 + x2) / 2} V ${y2} H ${x2}`
    }
    theme.generateMainBranch = branch; theme.generateSubBranch = branch
  }
  return theme
}

export function textColor(node: NodeObj, settings: EditorSettings, container: HTMLElement): string {
  if (!node.parent && settings.rootColor) return settings.rootColor
  let ancestor: NodeObj | undefined = node
  while (ancestor) {
    // The separate descendant default takes precedence over the root's own color.
    if (node.parent && !ancestor.parent && settings.descendantColor) return settings.descendantColor
    if (node.parent && !ancestor.parent && settings.rootColor) return settings.rootColor
    if (ancestor.style?.color) return ancestor.style.color
    ancestor = ancestor.parent
  }
  return getComputedStyle(container).getPropertyValue(node.parent ? '--main-color' : '--root-color').trim()
    || (node.parent ? '#000000' : '#ffffff')
}

export function styleDescendants(mind: MindElixir, settings: EditorSettings) {
  let resized = false
  for (const element of mind.container.querySelectorAll<HTMLElement & { nodeObj: NodeObj }>('.me-tpc')) {
    const node = element.nodeObj
    if (!node) continue
    element.style.color = textColor(node, settings, mind.container)
    const size = node.parent ? node.style?.fontSize || `${settings.descendantFontSize ?? 16}px`
      : settings.rootFontSize !== null ? `${settings.rootFontSize}px` : node.style?.fontSize || '25px'
    if (element.style.fontSize !== size) { element.style.fontSize = size; resized = true }
  }
  if (resized) mind.linkDiv()
}
