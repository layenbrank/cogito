/** 各环境的 baseURL 映射（对应 .env 的 VITE_* 变量） */
const ENV_URLS: Readonly<Record<EnvURL, string>> = {
  cogito: import.meta.env.VITE_COGITO,
  engine: import.meta.env.VITE_ENGINE,
  intelligence: import.meta.env.VITE_INTELLIGENCE
}

export { ENV_URLS }
