import { http } from '@/utils/http/http.ts'

/** @deprecated 桌面端请用 `fetchSiteFavicon`（Tauri `site:fetch-favicon`） */
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

export { GET_TILES, GET_SINGLETON }
