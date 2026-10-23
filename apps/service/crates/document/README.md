# document · 文档与资产

资产（上传文件）元数据、文本抽取与切片。

## 数据所有权

| 表 | 说明 |
| --- | --- |
| `asset` | 上传资产元数据（对象存储键、摘要、类型、大小）。 |
| `chunk` | 文本切片（派生数据，无租户列，随 `asset` 生命周期）。 |

## 对外接口

- 资产登记与查询、生命周期（软删 / 清理）。
- 对象存储端口（`trait BlobStore`）：S3 / OSS 等实现由调用方注入，本 crate 不直接出站上传。
- 文本抽取与切片（检索侧的索引写入属于 compute，cogito 只出资产正文）。

## 边界约束

- 不依赖 HTTP 框架；multipart 解析属于 `cogito`。
- 不依赖 `cogito`（R1）；不 JOIN 其他 crate 的表。
- `chunk` 无租户列：任何查询必须由 `asset` 的租户范围驱动（见 `guide/database.md`）。
- 权限判断调用 `authz`（R3）。

## 迁移状态

- 待迁入（P3b）：来源为 `service/src/services/{upload,markdown}`；迁完后删除。
