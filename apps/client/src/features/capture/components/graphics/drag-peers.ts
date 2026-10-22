interface GraphicsPeer {
  id: string
  locked?: boolean
  groupID?: string
}

/** 拖拽同伴：当前选中集中除自身外的未锁定项（群组完整性依赖选中时已 expand） */
function findDragPeerIDs(
  annotation: GraphicsPeer,
  list: GraphicsPeer[],
  selectedIDs: string[]
): string[] {
  // 组内成员由外层组合节点统一拖动，不再参与 peer 同步
  if (annotation.groupID) return []
  if (selectedIDs.length <= 1 || !selectedIDs.includes(annotation.id)) return []
  return selectedIDs.filter(function (id) {
    if (id === annotation.id) return false
    const peer = list.find(function (item) {
      return item.id === id
    })
    return peer ? !peer.locked && !peer.groupID : false
  })
}

export { findDragPeerIDs }
