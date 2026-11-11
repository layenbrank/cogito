import { http } from '@/utils/http/http.ts'

function GET_SINGLETON(id: string) {
  return http.get(`/magnetic-tile/singleton/${id}`, {
    env: 'cogito'
  })
}

export { GET_SINGLETON }
