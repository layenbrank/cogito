function haltBubble(event: { stopPropagation(): void }) {
  event.stopPropagation()
}

export { haltBubble }
