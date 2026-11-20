import Sortable from 'sortablejs'

/** 墙面磁贴拖拽。松手后先把 DOM 还原给 React，再按 data-id 序落库。 */
function bindWallSortable(container: HTMLElement, onReorder: (ids: string[]) => void): { destroy(): void } {
  const sortable = Sortable.create(container, {
    animation: 150,
    draggable: '.magnetic-tile',
    dataIdAttr: 'data-id',
    delay: 80,
    delayOnTouchOnly: false,
    touchStartThreshold: 8,
    forceFallback: true,
    fallbackOnBody: true,
    fallbackTolerance: 3,
    ghostClass: 'magnetic-tile-ghost',
    chosenClass: 'magnetic-tile-chosen',
    dragClass: 'magnetic-tile-drag',
    onStart(event) {
      event.item.classList.add('dragging')
    },
    onEnd(event) {
      event.item.classList.remove('dragging')
      const from = event.oldIndex
      const to = event.newIndex
      if (from === undefined || to === undefined || from === to) return

      const ids = sortable.toArray()
      const parent = event.from
      const item = event.item
      const children = parent.children
      if (from < to) parent.insertBefore(item, children[from] ?? null)
      else parent.insertBefore(item, children[from + 1] ?? null)
      if (ids.length) onReorder(ids)
    }
  })

  return {
    destroy() {
      sortable.destroy()
    }
  }
}

export { bindWallSortable }
