# 优化 Auth 系统响应和错误处理

## 问题分析

1. **响应处理问题**：`ApiErrorResponse::transform()` 根据业务状态码返回不同的 HTTP 状态码，但应该统一返回 HTTP 200
2. **错误处理重复**：`service.rs` 返回 `Result<T, AuthError>`，`controller.rs` 又进行错误匹配，存在重复处理
3. **结构体重合**：`AuthUserInfo` 和 `AuthUser` 高度重合，可以优化
4. **字段命名规范**：MongoDB 使用 `_id` (ObjectId)，前端需要 `id` (String)；时间字段统一使用 camelCase

## 实现步骤

### 1. 修复 HTTP 状态码问题

在 `src/utils/response.rs` 中：

- 修改 `ApiErrorResponse::transform()` 方法，始终返回 HTTP 200
- 业务错误通过响应体中的 `code` 字段表示，而不是 HTTP 状态码

### 2. 优化错误处理流程

在 `src/services/auth/service.rs` 中：

- 移除 `From<AuthError> for actix_web::Error` 实现（不再需要）
- 让 `AuthError` 实现转换为 `ApiErrorResponse` 的方法

在 `src/services/auth/controller.rs` 中：

- 简化错误处理，直接使用 `AuthError` 转换为响应
- 使用统一的错误转换方法

### 3. 优化结构体定义

在 `src/services/auth/schema.rs` 中：

- 移除 `AuthUserInfo` 结构体
- 优化 `AuthUser` 结构体：
- `id` 字段：MongoDB 中为 `_id` (ObjectId)，序列化时转换为 `id` (String)
- `password` 字段：添加 `#[serde(skip_serializing)]` 跳过序列化
- `created_at` 字段：重命名为 `createdAt`（存储和返回都使用 camelCase）
- `updated_at` 字段：重命名为 `updatedAt`（存储和返回都使用 camelCase）
- 修改 `SigninResponse` 和 `SignupResponse` 直接使用 `AuthUser`
- 添加自定义序列化逻辑，将 `ObjectId` 转换为 `String` 格式的 `id`

### 4. 更新相关引用

- 更新 `service.rs` 中对 `AuthUserInfo` 的引用
- 确保所有地方使用优化后的结构

## 文件变更清单

- `src/utils/response.rs` - 修复 HTTP 状态码问题（所有响应返回 HTTP 200）
- `src/services/auth/service.rs` - 优化错误处理，添加错误转换方法，更新结构体使用
- `src/services/auth/controller.rs` - 简化错误处理逻辑
- `src/services/auth/schema.rs` - 优化结构体定义：
- 移除 `AuthUserInfo`
- 优化 `AuthUser`：`_id`/`id` 转换，`createdAt`/`updatedAt` 字段名，`password` 跳过序列化