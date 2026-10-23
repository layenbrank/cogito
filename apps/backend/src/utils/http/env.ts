const ENV_URLS: Readonly<Record<EnvURL, string>> = {
  cogito: import.meta.env.VITE_COGITO,
  engine: import.meta.env.VITE_ENGINE,
  intelligence: import.meta.env.VITE_INTELLIGENCE
}

export { ENV_URLS }
