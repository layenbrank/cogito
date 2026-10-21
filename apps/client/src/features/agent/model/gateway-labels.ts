/**
 * 网关目录展示名缓存：由 `syncCogitoGatewayCatalog` 写入，选择器读。
 * 单独成文件，避免 display ↔ cogito-provider 互相拖入重依赖。
 */

let labelByName: Record<string, string> = {}

function rememberGatewayLabels(entries: { name: string; label?: string | null }[]): void {
  const next: Record<string, string> = {}
  for (const entry of entries) {
    const label = entry.label?.trim()
    if (label) next[entry.name] = label
  }
  labelByName = next
}

function clearGatewayLabels(): void {
  labelByName = {}
}

/** 服务端下发的展示名；没有就回落 null（由 `findModelLabel` 继续美化 id） */
function findGatewayModelLabel(modelName: string): string | null {
  return labelByName[modelName] ?? null
}

export { clearGatewayLabels, findGatewayModelLabel, rememberGatewayLabels }
