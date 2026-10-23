import { http } from '@/utils/http/http.ts'
import { safeDecodeURIComponent } from '@/utils/safe-decode.ts'

function GET_TILES() {
  return http.get('/magnetic-tile', {
    env: 'cogito'
  })
}

function GET_SINGLETON(id: string) {
  return http.get(`/magnetic-tile/singleton/${id}`, {
    env: 'cogito'
  })
}

function GET_FAVICON(url: string) {
  return http.get('/magnetic-tile/favicon', {
    query: {
      url: safeDecodeURIComponent(url)
    },
    env: 'cogito'
  })
}

export { GET_TILES, GET_FAVICON, GET_SINGLETON }
