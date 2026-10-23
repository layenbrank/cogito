# 实现 Auth 授权系统

## 概述

实现完整的认证授权系统，包括：

- 支持 AES 对称加密和 Argon2 哈希两种密码存储方案（可通过配置切换）
- JWT token 生成和验证（从环境变量读取密钥）
- 用户注册（signup）和登录（signin）功能

## 实现步骤

### 1. 添加依赖包

在 `Cargo.toml` 中添加：

- `argon2 = "0.5"` - Argon2 哈希算法
- `aes-gcm = "0.10"` - AES-GCM 对称加密
- `base64 = "0.22"` - Base64 编码（已存在，但需要确认版本）

### 2. 扩展配置系统

在 `src/configures/configure.rs` 中：

- 添加 `Encryption` 字段（支持 "aes" 或 "argon2"）
- 添加 `jwt_secret` 字段（从环境变量 `JWT_SECRET` 读取）
- 添加 `aes_key` 字段（从环境变量 `AES_KEY` 读取，32字节用于 AES-256）

### 3. 创建加密工具模块

创建 `src/utils/encryption.rs`：

- 实现 `EncryptionMethod` 枚举（AES, Argon2）
- 实现 `encrypt_password()` 和 `verify_password()` 函数
- AES 实现：使用 AES-256-GCM 加密
- Argon2 实现：使用 Argon2id 变体，配置合理的参数

### 4. 创建 JWT 工具模块

创建 `src/utils/jwt.rs`：

- 实现 `generate_token()` 函数（生成 JWT token）
- 实现 `verify_token()` 函数（验证 JWT token）
- 定义 Claims 结构体（包含用户 ID、用户名、过期时间等）
- 从配置读取 JWT_SECRET

### 5. 扩展数据库存储

在 `src/databases/database.rs` 中：

- 添加 `auth_users()` 方法，返回 `Collection<AuthUser>`

### 6. 完善 Auth Schema

在 `src/services/auth/schema.rs` 中：

- 添加响应结构体：`SigninResponse`（包含 token 和用户信息）
- 添加响应结构体：`SignupResponse`（包含 token 和用户信息）

### 7. 实现 Auth Service

在 `src/services/auth/service.rs` 中：

- 实现 `signup()` 方法：
- 检查用户名是否已存在
- 根据配置选择加密方式处理密码
- 创建用户并保存到数据库
- 生成 JWT token
- 返回用户信息和 token
- 实现 `signin()` 方法：
- 根据用户名查找用户
- 根据配置选择验证方式验证密码
- 生成 JWT token
- 返回用户信息和 token
- 添加错误处理（用户不存在、密码错误等）

### 8. 更新 Auth Controller

在 `src/services/auth/controller.rs` 中：

- 修复方法名拼写（`singin` -> `signin`, `singup` -> `signup`）
- 完善错误处理和响应格式
- 使用统一的 ApiResponse 格式

### 9. 更新模块导出

在 `src/lib.rs` 中：

- 添加 `utils::encryption` 和 `utils::jwt` 模块导出

### 10. 更新 Auth Module

在 `src/services/auth/module.rs` 中：

- 修复路由路径拼写（`/singup` -> `/signup`）

## 文件变更清单

- `Cargo.toml` - 添加依赖
- `src/configures/configure.rs` - 扩展配置
- `src/utils/encryption.rs` - 新建加密工具
- `src/utils/jwt.rs` - 新建 JWT 工具
- `src/databases/database.rs` - 添加 auth_users 方法
- `src/services/auth/schema.rs` - 添加响应结构体
- `src/services/auth/service.rs` - 实现业务逻辑
- `src/services/auth/controller.rs` - 完善控制器
- `src/services/auth/module.rs` - 修复路由
- `src/lib.rs` - 更新模块导出

## 环境变量配置

需要在 `.env` 文件中添加：

- `Encryption=aes` 或 `argon2`（默认 argon2）
- `JWT_SECRET=<your-jwt-secret-key>`（至少 32 字符，建议 64 字符）
- `AES_KEY=<32-byte-key-in-base64>`（仅当使用 AES 时需要）

### 生成密钥

项目提供了密钥生成工具，运行以下命令生成所有必需的密钥：

```bash
cargo run --bin generate_keys
```

该命令会输出：
- `JWT_SECRET`: 64 字符的随机字符串，用于 JWT token 签名和验证
- `AES_KEY`: 32 字节的随机密钥（base64 编码），用于 AES-256-GCM 加密

**手动生成密钥的方法：**

1. **生成 JWT_SECRET**（至少 32 字符）：
   ```bash
   # 使用 openssl
   openssl rand -base64 48
   
   # 或使用 PowerShell
   -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})
   ```

2. **生成 AES_KEY**（32 字节的 base64 编码）：
   ```bash
   # 使用 openssl
   openssl rand -base64 32
   
   # 或使用 PowerShell
   [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
   ```

**注意：**
- 生产环境请使用安全的密钥管理方式（如密钥管理服务）
- 不要将密钥提交到版本控制系统
- 定期轮换密钥以提高安全性