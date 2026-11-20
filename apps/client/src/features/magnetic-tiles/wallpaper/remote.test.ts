import { describe, expect, it } from 'vitest'

import { parseBingArchive, parseCommonsCatalog, parseNasaCatalog } from './remote'

describe('wallpaper remote catalogs', function () {
  it('keeps NASA photos that are wide enough and skips portraits', function () {
    const frames = parseNasaCatalog({
      collection: {
        items: [
          {
            data: [{ title: 'Earth', nasa_id: 'PIA1' }],
            links: [
              { href: 'http://images-assets.nasa.gov/image/PIA1/PIA1~small.jpg', render: 'image', width: 400 },
              { href: 'http://images-assets.nasa.gov/image/PIA1/PIA1~orig.jpg', render: 'image', width: 2400 }
            ]
          },
          {
            data: [{ title: 'Astronaut portrait', nasa_id: 'PIA2' }],
            links: [
              { href: 'https://images-assets.nasa.gov/image/PIA2/PIA2~orig.jpg', render: 'image', width: 3000 }
            ]
          },
          {
            data: [{ title: 'Tiny', nasa_id: 'PIA3' }],
            links: [
              { href: 'https://images-assets.nasa.gov/image/PIA3/PIA3~small.jpg', render: 'image', width: 640 }
            ]
          }
        ]
      }
    })

    expect(frames).toHaveLength(1)
    expect(frames[0]?.src).toBe('https://images-assets.nasa.gov/image/PIA1/PIA1~orig.jpg')
    expect(frames[0]?.thumb).toBe('https://images-assets.nasa.gov/image/PIA1/PIA1~small.jpg')
    expect(frames[0]?.credit).toBe('NASA')
  })

  it('keeps attributed Commons photos and drops non-commercial licenses', function () {
    const frames = parseCommonsCatalog({
      query: {
        pages: {
          '1': {
            title: 'File:Alpine_lake.jpg',
            imageinfo: [
              {
                thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Alpine_lake.jpg/1920px-Alpine_lake.jpg',
                thumbwidth: 1920,
                mime: 'image/jpeg',
                extmetadata: {
                  LicenseShortName: { value: 'CC BY-SA 4.0' },
                  Artist: { value: '<a href="/wiki/User:Ada">Ada</a>' }
                }
              }
            ]
          },
          '2': {
            title: 'File:Reserved.jpg',
            imageinfo: [
              {
                thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b/Reserved.jpg/1920px-Reserved.jpg',
                thumbwidth: 1920,
                mime: 'image/jpeg',
                extmetadata: {
                  LicenseShortName: { value: 'CC BY-NC 4.0' },
                  Artist: { value: 'Bee' }
                }
              }
            ]
          }
        }
      }
    })

    expect(frames).toHaveLength(1)
    expect(frames[0]?.title).toBe('Alpine lake')
    expect(frames[0]?.credit).toBe('Ada · CC BY-SA 4.0')
    expect(frames[0]?.thumb).toContain('/960px-')
  })

  it('builds Bing 1080p urls and collapses the same scene across markets', function () {
    const frames = parseBingArchive({
      images: [
        {
          urlbase: '/th?id=OHR.AlpineLake_ZH-CN1',
          title: '高山湖',
          copyright: '摄影者甲 (Bing China)'
        },
        {
          urlbase: '/th?id=OHR.AlpineLake_EN-US2',
          title: 'Alpine lake',
          copyright: 'Photographer (Bing)'
        }
      ]
    })

    expect(frames).toHaveLength(1)
    expect(frames[0]?.src).toBe('https://www.bing.com/th?id=OHR.AlpineLake_ZH-CN1_1920x1080.jpg')
    expect(frames[0]?.title).toBe('高山湖')
  })
})
