/**
 * 平台键与二进制文件名：契约包 `@cogito/sidecar` 是唯一实现
 * （宿主侧的 `@/host/framework/binaries` 也转发它），这里只是 CLI 内的惯用入口。
 */
export { findBinaryName, findPlatformKey } from '@cogito/sidecar'
