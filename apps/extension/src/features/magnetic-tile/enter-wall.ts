/** 按镜像记是否已播过磁贴入场；回到镜像 / Activity 再 visible 时不再重播 */
const enteredMirrors = new Set<string>()

function hasWallEntered(mirrorId: string | null | undefined) {
  if (!mirrorId) return false
  return enteredMirrors.has(mirrorId)
}

function markWallEntered(mirrorId: string | null | undefined) {
  if (!mirrorId) return
  enteredMirrors.add(mirrorId)
}

export { hasWallEntered, markWallEntered }
