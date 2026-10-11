interface GraphicsPeer {
  id: string
  locked?: boolean
}

/** 拖拽同伴：当前选中集中除自身外的未锁定项（群组完整性依赖选中时已 expand） */
function findDragPeerIDs(
  annotation: GraphicsPeer,
  list: GraphicsPeer[],
  selectedIDs: string[]
): string[] {
  if (selectedIDs.length <= 1 || !selectedIDs.includes(annotation.id)) return []
  return selectedIDs.filter(function (id) {
    if (id === annotation.id) return false
    const peer = list.find(function (item) {
      return item.id === id
    })
    return peer ? !peer.locked : false
  })
}

export { findDragPeerIDs }
