# 实现 Auth 认证模块服务接口

## 密码存储方案说明

### 1. bcrypt（推荐用于密码存储）

- **类型**：单向哈希函数（不可逆）
- **特点**：
- 专门为密码设计，包含盐值（salt）和成本因子（cost）
- 即使数据库泄露，攻击者也无法直接获取原始密码
- 验证时通过哈希对比，不存储明文密码
- 计算速度可调，可抵御暴力破解
- **适用场景**：密码存储（本项目已使用）

### 2. AES（不适合密码存储）

- **类型**：对称加密算法（可逆）
- **特点**：
- 需要密钥，如果密钥泄露，所有密码可被解密
- 用于加密敏感数据（如信用卡号、个人信息等）
- 不适合密码存储，因为密码应该是不可逆的
- **适用场景**：敏感数据加密传输/存储（非密码）

**结论**：密码存储必须使用 bcrypt 等单向哈希，本项目已正确使用。

## 实现方案

### 1. 完善数据库访问层

- 在 `src/databases/database.rs` 中添加 `auth_users()` 方法，返回 `Collection<AuthUser>`

### 2. 实现 JWT 工具函数

- 创建 `src/utils/jwt.rs`：
- `generate_token(user_id: &str, username: &str, secret: &str) -> Result<String>`
- `verify_token(token: &str, secret: &str) -> Result<Claims>`
- 定义 `Claims` 结构体（包含 user_id, username, exp）

### 3. 完善 Schema 定义

- 在 `src/services/auth/schema.rs` 中添加：
- `SigninResponse`：包含 token 和用户信息
- `SignupResponse`：包含 token 和用户信息
- `TokenClaims`：JWT claims 结构

### 4. 实现 AuthService 服务层

- 在 `src/services/auth/service.rs` 中实现：
- `signup()`：用户注册
- 检查用户名是否已存在
- 使用 bcrypt 哈希密码
- 创建用户记录
- 生成 JWT token
- 返回用户信息和 token
- `signin()`：用户登录
- 根据用户名查找用户
- 使用 bcrypt 验证密码
- 生成 JWT token
- 返回用户信息和 token

### 5. 完善 AuthController 控制器

- 在 `src/services/auth/controller.rs` 中：
- 修复方法名拼写（`singin` -> `signin`, `singup` -> `signup`）
- 使用统一的 `ApiResponse` 响应格式
- 添加错误处理

### 6. 修复路由配置

- 在 `src/services/auth/module.rs` 中修复路由拼写错误

### 7. 添加密码验证工具

- 在 `src/utils/bcrypt.rs` 中添加密码强度验证函数（可选）

## 文件修改清单

1. `src/databases/database.rs` - 添加 auth_users collection
2. `src/utils/jwt.rs` - 新建 JWT 工具模块
3. `src/services/auth/schema.rs` - 添加响应结构和 Claims
4. `src/services/auth/service.rs` - 实现完整的业务逻辑
5. `src/services/auth/controller.rs` - 完善控制器，使用统一响应格式
6. `src/services/auth/module.rs` - 修复路由拼写
7. `src/lib.rs` - 添加 jwt 模块导出
8. `src/configures/configure.rs` - 确保 JWT_SECRET 配置可用

## 技术要点

- 使用 bcrypt 进行密码哈希（已存在工具函数）
- 使用 jsonwebtoken 生成和验证 JWT
- 遵循项目现有的错误处理模式
- 使用统一的 ApiResponse 响应格式
- 遵循项目的分层架构（controller -> service -> database）