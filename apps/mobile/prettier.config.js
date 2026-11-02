/** @type {import('prettier').Config} */
module.exports = {
  printWidth: 100,
  tabWidth: 2,
  singleQuote: true,
  bracketSameLine: true,
  arrowParens: 'always',
  bracketSpacing: true,
  singleAttributePerLine: true,
  // 与仓库 `.gitattributes`（`* text=auto eol=crlf`）及根 `.prettierrc.json` 对齐；
  // `auto` 保持工作区现有行尾，避免 Linux CI 检出 CRLF 后被 lf 规则整包刷红。
  endOfLine: 'auto',
  semi: false,
  trailingComma: 'none',
  useTabs: false,
  tailwindAttributes: ['className'],
  plugins: ['prettier-plugin-tailwindcss']
}
