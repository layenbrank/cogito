type PicsumImage = {
  id: string
  seed?: string
}

const PICSUM_BASE = 'https://picsum.photos'
const PICSUM_LIMIT = 12

function buildFallbackImages(): PicsumImage[] {
  return Array.from({ length: PICSUM_LIMIT }, function (_item, index) {
    return {
      id: `fallback-${index}`,
      seed: `customize-${index}`
    }
  })
}

async function fetchPicsumImages(): Promise<PicsumImage[]> {
  try {
    const response = await fetch(`${PICSUM_BASE}/v2/list?limit=${PICSUM_LIMIT}`)
    if (!response.ok) throw new Error('picsum list failed')

    const parsed = (await response.json()) as Array<{ id: string | number }>
    return parsed.map(function (item) {
      return { id: String(item.id) }
    })
  } catch {
    return buildFallbackImages()
  }
}

let cachedImages: PicsumImage[] | undefined
const listeners = new Set<() => void>()

const PICSUM_IMAGES_PROMISE = fetchPicsumImages().then(function (images) {
  cachedImages = images
  listeners.forEach(function (listener) {
    listener()
  })
  return images
})

function subscribePicsumImages(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  void PICSUM_IMAGES_PROMISE.then(function () {
    onStoreChange()
  })
  return function () {
    listeners.delete(onStoreChange)
  }
}

function readPicsumImages(): PicsumImage[] {
  return cachedImages ?? []
}

function picsumImagesReady(): boolean {
  return cachedImages !== undefined
}

export type { PicsumImage }
export { PICSUM_IMAGES_PROMISE, picsumImagesReady, readPicsumImages, subscribePicsumImages }
