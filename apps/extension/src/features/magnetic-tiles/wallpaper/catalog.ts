/**
 * 磁贴画册用的离线 NASA 直链。壁纸库页面的大批量图在 `remote.ts`：
 * NASA 检索（公有领域）、维基共享精选（CC BY / CC BY-SA，须署名）、必应每日（摄影师版权，个人壁纸）。
 *
 * 许可（NASA Media Usage Guidelines，https://www.nasa.gov/nasa-brand-center/images-and-media/）：
 * NASA 影像在美国境内一般不受版权保护，可用于网页与商业信息用途，无需另行许可。
 * 须署名 NASA，且不得暗示 NASA 为产品背书。画面不含可辨认人员。
 *
 * Unsplash、Pexels 的 API 禁止做成壁纸类应用。Pixabay 的 API 禁止长期热链。
 */
interface WallpaperFrame {
  src: string
  /** 胶片条用的小图；缺省时用 src */
  thumb?: string
  title: string
  credit: string
}

const WALLPAPER_FRAMES: readonly WallpaperFrame[] = [
  {
    src: 'https://images-assets.nasa.gov/image/as17-148-22727/as17-148-22727~medium.jpg',
    title: '地球',
    credit: 'NASA'
  },
  {
    src: 'https://images-assets.nasa.gov/image/as08-14-2383/as08-14-2383~medium.jpg',
    title: '地出',
    credit: 'NASA'
  },
  {
    src: 'https://images-assets.nasa.gov/image/PIA18033/PIA18033~medium.jpg',
    title: '蓝弹珠',
    credit: 'NASA'
  },
  {
    src: 'https://images-assets.nasa.gov/image/as11-44-6551/as11-44-6551~medium.jpg',
    title: '月缘',
    credit: 'NASA'
  },
  {
    src: 'https://images-assets.nasa.gov/image/PIA01341/PIA01341~medium.jpg',
    title: '太阳系',
    credit: 'NASA'
  },
  {
    src: 'https://images-assets.nasa.gov/image/PIA12348/PIA12348~medium.jpg',
    title: '银心',
    credit: 'NASA'
  }
]

function parseWallpaperFrame(url: string | null | undefined, title: string): WallpaperFrame {
  const trimmed = url?.trim() ?? ''
  const known = WALLPAPER_FRAMES.find(function (frame) {
    return frame.src === trimmed
  })
  if (known) return known
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return { src: trimmed, title, credit: '' }
  }
  return WALLPAPER_FRAMES[0]
}

/** 磁贴 url 指向库中某张时，把它排到画册最前 */
function orderWallpaperLibrary(url: string | null | undefined): readonly WallpaperFrame[] {
  const trimmed = url?.trim() ?? ''
  const index = WALLPAPER_FRAMES.findIndex(function (frame) {
    return frame.src === trimmed
  })
  if (index <= 0) return WALLPAPER_FRAMES
  const picked = WALLPAPER_FRAMES[index]
  return [
    picked,
    ...WALLPAPER_FRAMES.slice(0, index),
    ...WALLPAPER_FRAMES.slice(index + 1)
  ]
}

export { WALLPAPER_FRAMES, orderWallpaperLibrary, parseWallpaperFrame }
export type { WallpaperFrame }
