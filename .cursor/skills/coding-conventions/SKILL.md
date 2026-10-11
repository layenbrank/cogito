---
name: coding-conventions
description: >-
  Enforces team coding standards for naming, API functions, TypeScript types,
  and function style. Use when writing or reviewing new code, creating API
  modules, defining types, naming variables/functions, or when the user mentions
  开发规范, 编码规范, naming conventions, POST_SIGNIN, GET_INFO, or code style
  in this project.
---

# 编码规范

编写或审查**新代码**时严格遵循。存量 `getXxx`、全小写常量等可在迭代中逐步替换，不要求一次性全改。命名尽量简洁优雅。

正误对照与完整片段见 [examples.md](examples.md)。

## 快速检查

- [ ] API 与常量：全大写下划线（`POST_SIGNIN`、`GET_INFO`、`API_BASE_URL`）
- [ ] 禁止 `get` 前缀；查询用 `find` / `fetch`，解析用 `parse` / `parsed`
- [ ] 布尔用 `is` / `has` / `can`；非 `useState` 不用 `set`；避免 `list` 后缀
- [ ] 非必要不用箭头函数；导出用 `function`；对象方法用简写、不写 `function`；模块末尾 `export { ... }`
- [ ] 对象形状用 `interface`；联合/交叉/工具类型映射用 `type`
- [ ] HTTP 响应信封用 `RSF<T>` / 分页用 `RSP<T>`；未使用参数加 `_` 前缀

## 命名

### 禁止 `get` 前缀

用 `find`、`fetch` 等替代查询；解析用 `parse`，解析结果用 `parsed`（不要用 `resolve` 表示解析）。

- ❌ `getUserInfo` → ✅ `findUserInfo`
- ❌ `getUsers` → ✅ `findUsers`
- ❌ `resolveDate` → ✅ `parseDate`

创建类语义优先更具体的动词（如 `insert`、`increment`），避免泛化的 `create` 当默认名。

### 常量与配置

常量、枚举键、全局配置：**全大写** + 下划线。默认值不加 `DEFAULT` 前缀。

- ✅ `API_BASE_URL`、`MAX_RETRY_COUNT`、`PAGE_SIZE`
- ❌ `DEFAULT_PAGE_SIZE`

### 命名原则

- 非 `useState` 禁止 `set`
- 布尔用 `is` / `has` / `can`（如 `isEmpty`、`hasPermission`、`canUpdate`）
- 用单复数区分集合语义，避免 `list` 后缀（`users` 非 `userList`）
- 除循环变量 `i`、`k` 外避免单字母；超过约 20 字符应拆分
- 名称简洁、语义明确

## API 与请求

### 接口函数命名

格式：**请求方法 + 业务含义**，全部大写下划线。

- `GET_USERS`、`POST_SIGNIN`、`PUT_USER`、`DELETE_USER`、`PATCH_PROFILE`

### 响应信封

HTTP 成功体用 `RSF<T>`；带分页总量用 `RSP<T>`（定义见 `packages/shared/src/types/response.d.ts`）。

```ts
function POST_SIGNIN(data: SignInBody) {
  return http.post<RSF<SignInResult>>('/auth/signin', data)
}
```

## 函数与写法

### 优先普通函数

非必要禁止箭头函数。对外导出、需要明确语义时用 `function` 声明。

箭头函数仅用于：

- 简短回调（如 `arr.map(x => x.id)`）
- 必须保持外层 `this`
- 团队约定的 compose / pipe 等工具

### 对象方法用简写

对象字面量中的方法**不要**写 `key: function () {}`，用方法简写：

```ts
// ✅
bindSortableGrid(gridEl, {
  onDragStart() {
    scrollFx.pause()
  },
  onDragEnd() {
    scrollFx.resume()
  }
})

const session = {
  pause() {},
  resume() {},
  destroy() {}
}

// ❌
bindSortableGrid(gridEl, {
  onDragStart: function () {
    scrollFx.pause()
  }
})
```

独立函数、模块导出、`useEffect` / 回调参数等非对象方法位置，仍用 `function` 声明（非箭头）。

### 文件与导出

- 文件粒度适中：既不过度拆分，也不过度聚合
- 按模块划分；导出名与文件名、职责一致
- **一个域多个文件就开目录**（目录名即域，内部用短名）；单文件域平铺
- 目录内默认不建 barrel；仅当该域需要对外统一入口时才放 `index.ts`
- **模块末尾**集中命名导出：`export { POST_SIGNIN, POST_SIGNUP }`

### 未使用参数

未使用的参数加 `_` 前缀（如 `_data`），避免 lint 噪音并标明有意忽略。

## 类型与质量

- 类型命名：大驼峰
- **对象形状优先 `interface`**（Props、DTO、结果体等）；联合类型、交叉不便 `extends`、映射/条件类型用 `type`
- 非专门存放类型的文件：类型定义放在文件顶部、import 下方
- 优先 TypeScript 类型，避免 `any`；公开 API 需有类型
- 遵循项目 ESLint / 格式化；复杂逻辑、业务规则补充必要注释

## 边界

| 场景 | 使用 |
|------|------|
| 前端 HTTP / TS 命名与写法 | 本 Skill（`coding-conventions`） |
| Tauri IPC / Command / Service | `naming-conventions`（client `src-tauri`） |

## 存量代码

新代码严格执行本规范。存量不合规命名可在触及该文件时渐进替换，不要求一次性全仓改完。
