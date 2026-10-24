import { API_PATHS } from '@/constants/api'
import { requestJson } from '@/api/http'
import type { MagneticTile } from '@/types/magnetic-tile'
import type { RSF } from '@/types/response'

interface ApplicationTileLike {
  id?: string
  title?: string
  url?: string | null
  size?: 1 | 2 | 3 | 4
  shape?: MagneticTile['shape']
  component?: MagneticTile['component']
  description?: string
  background?: MagneticTile['background']
  textColor?: string | null
  mark?: string | null
}

/**
 * GET /api/v1/application/toRead — optional remote tile-shaped app config.
 */
async function GET_APPLICATION(): Promise<RSF<ApplicationTileLike | ApplicationTileLike[]>> {
  return requestJson<ApplicationTileLike | ApplicationTileLike[]>(API_PATHS.APPLICATION_TO_READ)
}

export type { ApplicationTileLike }
export { GET_APPLICATION }
