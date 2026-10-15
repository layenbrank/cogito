import type { CaptureKind, GalleryMedia } from '@/views/gallery/model/media'

interface RetentionPolicy {
  days: number
  count: number
  maxBytes: number
}

interface CapturePolicies {
  screenshot: RetentionPolicy
  recording: RetentionPolicy
}

type PruneReason = 'days' | 'count' | 'size'

interface PruneHint {
  willPrune: boolean
  reason?: PruneReason
  daysLeft?: number
}

const DAY_MS = 86_400_000

function findPolicy(
  policies: CapturePolicies,
  kind: CaptureKind | undefined
): RetentionPolicy {
  if (kind === 'recording') return policies.recording
  return policies.screenshot
}

/**
 * 与 Rust `find_prune_ids` 同口径的前端角标提示。
 */
function findPruneHints(
  items: GalleryMedia[],
  policies: CapturePolicies,
  now = Date.now()
): Map<string, PruneHint> {
  const hints = new Map<string, PruneHint>()

  for (const kind of ['screenshot', 'recording'] as const) {
    const policy = policies[kind]
    const group = items
      .filter(function (media) {
        if (media.meta.source !== 'capture') return false
        if (media.meta.keep === true) return false
        if (media.meta.state === 'recording') return false
        const captureKind = media.meta.captureKind ?? 'screenshot'
        return captureKind === kind
      })
      .slice()
      .sort(function (a, b) {
        return b.capturedAt - a.capturedAt
      })

    const cutoff = now - policy.days * DAY_MS
    const reasons = new Map<string, PruneReason>()

    for (const media of group) {
      if (media.capturedAt < cutoff) {
        reasons.set(media.asset.id, 'days')
      }
    }

    if (policy.count > 0) {
      for (const media of group.slice(policy.count)) {
        if (!reasons.has(media.asset.id)) reasons.set(media.asset.id, 'count')
      }
    } else {
      for (const media of group) {
        if (!reasons.has(media.asset.id)) reasons.set(media.asset.id, 'count')
      }
    }

    let used = 0
    for (const media of group) {
      used += media.asset.size ?? 0
      if (used > policy.maxBytes && !reasons.has(media.asset.id)) {
        reasons.set(media.asset.id, 'size')
      }
    }

    for (const media of group) {
      const reason = reasons.get(media.asset.id)
      if (!reason) {
        const daysLeft = Math.max(
          0,
          Math.ceil((media.capturedAt + policy.days * DAY_MS - now) / DAY_MS)
        )
        hints.set(media.asset.id, { willPrune: false, daysLeft })
        continue
      }
      const daysLeft =
        reason === 'days'
          ? 0
          : Math.max(0, Math.ceil((media.capturedAt + policy.days * DAY_MS - now) / DAY_MS))
      hints.set(media.asset.id, { willPrune: true, reason, daysLeft })
    }
  }

  for (const media of items) {
    if (hints.has(media.asset.id)) continue
    if (media.meta.keep === true) {
      hints.set(media.asset.id, { willPrune: false })
    }
  }

  return hints
}

export { findPolicy, findPruneHints }
export type { CapturePolicies, PruneHint, PruneReason, RetentionPolicy }
