/** @type {import('prettier').Config} */
module.exports = {
  printWidth: 100,
  tabWidth: 2,
  singleQuote: true,
  bracketSameLine: true,
  arrowParens: 'always',
  bracketSpacing: true,
  singleAttributePerLine: true,
  endOfLine: 'lf',
  semi: false,
  trailingComma: 'none',
  useTabs: false,
  tailwindAttributes: ['className'],
  plugins: ['prettier-plugin-tailwindcss']
}
