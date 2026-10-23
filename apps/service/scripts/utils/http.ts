import ky, { type KyInstance } from 'ky'
import { authToken } from '../utils/auth.ts'
import { loadConfig } from '../utils/config.ts'
import { TIMEOUT_MS } from '../utils/http.errors.ts'

const { host, port } = loadConfig().server
const BASE_URL = `http://${host}:${port}`

function HttpClient(): KyInstance {
  return ky.create({
    prefix: BASE_URL,
    timeout: TIMEOUT_MS,
    retry: {
      limit: 3,
      methods: ['get', 'put', 'head', 'delete', 'options', 'trace'],
      statusCodes: [408, 413, 429, 500, 502, 503, 504]
    },
    hooks: {
      beforeRequest: [
        function injectAuth({ request }) {
          const token = authToken.toRead()
          if (token) {
            request.headers.set('Authorization', `Bearer ${token}`)
          }
        }
      ]
    }
  })
}

const http = HttpClient()

export { BASE_URL, http }
