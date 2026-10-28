# Examples

抽象占位名；不绑定具体业务模块路径。

## 命名

| Bad                               | Prefer                             |
| --------------------------------- | ---------------------------------- |
| `getUserInfo`                     | `findUserInfo`                     |
| `getUsers`                        | `findUsers` / `fetchUsers`         |
| `resolveDate`                     | `parseDate`                        |
| `const date = resolveDate(raw)`   | `const parsed = parseDate(raw)`    |
| `userList`                        | `users`                            |
| `DEFAULT_PAGE_SIZE`               | `PAGE_SIZE`                        |
| `setFlag(true)`（非 React state） | `updateFlag(true)` / `flag = true` |
| `empty`（布尔语义不清）           | `isEmpty`                          |
| `KnowledgeChrome` / `showsChrome` | `KnowledgeSurface` / `showsShell`  |
| `leftPanel`（UI 区域）            | `leftSurface`                      |
| `loadPrefs`                       | `bootstrapPrefs`                   |

## API 函数与信封

**Correct**

```ts
import { http } from '@/utils/http.ts'

const BASE_URL = '/auth'

interface SignInBody {
  username: string
  password: string
}

interface SignInResult {
  token: string
  id: string
}

function POST_SIGNIN(data: SignInBody) {
  return http.post<RSF<SignInResult>>(`${BASE_URL}/signin`, data)
}

function POST_SIGNUP(_data: SignInBody) {
  return Promise.resolve()
}

export { POST_SIGNIN, POST_SIGNUP }
```

**Incorrect**

```ts
// get 前缀 + 箭头导出 + 文件中部 export
export const getSignIn = (data: any) => http.post('/auth/signin', data)

// 业务名驼峰混用
function postSignIn() {}
function POST_signIn() {}
```

分页列表优先 `RSP<T>`（含 `total`），普通成功体用 `RSF<T>`。

## 函数声明

**Correct**

```ts
function findUserByID(id: string) {
  return users.find((user) => user.id === id)
}

const ids = users.map((user) => user.id)

const session = {
  pause() {},
  resume() {},
  destroy() {}
}

bindGrid(el, {
  onDragStart() {
    session.pause()
  }
})
```

**Incorrect**

```ts
const findUserByID = (id: string) => {
  return users.find((user) => user.id === id)
}

const session = {
  pause: function () {},
  resume: () => {}
}

bindGrid(el, {
  onDragStart: function () {
    session.pause()
  }
})
```

对象方法用简写（`pause() {}`），不要 `key: function () {}` 或箭头方法。

## 类型位置

**Correct**（非专用类型文件）

```ts
import { http } from '@/utils/http.ts'

interface ProfileBody {
  displayName: string
}

function PUT_PROFILE(data: ProfileBody) {
  return http.put<RSF<void>>('/profile', data)
}

export { PUT_PROFILE }
```

类型放在 import 下方、实现之前；专用 `*.d.ts` / `types/` 文件不受此条限制。

对象形状用 `interface`；需要联合、映射或难以 `extends` 的交叉时再用 `type`。
