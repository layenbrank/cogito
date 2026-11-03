/**
 * 网页搜索：Tavily / SerpApi / SearXNG / Brave / Firecrawl / Bocha。
 */
import { readWebSearchConfig } from '@/views/knowledge/lib/web-search-config.ts'

interface WebSearchHit {
  title: string
  url: string
  snippet: string
}

async function runWebSearch(query: string): Promise<WebSearchHit[]> {
  const config = readWebSearchConfig()
  if (config.provider === 'none') {
    throw new Error('未配置网页搜索 provider')
  }
  const q = query.trim()
  if (!q) return []

  if (config.provider === 'firecrawl') {
    const base = (config.endpoint || 'https://api.firecrawl.dev').replace(/\/$/, '')
    const response = await fetch(`${base}/v2/search`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({ query: q, limit: 5 })
    })
    if (!response.ok) throw new Error(`Firecrawl HTTP ${response.status}`)
    const json = (await response.json()) as {
      success?: boolean
      data?: { web?: { title?: string; url?: string; description?: string }[] }
      error?: string
    }
    if (json.success === false) {
      throw new Error(json.error || 'Firecrawl search failed')
    }
    const rows = json.data?.web || []
    return rows.slice(0, 5).map(function (item) {
      return {
        title: item.title || item.url || 'result',
        url: item.url || '',
        snippet: item.description || ''
      }
    })
  }

  if (config.provider === 'bocha') {
    const endpoint = (config.endpoint || 'https://api.bochaai.com/v1/web-search').replace(
      /\/$/,
      ''
    )
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({ query: q, count: 5 })
    })
    if (!response.ok) throw new Error(`Bocha HTTP ${response.status}`)
    const json = (await response.json()) as {
      data?: {
        webPages?: {
          value?: { name?: string; url?: string; snippet?: string }[]
        }
      }
    }
    const rows = json.data?.webPages?.value || []
    return rows.slice(0, 5).map(function (item) {
      return {
        title: item.name || item.url || 'result',
        url: item.url || '',
        snippet: item.snippet || ''
      }
    })
  }

  if (config.provider === 'tavily') {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: config.apiKey,
        query: q,
        max_results: 5
      })
    })
    if (!response.ok) throw new Error(`Tavily HTTP ${response.status}`)
    const json = (await response.json()) as {
      results?: { title?: string; url?: string; content?: string }[]
    }
    return (json.results || []).map(function (item) {
      return {
        title: item.title || item.url || 'result',
        url: item.url || '',
        snippet: item.content || ''
      }
    })
  }

  if (config.provider === 'serpapi') {
    const url = new URL('https://serpapi.com/search.json')
    url.searchParams.set('q', q)
    url.searchParams.set('api_key', config.apiKey)
    const response = await fetch(url.toString())
    if (!response.ok) throw new Error(`SerpApi HTTP ${response.status}`)
    const json = (await response.json()) as {
      organic_results?: { title?: string; link?: string; snippet?: string }[]
    }
    return (json.organic_results || []).slice(0, 5).map(function (item) {
      return {
        title: item.title || item.link || 'result',
        url: item.link || '',
        snippet: item.snippet || ''
      }
    })
  }

  if (config.provider === 'brave') {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}`,
      {
        headers: {
          accept: 'application/json',
          'x-subscription-token': config.apiKey
        }
      }
    )
    if (!response.ok) throw new Error(`Brave HTTP ${response.status}`)
    const json = (await response.json()) as {
      web?: { results?: { title?: string; url?: string; description?: string }[] }
    }
    return (json.web?.results || []).slice(0, 5).map(function (item) {
      return {
        title: item.title || item.url || 'result',
        url: item.url || '',
        snippet: item.description || ''
      }
    })
  }

  // searxng
  const endpoint = (config.endpoint || '').replace(/\/$/, '')
  if (!endpoint) throw new Error('SearXNG endpoint 未配置')
  const response = await fetch(
    `${endpoint}/search?q=${encodeURIComponent(q)}&format=json`,
    {
      headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}
    }
  )
  if (!response.ok) throw new Error(`SearXNG HTTP ${response.status}`)
  const json = (await response.json()) as {
    results?: { title?: string; url?: string; content?: string }[]
  }
  return (json.results || []).slice(0, 5).map(function (item) {
    return {
      title: item.title || item.url || 'result',
      url: item.url || '',
      snippet: item.content || ''
    }
  })
}

export { runWebSearch }
export type { WebSearchHit }
