function paintTheme(): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', prefersDark)
}

function bootstrapTheme(): void {
  paintTheme()
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme)
}

export { bootstrapTheme }
