import TurndownService from 'turndown'

import { joinFrontMatter } from '@/views/knowledge/lib/front-matter.ts'

function makeTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**'
  })

  service.addRule('taskListItem', {
    filter(node) {
      const element = node
      if (element.nodeName !== 'LI') return false
      if (element.getAttribute('data-type') === 'taskItem') return true
      return Boolean(element.querySelector('input[type="checkbox"]'))
    },
    replacement(content, node) {
      const element = node
      const checkbox = element.querySelector('input[type="checkbox"]')
      const isChecked =
        element.getAttribute('data-checked') === 'true' ||
        (checkbox instanceof HTMLInputElement && checkbox.checked)
      const marker = isChecked ? '[x]' : '[ ]'
      const text = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '')
        .replace(/^\s+/, '')
      return `- ${marker} ${text}\n`
    }
  })

  service.addRule('strikethrough', {
    filter: ['del', 's'] as unknown as TurndownService.Filter,
    replacement(content) {
      return `~~${content}~~`
    }
  })

  service.addRule('underline', {
    filter: ['u'] as unknown as TurndownService.Filter,
    replacement(content) {
      return content
    }
  })

  service.addRule('table', {
    filter: 'table',
    replacement(_content, node) {
      const table = node as HTMLTableElement
      const rows = Array.from(table.querySelectorAll('tr'))
      if (rows.length === 0) return ''

      const lines: string[] = []
      rows.forEach(function (row, rowIndex) {
        const cells = Array.from(row.querySelectorAll('th, td'))
        const values = cells.map(function (cell) {
          return (cell.textContent ?? '').trim().replace(/\|/g, '\\|')
        })
        lines.push(`| ${values.join(' | ')} |`)
        if (rowIndex === 0) {
          lines.push(`| ${values.map(function () {
            return '---'
          }).join(' | ')} |`)
        }
      })
      return `\n${lines.join('\n')}\n\n`
    }
  })

  service.addRule('mathBlock', {
    filter(node) {
      return (
        node.nodeName === 'DIV' &&
        (node).getAttribute('data-type') === 'math-block'
      )
    },
    replacement(_content, node) {
      const formula =
        (node).getAttribute('data-formula') ||
        (node).textContent ||
        ''
      return `\n\n$$\n${formula.trim()}\n$$\n\n`
    }
  })

  service.addRule('mathInline', {
    filter(node) {
      return (
        node.nodeName === 'SPAN' &&
        (node).getAttribute('data-type') === 'math-inline'
      )
    },
    replacement(_content, node) {
      const formula =
        (node).getAttribute('data-formula') ||
        (node).textContent ||
        ''
      return `$${formula.trim()}$`
    }
  })

  service.addRule('mermaidBlock', {
    filter(node) {
      return (
        node.nodeName === 'DIV' &&
        (node).getAttribute('data-type') === 'mermaid-block'
      )
    },
    replacement(_content, node) {
      const source =
        (node).getAttribute('data-source') ||
        (node).textContent ||
        ''
      return `\n\n\`\`\`mermaid\n${source.trim()}\n\`\`\`\n\n`
    }
  })

  return service
}

const turndown = makeTurndown()

function serializeHtmlToMarkdown(html: string, frontMatter: string | null = null): string {
  const body = turndown.turndown(html)
  return joinFrontMatter(frontMatter, body)
}

export { serializeHtmlToMarkdown }
