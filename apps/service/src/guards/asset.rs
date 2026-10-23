//! 资产守卫：读一份资产的两条作用域通道（`Storage::user_tx` / `Storage::anon_tx` /
//! `Storage::asset_hash_tx` 只允许在这里调用，门禁 R7 强制）。
//!
//! 资产是**内容寻址**的资源：同一份字节被多个账号各自持有一行，跨账号共享只能靠 hash。
//! 因此「读一份资产」有三种身份，各走各的通道：
//!
//! - [`AssetReader`]（本人 / 登录态）：`Some(user_id)` 进账号作用域，看得到自己的、
//!   本租户的、`PUBLIC` 的、以及 `RESTRICTED` 里被点名的行；
//! - [`AssetReader`]（匿名）：`None` 走**无作用域**事务，只剩 `PUBLIC` 行可读——
//!   公开分发链接就是这么工作的，其余情况一律是「读不到」（404，不泄露存在性）；
//! - [`AssetContentScope`]（秒传引导）：匿名、无身份，只有文件 hash 这一把能力键，
//!   借出 hash 命中且已完成的那一行用于克隆，**借不到未完成会话**。
//!
//! 与租户守卫一样，这里只有作用域，**没有权限判定**：能不能下这份文件由领域层
//! （`upload::validation::ensure_can_download`）决定，守卫只保证「看得到才可能有结论」。

use identity::UserId;
use sea_orm::{DatabaseTransaction, DbErr};

use crate::databases::database::Storage;

/// 读资产时的身份：登录态进账号作用域，匿名退到无作用域。
pub struct AssetReader {
    tx: DatabaseTransaction,
    user_id: Option<UserId>,
}

impl AssetReader {
    /// 进入读资产的作用域。身份由调用方确认（请求路径来自 [`Session`]，
    /// 机器路径来自调用方的确权）。
    ///
    /// [`Session`]: crate::guards::session::Session
    ///
    /// # Errors
    /// 事务无法开启时返回底层数据库错误（调用方应答 500）。
    pub async fn enter(storage: &Storage, user_id: Option<UserId>) -> Result<Self, DbErr> {
        let tx = match user_id {
            Some(user_id) => storage.user_tx(user_id).await?,
            None => storage.anon_tx().await?,
        };

        Ok(Self { tx, user_id })
    }

    /// 带作用域的事务。
    #[must_use]
    pub const fn tx(&self) -> &DatabaseTransaction {
        &self.tx
    }

    /// 当前身份；`None` 表示匿名（只有 `PUBLIC` 行可读）。
    #[must_use]
    pub const fn user_id(&self) -> Option<UserId> {
        self.user_id
    }

    /// 提交：只有把资产行的可见性改动（例如头像登记为公开）算作本次读的一部分时才用。
    ///
    /// # Errors
    /// 提交失败时返回底层数据库错误。
    pub async fn commit(self) -> Result<(), DbErr> {
        self.tx.commit().await
    }

    /// 放弃事务：只读路径结束时显式释放连接，不必等 drop 回收。
    ///
    /// # Errors
    /// 回滚失败时返回底层数据库错误。
    pub async fn rollback(self) -> Result<(), DbErr> {
        self.tx.rollback().await
    }
}

/// 秒传引导：只凭文件 hash 借出那一行**已完成**资产。
pub struct AssetContentScope {
    tx: DatabaseTransaction,
    hash: String,
}

impl AssetContentScope {
    /// 按文件 hash 借用内容行（`"hash" = app_current_asset_hash() AND "status" = 'COMPLETED'`）。
    ///
    /// # Errors
    /// 事务无法开启时返回底层数据库错误。
    pub async fn open(storage: &Storage, hash: &str) -> Result<Self, DbErr> {
        let tx = storage.asset_hash_tx(hash).await?;

        Ok(Self {
            tx,
            hash: hash.to_string(),
        })
    }

    /// 带能力键的事务。
    #[must_use]
    pub const fn tx(&self) -> &DatabaseTransaction {
        &self.tx
    }

    /// 借出时用的 hash。
    #[must_use]
    pub fn hash(&self) -> &str {
        &self.hash
    }

    /// 提交：内容读不该改任何行，正常路径走 [`rollback`](Self::rollback)。
    ///
    /// # Errors
    /// 提交失败时返回底层数据库错误。
    pub async fn commit(self) -> Result<(), DbErr> {
        self.tx.commit().await
    }

    /// 放弃事务：拿到源资产后立刻释放，别把能力键带进后面的写入。
    ///
    /// # Errors
    /// 回滚失败时返回底层数据库错误。
    pub async fn rollback(self) -> Result<(), DbErr> {
        self.tx.rollback().await
    }
}
