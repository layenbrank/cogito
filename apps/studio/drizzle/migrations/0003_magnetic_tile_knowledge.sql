-- 磁贴组件改名：markdown → knowledge
-- （`MagneticTile.Component` 的成员重命名，见 packages/shared/src/types/magnetic-tile.d.ts）
--
-- `0000_init.sql` 只对空库生效，已安装过的库种子仍是 'markdown'；而 service 的
-- `Component` 枚举已无 `Markdown`，这类行一旦发布就会在该处反序列化失败。
-- 因此这里做一次数据修补，让存量库与种子一致。
--
-- 只改组件名，不动 updatedAt：避免扰动镜像/同步的排序与增量判定。
UPDATE `magneticTile` SET `component` = 'knowledge' WHERE `component` = 'markdown';
