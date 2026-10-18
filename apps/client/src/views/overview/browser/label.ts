function findHost(url: string) {
  if (!url) return '新标签'
  try {
    return new URL(url).hostname || url
  } catch (error) {
    console.error('[browser] 网址无法解析', error)
    return url
  }
}

function findFavicon(url: string) {
  try {
    return `${new URL(url).origin}/favicon.ico`
  } catch (error) {
    console.error('[browser] 图标地址无法解析', error)
    return ''
  }
}

export { findFavicon, findHost }
