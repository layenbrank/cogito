function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch (error) {
    // 百分号编码本身就可能是坏的（URL 来自外部）：原样返回是预期行为，但要留痕
    console.debug('[utils] URI 解码失败，按原文返回:', error)
    return value
  }
}

export { safeDecodeURIComponent }
