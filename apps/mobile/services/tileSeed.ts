import type { MagneticTile } from '@/types/magnetic-tile'

const MIRROR_ID = 'mobile-mirror'
const STAMP = Date.now()

const SEED_SITES: { url: string; title: string; color: string }[] = [
  { url: 'https://github.com/layenbrank/i-thinking', title: 'Studio', color: '#0F766E' },
  { url: 'https://github.com/layenbrank/corex', title: 'CoreX', color: '#1D4ED8' },
  { url: 'https://github.com/layenbrank/rust-service', title: 'Service', color: '#B45309' },
  { url: 'https://docs.expo.dev/versions/v54.0.0/', title: 'Expo 54', color: '#000020' }
]

/**
 * Builds the default magnetic-tile mirror for a signed-in user.
 */
function createSeedTiles(): MagneticTile[] {
  const navigationTiles: MagneticTile[] = SEED_SITES.map(function (site, index) {
    return {
      id: `tile-nav-${index}`,
      index,
      title: site.title,
      url: site.url,
      round: '16',
      mark: [...site.title].at(0) ?? null,
      size: 1,
      shape: 'square',
      direction: 'horizontal',
      mirrorID: MIRROR_ID,
      updatedAt: STAMP,
      createdAt: STAMP,
      textColor: '#FFFFFF',
      component: 'navigation',
      description: site.title,
      collectionID: null,
      downloadCount: 0,
      background: { color: site.color },
      backdrop: null,
      archivedAt: null
    }
  })

  const featureTiles: MagneticTile[] = [
    {
      id: 'tile-clock',
      index: navigationTiles.length,
      title: 'Clock',
      url: null,
      round: '16',
      mark: null,
      size: 2,
      shape: 'rectangle',
      direction: 'horizontal',
      mirrorID: MIRROR_ID,
      updatedAt: STAMP,
      createdAt: STAMP,
      textColor: '#0F172A',
      component: 'clock',
      description: 'Local clock',
      collectionID: null,
      downloadCount: 0,
      background: { color: '#E2E8F0' },
      backdrop: null,
      archivedAt: null
    },
    {
      id: 'tile-markdown',
      index: navigationTiles.length + 1,
      title: 'Notes',
      url: null,
      round: '16',
      mark: 'M',
      size: 2,
      shape: 'rectangle',
      direction: 'horizontal',
      mirrorID: MIRROR_ID,
      updatedAt: STAMP,
      createdAt: STAMP,
      textColor: '#0F172A',
      component: 'markdown',
      description: 'Markdown snippet',
      collectionID: null,
      downloadCount: 0,
      background: { color: '#FEF3C7' },
      backdrop: null,
      archivedAt: null,
      content: '# i-thinking\n\n磁贴首页 + Agent\n\n- Studio 参考\n- rust-service gateway'
    },
    {
      id: 'tile-intelligence',
      index: navigationTiles.length + 2,
      title: 'Agent',
      url: 'agent',
      round: '16',
      mark: 'A',
      size: 2,
      shape: 'rectangle',
      direction: 'horizontal',
      mirrorID: MIRROR_ID,
      updatedAt: STAMP,
      createdAt: STAMP,
      textColor: '#FFFFFF',
      component: 'intelligence',
      description: 'Open agent chat',
      collectionID: null,
      downloadCount: 0,
      background: { color: '#0F766E' },
      backdrop: null,
      archivedAt: null,
      content: '打开 Agent，通过 rust-service gateway 对话。'
    }
  ]

  return [...navigationTiles, ...featureTiles]
}

export { MIRROR_ID, createSeedTiles }
