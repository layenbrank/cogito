# Vitest 测试指南

本项目采用 monorepo 架构，多数子项目使用独立的 Vitest 配置。

## 项目测试配置

### 使用 Vitest 的项目

#### Apps

- **apps/client** — React + Tauri 桌面应用（`*.test.ts(x)`，另有 `src/__test__/`）
- **apps/studio** — Electron 桌面（Vitest + 可选 Playwright e2e）
- **apps/devtools** — Vue3 开发工具
- **apps/extension** — React 浏览器扩展（测试与源码同目录，`src/**/*.test.ts(x)`）

#### Packages

### 不使用 Vitest 的项目

- **packages/shared** — 以类型为主（无独立测试套件时跳过）

---

## 运行测试

### 在根目录运行所有测试

```bash
# 运行所有项目的测试
pnpm test

# 运行带 UI 的测试
pnpm test:ui

# 运行测试并生成覆盖率报告
pnpm test:coverage
```

### 在单个项目中运行测试

```bash
# 进入项目目录
cd apps/client

# 运行测试
pnpm test

# 监听模式运行测试
pnpm test --watch

# 运行带 UI 的测试
pnpm test:ui

# 生成覆盖率报告
pnpm test:coverage
```

---

## 编写测试

### 1. React 组件测试 (apps/client)

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { Button } from './Button'

describe('Button Component', () => {
  it('renders button with text', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })

  it('handles click events', async () => {
    const handleClick = vi.fn()
    render(<Button onClick={handleClick}>Click me</Button>)

    const button = screen.getByText('Click me')
    await userEvent.click(button)

    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
```

### 2. Vue 组件测试 (apps/extension, apps/devtools, packages/design)

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MyComponent from './MyComponent.vue'

describe('MyComponent', () => {
  it('renders properly', () => {
    const wrapper = mount(MyComponent, {
      props: { msg: 'Hello Vitest' }
    })
    expect(wrapper.text()).toContain('Hello Vitest')
  })

  it('emits event on button click', async () => {
    const wrapper = mount(MyComponent)
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted()).toHaveProperty('click')
  })
})
```

### 3. 工具函数测试 (packages/core)

```ts
import { describe, it, expect } from 'vitest'
import { formatDate, validateEmail } from './utils'

describe('Utils', () => {
  describe('formatDate', () => {
    it('formats date correctly', () => {
      const date = new Date('2024-01-01')
      expect(formatDate(date)).toBe('2024-01-01')
    })
  })

  describe('validateEmail', () => {
    it('validates correct email', () => {
      expect(validateEmail('test@example.com')).toBe(true)
    })

    it('rejects invalid email', () => {
      expect(validateEmail('invalid-email')).toBe(false)
    })
  })
})
```

### 4. Composables 测试 (Vue 项目)

```ts
import { describe, it, expect } from 'vitest'
import { useCounter } from './useCounter'

describe('useCounter', () => {
  it('increments counter', () => {
    const { count, increment } = useCounter()
    expect(count.value).toBe(0)

    increment()
    expect(count.value).toBe(1)
  })
})
```

### 5. Mock 测试

```ts
import { describe, it, expect, vi } from 'vitest'
import { fetchData } from './api'

// Mock 模块
vi.mock('./api', () => ({
  fetchData: vi.fn()
}))

describe('API calls', () => {
  it('fetches data successfully', async () => {
    const mockData = { id: 1, name: 'Test' }
    vi.mocked(fetchData).mockResolvedValue(mockData)

    const result = await fetchData()
    expect(result).toEqual(mockData)
  })
})
```

---

## 测试文件组织

本仓库常见两种布局：

1. **与源码同目录**：`foo.ts` 旁放 `foo.test.ts`（client / studio / packages 多用）
2. **同目录共存**：测试文件与源码同目录（`src/**/*.test.ts(x)`），不建集中测试目录

### 命名规则

- `*.test.ts` / `*.test.tsx` — Vitest 单元与组件测试
- `*.spec.ts` — NestJS（Jest）或个别 Vue 规范测试

---

## Vitest 配置说明

每个项目的 `vitest.config.ts` 包含：

```typescript
export default defineConfig({
  plugins: [vue()], // 或 react()
  test: {
    globals: true, // 启用全局 API
    environment: 'jsdom', // DOM 环境（组件测试）
    coverage: {
      provider: 'v8', // 覆盖率提供者
      reporter: ['text', 'json', 'html']
    },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', '.turbo']
  }
})
```

---

## 测试最佳实践

1. **测试文件应与源文件放在同一目录**
   - 便于查找和维护
   - 保持代码和测试的紧密关联

2. **使用描述性的测试名称**

   ```ts
   it('should validate email format correctly')
   // 优于
   it('test email')
   ```

3. **遵循 AAA 模式**
   - Arrange（准备）
   - Act（执行）
   - Assert（断言）

4. **不要测试实现细节**
   - 测试行为，而不是内部实现
   - 从用户角度编写测试

5. **使用 Mock 隔离依赖**
   - 保持测试独立性
   - 提高测试速度

6. **保持测试简单**
   - 一个测试只测一个功能点
   - 避免复杂的测试逻辑

---

## 覆盖率报告

运行覆盖率测试后，在各项目的 `coverage/` 目录下查看报告：

```bash
# 生成覆盖率报告
pnpm test:coverage

# 查看 HTML 报告
# 在浏览器中打开 coverage/index.html
```

---

## 常用 API

### Vitest 核心 API

- `describe()` - 测试套件
- `it()` / `test()` - 测试用例
- `expect()` - 断言
- `vi.fn()` - 创建 mock 函数
- `vi.mock()` - Mock 模块
- `beforeEach()` / `afterEach()` - 钩子函数

### React Testing Library

- `render()` - 渲染组件
- `screen` - 查询渲染结果
- `fireEvent` - 触发事件
- `waitFor()` - 等待异步操作

### Vue Test Utils

- `mount()` - 挂载组件
- `shallowMount()` - 浅挂载
- `wrapper.find()` - 查找元素
- `wrapper.trigger()` - 触发事件
- `wrapper.emitted()` - 获取触发的事件

---

## 示例入口

- `apps/client/src/__test__/example.test.tsx` — React 示例
- `apps/extension/src/__tests__/example.test.ts` — Vue 示例
- `packages/design/src/example.test.ts` — UI 组件示例
- `packages/core/src/example.test.ts` — 工具函数示例

---

## 参考资料

- [Vitest 官方文档](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Vue Test Utils](https://test-utils.vuejs.org/)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
