import {
  DEVICE_PRESETS,
  buildDevice,
  clampFit,
  describeDevice,
  describeDpr,
  findPreset,
  findPresetById,
  fitFor,
  isUsableDevice,
  rotateDevice
} from './device'

describe('DEVICE_PRESETS', function () {
  it('预设齐全且字段可用', function () {
    const ids = DEVICE_PRESETS.map(function (preset) {
      return preset.id
    })
    expect(ids).toEqual([
      'iphone-15-pro',
      'iphone-se',
      'pixel-8',
      'ipad-mini',
      'android',
      'desktop'
    ])
    for (const preset of DEVICE_PRESETS) {
      expect(preset.width).toBeGreaterThan(0)
      expect(preset.height).toBeGreaterThan(0)
      expect(preset.name.length).toBeGreaterThan(0)
      // 移动端预设必须带 UA 与 DPR，否则「移动模拟」只改了几何
      if (preset.mobile) {
        expect(preset.userAgent).toContain('Mozilla/5.0')
        expect(preset.dpr).not.toBeNull()
      }
    }
  })

  it('iPhone 15 Pro 与 Pixel 8 的关键参数与 Rust 预设一致', function () {
    const iphone = findPresetById('iphone-15-pro')
    expect(iphone?.width).toBe(393)
    expect(iphone?.height).toBe(852)
    expect(iphone?.dpr).toBe(3)

    const pixel = findPresetById('pixel-8')
    expect(pixel?.width).toBe(412)
    expect(pixel?.height).toBe(915)
    expect(pixel?.dpr).toBe(2.625)

    // 桌面预设：不覆盖 DPR、不覆盖 UA
    const desktop = findPresetById('desktop')
    expect(desktop?.mobile).toBe(false)
    expect(desktop?.dpr).toBeNull()
    expect(desktop?.userAgent).toBeNull()
  })
})

describe('fitFor', function () {
  const iphone = { width: 393, height: 852, dpr: 3, mobile: true, userAgent: null }

  it('按宽高取小者，且不超过 1', function () {
    expect(fitFor(iphone, { width: 786, height: 1704 })).toBe(1)
    expect(fitFor(iphone, { width: 196.5, height: 2000 })).toBeCloseTo(0.5, 5)
    // 高度不够时由高度决定
    expect(fitFor(iphone, { width: 2000, height: 426 })).toBeCloseTo(0.5, 5)
  })

  it('面板没量出来时按 1 处理', function () {
    expect(fitFor(iphone, { width: 0, height: 0 })).toBe(1)
    expect(fitFor(iphone, { width: -10, height: 20 })).toBe(1)
  })

  it('夹在下限以上，避免缩成一条线', function () {
    expect(fitFor(iphone, { width: 1, height: 1 })).toBe(0.1)
  })
})

describe('clampFit', function () {
  it('夹取与非法值兜底', function () {
    expect(clampFit(0)).toBe(0.1)
    expect(clampFit(9)).toBe(1)
    expect(clampFit(Number.NaN)).toBe(1)
    expect(clampFit(Number.POSITIVE_INFINITY)).toBe(1)
    expect(clampFit(0.42)).toBe(0.42)
  })
})

describe('rotateDevice', function () {
  it('宽高互换，其余不变', function () {
    const phone = { width: 393, height: 852, dpr: 3, mobile: true, userAgent: 'ua' }
    const rotated = rotateDevice(phone)
    expect(rotated.width).toBe(852)
    expect(rotated.height).toBe(393)
    expect(rotated.dpr).toBe(3)
    expect(rotated.mobile).toBe(true)
    expect(rotated.userAgent).toBe('ua')
    // 不改原对象
    expect(phone.width).toBe(393)
  })

  it('转两次回到原样', function () {
    const phone = { width: 393, height: 852, dpr: 3, mobile: true, userAgent: null }
    expect(rotateDevice(rotateDevice(phone))).toEqual(phone)
  })
})

describe('findPreset', function () {
  it('按尺寸认预设（含旋转）', function () {
    expect(findPreset({ width: 393, height: 852, dpr: null, mobile: true, userAgent: null })?.id).toBe(
      'iphone-15-pro'
    )
    // 横屏也认得出是同一台机器
    expect(findPreset({ width: 852, height: 393, dpr: null, mobile: true, userAgent: null })?.id).toBe(
      'iphone-15-pro'
    )
    expect(findPreset({ width: 320, height: 480, dpr: null, mobile: true, userAgent: null })).toBeNull()
    expect(findPreset(null)).toBeNull()
  })
})

describe('describeDevice', function () {
  const iphone = { width: 393, height: 852, dpr: 3, mobile: true, userAgent: null }

  it('预设 / 自定义 / 桌面三种文案', function () {
    expect(describeDevice(iphone, 0.92)).toBe('iPhone 15 Pro · 393×852 · 92%')
    expect(describeDevice({ ...iphone, width: 320, height: 480 }, 1)).toBe('自定义 · 320×480 · 100%')
    expect(describeDevice(null)).toBe('桌面')
  })

  it('百分比取自夹取后的 fit', function () {
    expect(describeDevice(iphone, 9)).toBe('iPhone 15 Pro · 393×852 · 100%')
    expect(describeDevice(iphone, 0)).toBe('iPhone 15 Pro · 393×852 · 10%')
  })
})

describe('describeDpr', function () {
  it('null 显示跟随系统', function () {
    expect(describeDpr({ width: 1440, height: 900, dpr: null, mobile: false, userAgent: null })).toBe(
      'DPR 跟随系统'
    )
    expect(describeDpr({ width: 393, height: 852, dpr: 3, mobile: true, userAgent: null })).toBe(
      'DPR 3'
    )
  })
})

describe('buildDevice', function () {
  it('合法输入取整并补默认值', function () {
    expect(buildDevice({ width: 360.4, height: 780.6, dpr: 3 })).toEqual({
      width: 360,
      height: 781,
      dpr: 3,
      mobile: true,
      userAgent: null
    })
  })

  it('非法宽高返回 null', function () {
    expect(buildDevice({ width: 0, height: 780, dpr: 3 })).toBeNull()
    expect(buildDevice({ width: Number.NaN, height: 780, dpr: 3 })).toBeNull()
    expect(buildDevice({ width: -1, height: -1, dpr: null })).toBeNull()
  })

  it('DPR 非法时退回跟随系统，空白 UA 视为不覆盖', function () {
    const device = buildDevice({ width: 360, height: 780, dpr: 0, userAgent: '   ' })
    expect(device?.dpr).toBeNull()
    expect(device?.userAgent).toBeNull()
  })
})

describe('isUsableDevice', function () {
  it('只有正宽高才算可用', function () {
    expect(isUsableDevice({ width: 393, height: 852, dpr: 3, mobile: true, userAgent: null })).toBe(
      true
    )
    expect(isUsableDevice({ width: 0, height: 852, dpr: 3, mobile: true, userAgent: null })).toBe(
      false
    )
    expect(isUsableDevice(null)).toBe(false)
  })
})
