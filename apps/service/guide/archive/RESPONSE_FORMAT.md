# 统一响应体数据格式

这个 Rust Web Service 项目实现了统一的 API 响应格式，确保所有 API 端点返回一致的响应结构。

## 设计原则

### HTTP 状态码 vs 业务状态码

- **HTTP 状态码**：在 HTTP 响应头中，表示 HTTP 协议层面的状态（200, 400, 401, 404, 500 等）
- **业务状态码**：在响应体的 `code` 字段中，表示业务逻辑的执行结果
  - `0`：表示业务执行成功
  - `非0`：表示各种业务错误，通常采用 5 位数编码规则

## 响应格式

### 成功响应格式

```json
{
  "code": 200000,
  "success": true,
  "msg": "Success",
  "data": {
    // 实际响应数据
  },
  "timestamp": 1703174400000
}
```

### 错误响应格式

```json
{
  "code": 400001,
  "success": false,
  "message": "资源不存在",
  "timestamp": 1703174400000,
  "details": {
    // 可选的详细错误信息
  }
}
```

### 分页响应格式

```json
{
  "code": 200000,
  "success": true,
  "msg": "Success",
  "data": {
    "items": [
      // 数据项列表
    ],
    "total": 100,
    "page": 1,
    "page_size": 20,
    "total_pages": 5,
    "has_next": true,
    "has_prev": false
  },
  "timestamp": 1703174400000
}
```

## 业务状态码规范（企业级标准）

### 设计原则

- **统一性**：采用 6 位数字编码，前 2 位表示模块，中 2 位表示功能，后 2 位表示具体错误
- **可读性**：每个状态码都有明确的语义
- **可扩展性**：预留足够的编码空间供业务扩展
- **层次性**：按模块和功能分层管理

### 编码规则

```
XXYYZZ
XX: 模块代码 (00-99)
YY: 功能代码 (00-99)
ZZ: 错误代码 (00-99)
```

### 通用状态码

#### 成功状态码

- `200000`: 操作成功

#### 系统级错误 (10xxxx)

- `100001`: 系统内部错误
- `100002`: 服务不可用
- `100003`: 系统维护中
- `100004`: 系统超时
- `100005`: 系统资源不足

#### 请求相关错误 (20xxxx)

- `200001`: 请求参数缺失
- `200002`: 请求参数格式错误
- `200003`: 请求参数值无效
- `200004`: 请求体过大
- `200005`: 请求频率过高
- `200006`: 请求方法不支持
- `200007`: 请求头缺失或无效

#### 认证授权错误 (30xxxx)

- `300001`: 用户未登录
- `300002`: 登录凭证无效
- `300003`: 登录凭证过期
- `300004`: 账号被锁定
- `300005`: 账号被禁用
- `300006`: 权限不足
- `300007`: 访问被拒绝
- `300008`: 需要二次验证

#### 资源相关错误 (40xxxx)

- `400001`: 资源不存在
- `400002`: 资源已存在
- `400003`: 资源已被删除
- `400004`: 资源访问被限制
- `400005`: 资源正在被使用
- `400006`: 资源配额不足

#### 业务逻辑错误 (50xxxx)

##### 用户模块 (5001xx)

- `500101`: 用户不存在
- `500102`: 用户名已存在
- `500103`: 邮箱已被注册
- `500104`: 手机号已被注册
- `500105`: 密码强度不够
- `500106`: 用户状态异常

##### 文件上传模块 (5002xx)

- `500201`: 文件类型不支持
- `500202`: 文件大小超出限制
- `500203`: 文件上传失败
- `500204`: 文件不存在
- `500205`: 文件校验失败
- `500206`: 存储空间不足

##### 认证模块 (5003xx)

- `500301`: 用户名或密码错误
- `500302`: 验证码错误
- `500303`: 验证码已过期
- `500304`: 登录失败次数过多
- `500305`: 密码重置失败

#### 外部服务错误 (60xxxx)

- `600001`: 数据库连接失败
- `600002`: 数据库操作失败
- `600003`: 缓存服务异常
- `600004`: 消息队列异常
- `600005`: 第三方 API 调用失败
- `600006`: 网络连接超时

#### 数据相关错误 (70xxxx)

- `700001`: 数据格式错误
- `700002`: 数据完整性校验失败
- `700003`: 数据重复
- `700004`: 数据不一致
- `700005`: 数据过期

## 使用方法

### 1. 在控制器中使用

### 使用示例

```rust
use crate::utils::response::ApiResponse;
use crate::utils::business_code;
use actix_web::{HttpResponse, HttpRequest, Result};

// 成功响应
pub async fn find_user(req: HttpRequest) -> Result<HttpResponse> {
    let user = UserService::find_by_id(1).await?;
    ApiResponse::success(user).transform()
}

// 业务错误响应 - 用户不存在
pub async fn user_not_found() -> Result<HttpResponse> {
    let response = ApiErrorResponse::custom(
        business_code::business::user::NOT_FOUND,
        "指定的用户不存在"
    );
    response.transform()
}

// 文件上传错误
pub async fn upload_error() -> Result<HttpResponse> {
    let response = ApiErrorResponse::custom(
        business_code::business::upload::FILE_TOO_LARGE,
        "文件大小超出限制，最大支持10MB"
    );
    response.transform()
}
```

### 2. 使用便捷宏

```rust
use crate::{api_success, api_created, api_no_content, api_error, api_paginated};

// 成功响应
pub async fn find_data() -> Result<HttpResponse> {
    let data = some_data().await?;
    api_success!(data)
}

// 创建成功响应
pub async fn insert_user() -> Result<HttpResponse> {
    let user = new_user().await?;
    api_created!(user)
}

// 无内容响应
pub async fn remove_user() -> Result<HttpResponse> {
    user_by_id(1).await?;
    api_no_content!("User deleted successfully")
}

// 错误响应
pub async fn handle_error() -> Result<HttpResponse> {
    api_error!(bad_request, "Invalid input parameters")
}

// 分页响应
pub async fn users_paginated() -> Result<HttpResponse> {
    let users = users(1, 20).await?;
    api_paginated!(users, 100, 1, 20)
}
```

### 3. 错误处理

项目统一使用 `actix_web::Result` 和 actix_web 的错误处理：

```rust
use actix_web::{Result, error::{ErrorBadRequest, ErrorNotFound, ErrorInternalServerError}};

// 这些错误会自动转换为统一格式的响应
return Err(ErrorNotFound("User not found"));
return Err(ErrorBadRequest("Invalid email format"));
return Err(ErrorInternalServerError("Database connection failed"));
```

### 4. 中间件集成

响应包装中间件会自动为每个请求生成唯一的 `request_id` 并记录在日志中：

```rust
// 在 main.rs 中已配置
App::new()
    .wrap(ResponseWrapper) // 自动生成请求 ID 并记录日志
    .service(your_routes)
```

日志输出示例：

```
REQUEST [550e8400-e29b-41d4-a716-446655440000] GET /api/v1/users - Started
RESPONSE [550e8400-e29b-41d4-a716-446655440000] GET /api/v1/users - 200 - 45ms
```

## API 示例

### 健康检查

```bash
GET /api/health
```

响应：

```json
{
  "code": 200000,
  "success": true,
  "msg": "Service is running normally",
  "data": {
    "status": "healthy",
    "version": "1.0.0",
    "timestamp": 1703174400000,
    "uptime": "N/A"
  },
  "timestamp": 1703174400000
}
```

### 用户列表

```bash
GET /api/v1/users
```

响应：

```json
{
  "code": 200000,
  "success": true,
  "msg": "Success",
  "data": [
    {
      "id": "60f5b8a2c4567890123456ab",
      "name": "John Doe",
      "email": "john@example.com"
    }
  ],
  "timestamp": 1703174400000
}
```

### 错误响应示例

```bash
GET /api/v1/users/invalid-id
```

响应：

```json
{
  "code": 400001,
  "success": false,
  "message": "资源不存在",
  "timestamp": 1703174400000
}
```

## HTTP 状态码与业务状态码对应关系

| HTTP 状态码 | 业务状态码范围 | 说明         |
| ----------- | -------------- | ------------ |
| 200         | 200000         | 业务操作成功 |
| 400         | 200001-299999  | 请求参数错误 |
| 400         | 500001-599999  | 业务逻辑错误 |
| 400         | 700001-799999  | 数据格式错误 |
| 401         | 300001-300005  | 认证失败     |
| 403         | 300006-399999  | 权限不足     |
| 404         | 400001-499999  | 资源不存在   |
| 500         | 100001-199999  | 系统内部错误 |
| 500         | 600001-699999  | 外部服务错误 |

## 业务状态码使用规范

1. **统一导入**：所有业务状态码通过 `business_code` 模块统一管理
2. **语义明确**：每个状态码都有明确的业务含义和描述
3. **分层管理**：按模块和功能分层，便于维护和扩展
4. **自动映射**：业务状态码自动映射到对应的 HTTP 状态码
5. **国际化支持**：状态码描述支持多语言（预留扩展）

## 状态码映射

### HTTP 状态码（协议层）

- **200**: HTTP 成功（大部分情况下都返回 200，业务成功与否通过 code 字段判断）
- **400**: HTTP 客户端错误（当业务码为 40000-40099 时）
- **401**: HTTP 未授权（当业务码为 40100-40199 时）
- **403**: HTTP 禁止访问（当业务码为 40300-40399 时）
- **404**: HTTP 资源未找到（当业务码为 40400-40499 时）
- **500**: HTTP 服务器内部错误（当业务码为 50000-50099 时）

## 特性

1. **自动请求 ID 生成**: 每个请求都会生成唯一的请求 ID，记录在日志中便于追踪
2. **统一错误处理**: 所有错误都会转换为统一格式
3. **时间戳**: 自动添加响应时间戳
4. **类型安全**: 使用 Rust 的类型系统确保响应格式正确
5. **便捷宏**: 提供简化的宏来快速构建响应
6. **分页支持**: 内置分页响应结构
7. **可扩展性**: 易于添加新的响应字段或类型
8. **日志追踪**: 请求 ID 仅在日志中显示，不暴露给客户端

## 命名约定

项目遵循简洁优雅的命名约定：

- **避免动词前缀**: 不使用 `get_`、`create_`、`update_`、`delete_` 等前缀
- **语义清晰**: 函数名应直接表达其用途
- **推荐命名**:
  - `find_user` 而不是 `get_user`
  - `insert_user` 而不是 `create_user`
  - `remove_user` 而不是 `delete_user`
  - `users` 而不是 `get_users`
  - `extract_id` 而不是 `extract_request_id`

## 注意事项

1. 所有的 API 端点都应该使用统一的响应格式
2. 错误信息应该对用户友好，避免泄露敏感信息
3. 在生产环境中，考虑隐藏详细的错误信息
4. 请求 ID 仅用于服务端日志关联和问题追踪，不会暴露给客户端
5. 遵循项目的命名约定，保持代码一致性
