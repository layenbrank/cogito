# PostgreSQL 18 + pgvector + zh_CN.UTF-8 locale（官方镜像默认没有 zh_CN）
#
# 基于 pgvector 官方镜像而不是 postgres:18：向量列不是可选项——compute 的
# `rag_embedding` 直接建在 vector 类型上，cogito 侧检索（决策 D2）也逐步收敛到同一个库。
# 少一个组件、少一份运维，是这个仓库「一个 Postgres」策略的一部分。
FROM pgvector/pgvector:pg18

RUN localedef -i zh_CN -c -f UTF-8 -A /usr/share/locale/locale.alias zh_CN.UTF-8

ENV LANG=zh_CN.UTF-8
ENV LC_ALL=zh_CN.UTF-8

# 只在**空 data/postgres** 首次 initdb 时执行；已有数据的目录不会再跑。
# 因此老数据目录要建 compute 的库，得手动 psql 或清空重建（见 guide/deployment.md）。
COPY init/01-databases.sql /docker-entrypoint-initdb.d/01-databases.sql
