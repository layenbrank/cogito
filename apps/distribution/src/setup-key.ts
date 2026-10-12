/**
 * 读侧白名单：只有「版本路径下的安装包」可以直接下载（写侧不限 key）。
 *
 * 宿主 worker 与上传脚本共用这一份 —— 上传前先按它校验，避免传完 300MB 才发现读不回来。
 */
const SETUP_KEY = /^\d+\.\d+\.\d+\/[\w.-]+-setup\.exe$/

function isSetupKey(key: string): boolean {
  return SETUP_KEY.test(key)
}

export { SETUP_KEY, isSetupKey }
