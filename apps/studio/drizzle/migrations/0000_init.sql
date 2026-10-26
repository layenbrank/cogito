-- 开发阶段只有这一条迁移：整库 DDL + 基础种子数据，全部写成 IF NOT EXISTS。
-- 这样「表已存在」只是正常状态而不是错误（例如库是上一次生成时建的、
-- 或手工建过表），迁移可以安全重跑，不会因为 CREATE TABLE 撞名让整条事务失败。
CREATE TABLE IF NOT EXISTS `asset` (
	`id` text PRIMARY KEY NOT NULL,
	`tenantID` text,
	`kind` text,
	`hash` text,
	`sha` text DEFAULT 'sha256' NOT NULL,
	`size` integer,
	`index` integer DEFAULT 1 NOT NULL,
	`mime` text NOT NULL,
	`extension` text,
	`fileName` text NOT NULL,
	`filePath` text NOT NULL,
	`metadata` text,
	`status` text DEFAULT '001' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deviceID` text,
	`archivedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_asset_hash` ON `asset` (`hash`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_asset_path` ON `asset` (`filePath`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `auth` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `chatMessage` (
	`id` text PRIMARY KEY NOT NULL,
	`sessionID` text NOT NULL,
	`parentID` text,
	`format` text NOT NULL,
	`content` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`sessionID`) REFERENCES `chatSession`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parentID`) REFERENCES `chatMessage`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_chatMessage_sessionID` ON `chatMessage` (`sessionID`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_chatMessage_parentID` ON `chatMessage` (`parentID`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_chatMessage_createdAt` ON `chatMessage` (`createdAt`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `chatProvider` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`baseUrl` text,
	`models` text,
	`model` text,
	`enabled` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_chatProvider_kind` ON `chatProvider` (`kind`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `chatSession` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`providerID` text,
	`workspaceID` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`providerID`) REFERENCES `chatProvider`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_chatSession_updatedAt` ON `chatSession` (`updatedAt`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_chatSession_providerID` ON `chatSession` (`providerID`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_chatSession_workspaceID` ON `chatSession` (`workspaceID`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `magneticTile` (
	`id` text PRIMARY KEY NOT NULL,
	`index` integer NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`round` text,
	`mark` text,
	`component` text NOT NULL,
	`description` text,
	`size` integer DEFAULT 3 NOT NULL,
	`shape` text DEFAULT 'rectangle' NOT NULL,
	`direction` text DEFAULT 'horizontal' NOT NULL,
	`background` text,
	`backdrop` text,
	`mirrorID` text NOT NULL,
	`textColor` text,
	`collectionID` text,
	`downloadCount` integer DEFAULT 0 NOT NULL,
	`archivedAt` integer,
	`updatedAt` integer NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_magnetic_tile_mirror` ON `magneticTile` (`mirrorID`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mirror` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`index` integer NOT NULL,
	`mark` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '暂无描述' NOT NULL,
	`overlay` text DEFAULT '' NOT NULL,
	`background` text,
	`backdrop` text,
	`archivedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `overlay` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`w` real NOT NULL,
	`h` real NOT NULL,
	`z` integer NOT NULL,
	`src` text,
	`opacity` real,
	`tenantID` text,
	`component` text,
	`size` integer,
	`shape` text,
	`direction` text,
	`round` text,
	`background` text,
	`title` text DEFAULT '' NOT NULL,
	`mark` text,
	`scale` real DEFAULT 1 NOT NULL,
	`archivedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_overlay_archivedAt` ON `overlay` (`archivedAt`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_overlay_tenantID` ON `overlay` (`tenantID`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `calendar` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`startAt` integer NOT NULL,
	`endAt` integer NOT NULL,
	`entireDay` integer DEFAULT false NOT NULL,
	`color` text,
	`reminderID` text,
	`archivedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`reminderID`) REFERENCES `reminder`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_calendar_startAt` ON `calendar` (`startAt`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_calendar_reminderID` ON `calendar` (`reminderID`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `countdown` (
	`id` text PRIMARY KEY NOT NULL,
	`workStart` text DEFAULT '09:00' NOT NULL,
	`workEnd` text DEFAULT '18:00' NOT NULL,
	`workDays` text DEFAULT '[1,2,3,4,5]' NOT NULL,
	`monthlySalary` real DEFAULT 0 NOT NULL,
	`payDay` integer DEFAULT 15 NOT NULL,
	`archivedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `reminder` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`dueAt` integer,
	`endAt` integer,
	`fireTime` text,
	`weekDays` text DEFAULT '[]' NOT NULL,
	`entireDay` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`snoozeUntil` integer,
	`lastFiredAt` integer,
	`priority` integer DEFAULT 0 NOT NULL,
	`archivedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_reminder_dueAt` ON `reminder` (`dueAt`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_reminder_fireTime` ON `reminder` (`fireTime`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_reminder_enabled` ON `reminder` (`enabled`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_reminder_archivedAt` ON `reminder` (`archivedAt`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`icon` text DEFAULT 'folder' NOT NULL,
	`color` text DEFAULT '#166534' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`archivedAt` integer,
	`sort` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_workspace_sort` ON `workspace` (`sort`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_workspace_archivedAt` ON `workspace` (`archivedAt`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `workspaceFolder` (
	`id` text PRIMARY KEY NOT NULL,
	`workspaceID` text NOT NULL,
	`path` text NOT NULL,
	`isPrimary` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`workspaceID`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `workspaceFolder_path_unique` ON `workspaceFolder` (`path`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_workspaceFolder_workspaceID` ON `workspaceFolder` (`workspaceID`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_workspaceFolder_sort` ON `workspaceFolder` (`sort`);
--> statement-breakpoint
-- 种子数据：139 条 INSERT OR IGNORE（client 已废弃，不再同步）。

INSERT OR IGNORE INTO countdown (id, workStart, workEnd, workDays, monthlySalary, payDay, archivedAt, createdAt, updatedAt) VALUES ('00000000-0000-0000-0000-000000000001', '09:00', '18:00', '[1,2,3,4,5]', 0.0, 15, NULL, CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
--> statement-breakpoint
INSERT OR IGNORE INTO mirror (id, title, [index], mark, description, overlay, background, backdrop, archivedAt, createdAt, updatedAt) VALUES ('b7bc5d50-3b4a-46d7-b834-2938df56de24', '镜像-01', 0, '', '默认镜像', '#000000AA', NULL, NULL, NULL, 1785423438774, 1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('d50246f5-1a28-4659-b002-a31448c1382d',0,'书签',NULL,'12px',NULL,'bookmark','书签','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('a9908a07-e685-49d9-a517-0caf7ce27e75',1,'日历',NULL,'12px',NULL,'calendar','日历','{"color":"#FFFFFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('b0ed3c9e-9bec-409f-9303-e4b51f361d0d',2,'时钟',NULL,'12px',NULL,'clock','时钟','{"color":"#FFFFFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('0dac7ddf-c4ee-46cd-88cf-802d0f32ee08',3,'倒计时',NULL,'12px',NULL,'countdown','倒计时','{"color":"#FFFFFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('9c06aee0-dfa2-4807-bd8b-d51cde7d5687',4,'代码',NULL,'12px',NULL,'code','代码','{"color":"#E2E8F0"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('5c03e12b-f7c1-4312-a9f5-ebe410915f1e',5,'Clipchamp',NULL,'12px',NULL,'clipchamp','Clipchamp','{"color":"#DBEAFE"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','1E3A8A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('9ba4c4a7-ccd7-4965-b447-5d74a9f96b56',6,'应用集合',NULL,'12px',NULL,'collection','应用集合','{"color":"#E0E7FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','312E81',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('bc55915c-5552-4e65-95c6-bb88c28f8060',7,'应用商店',NULL,'12px',NULL,'marketplace','应用商店','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','1E40AF',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('63e46df5-44a7-494f-a9ca-b4303186a511',8,'知识库',NULL,'12px',NULL,'knowledge','知识库','{"color":"#ECFDF5"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','065F46',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('447f9800-edaa-4f85-a0f1-97b76e375706',9,'morph',NULL,'12px',NULL,'morph','morph','{"color":"#F5F3FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','5B21B6',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('705ad233-7068-4c45-a079-967e5a79a6d6',10,'设置',NULL,'12px',NULL,'settings','设置','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('f3ed970a-b07c-44bc-b54d-4bdfb454f207',11,'AI Hub',NULL,'12px',NULL,'intelligence','AI Hub','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','3730A3',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('4079625f-fbf4-4c29-8b1a-3b2236aeaf37',12,'开发者',NULL,'12px',NULL,'developer','开发者','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','334155',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('34bca8e6-b96f-498b-a0f1-86aba76663db',13,'图库',NULL,'12px',NULL,'gallery','图库','{"color":"#FFF7ED"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','9A3412',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('83bbda55-d029-4a24-bb76-328843d616f9',14,'看板',NULL,'12px',NULL,'signboard','看板','{"color":"#FEF3C7"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','92400E',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('f4e10078-03d0-45b8-86f9-4f7cab94abf9',15,'截屏',NULL,'12px',NULL,'capture','截屏','{"color":"#F0FDFA"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','115E59',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('6f7714eb-bfa1-4b15-b56f-d095ff9100a3',16,'百度','https://www.baidu.com','12px',NULL,'navigation','百度','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('4bd86ab9-4212-4558-a4c2-38db37f591e3',17,'谷歌','https://www.google.com','12px',NULL,'navigation','谷歌','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('f2e2547d-9745-4197-b349-8638d278cc36',18,'必应','https://cn.bing.com','12px',NULL,'navigation','必应','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('03e9bb30-3691-4a07-8c74-80efd5c853b8',19,'搜狗','https://www.sogou.com','12px',NULL,'navigation','搜狗','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('17431d5f-1c90-45e5-bf5e-e9ffa4adea1d',20,'淘宝','https://www.taobao.com','12px',NULL,'navigation','淘宝','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('23b6ab4b-a8fd-4ce1-86b7-27026b72b255',21,'天猫','https://www.tmall.com','12px',NULL,'navigation','天猫','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('efe7323e-ca08-4271-a722-2520a04cf9cb',22,'京东','https://www.jd.com','12px',NULL,'navigation','京东','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('351a16cb-fc35-470e-bfd1-99bc596269ad',23,'拼多多','https://www.pinduoduo.com','12px',NULL,'navigation','拼多多','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('af6c2295-6a68-41bf-a5c9-d57e690c5b75',24,'唯品会','https://www.vip.com','12px',NULL,'navigation','唯品会','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('aa1a8732-390b-4855-b82c-c9d10720cfd6',25,'苏宁','https://www.suning.com','12px',NULL,'navigation','苏宁','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('bc096178-12f6-4693-9b1b-70d58b92b67c',26,'亚马逊','https://www.amazon.cn','12px',NULL,'navigation','亚马逊','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('95ac781e-cefa-4cdd-bf13-395b241e3f0a',27,'微博','https://www.weibo.com','12px',NULL,'navigation','微博','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('24c0121d-bd8a-487c-89c5-361a9b09bf00',28,'知乎','https://www.zhihu.com','12px',NULL,'navigation','知乎','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('e9905858-0692-49d3-bcdf-4c232c9f79b1',29,'豆瓣','https://www.douban.com','12px',NULL,'navigation','豆瓣','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('1577b2b3-4dc3-4ad4-a23d-a5761523824a',30,'小红书','https://www.xiaohongshu.com','12px',NULL,'navigation','小红书','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('d42bfd7a-9995-4a5e-84c4-023069d14e16',31,'抖音','https://www.douyin.com','12px',NULL,'navigation','抖音','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('c414e0b5-fabf-4608-b09d-fcca0f75e687',32,'快手','https://www.kuaishou.com','12px',NULL,'navigation','快手','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('eea094dc-8069-4f53-9786-a095c0359dee',33,'哔哩哔哩','https://www.bilibili.com','12px',NULL,'navigation','哔哩哔哩','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('19773bd4-226b-4c9c-b2ee-8b86388218a7',34,'爱奇艺','https://www.iqiyi.com','12px',NULL,'navigation','爱奇艺','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('31445583-32e0-4cdc-95eb-0037d5a9430f',35,'优酷','https://www.youku.com','12px',NULL,'navigation','优酷','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('a80858a7-e4db-44f5-8915-51912c54718d',36,'腾讯视频','https://v.qq.com','12px',NULL,'navigation','腾讯视频','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('3419baa2-01dc-42b5-8f6e-ffe6dea0f07d',37,'芒果TV','https://www.mgtv.com','12px',NULL,'navigation','芒果TV','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('7a9354a9-9994-49be-8b02-18c4e3a265a5',38,'网易云音乐','https://music.163.com','12px',NULL,'navigation','网易云音乐','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('8e3f9f3e-0021-4844-8d2d-4d2b34d64a6a',39,'QQ音乐','https://y.qq.com','12px',NULL,'navigation','QQ音乐','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('7a5b8084-26f7-40d7-a23d-650219517e67',40,'喜马拉雅','https://www.ximalaya.com','12px',NULL,'navigation','喜马拉雅','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('9d4925e5-4900-4141-8c5d-f3cb459b1de2',41,'今日头条','https://www.toutiao.com','12px',NULL,'navigation','今日头条','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('79697495-caa5-411c-ac92-b0d04696a140',42,'澎湃新闻','https://www.thepaper.cn','12px',NULL,'navigation','澎湃新闻','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('86261827-496d-4547-aacc-01421ca564bc',43,'新浪','https://www.sina.com.cn','12px',NULL,'navigation','新浪','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('6a53ed91-1feb-4dc8-914d-95ee39f7c093',44,'网易','https://www.163.com','12px',NULL,'navigation','网易','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('6f32556e-2bc8-4705-bc5e-cfaa399bf3fe',45,'搜狐','https://www.sohu.com','12px',NULL,'navigation','搜狐','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('65ac9a9a-3c2f-4ab8-a69d-3a0526ce03c2',46,'凤凰网','https://www.ifeng.com','12px',NULL,'navigation','凤凰网','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('1af5dae8-7e3d-47ac-a5fd-e6d34194b2ca',47,'央视网','https://www.cctv.com','12px',NULL,'navigation','央视网','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('6b26ffde-9706-43b3-9cab-99c0ddf35a3f',48,'人民网','https://www.people.com.cn','12px',NULL,'navigation','人民网','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('13be255a-ef23-4db2-bee7-41f223680518',49,'新华网','https://www.xinhuanet.com','12px',NULL,'navigation','新华网','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('41b66840-d6a6-4f98-8aba-f669b9140e1f',50,'QQ','https://www.qq.com','12px',NULL,'navigation','QQ','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('1531bce3-d3d1-4adb-8dd5-263622278aa7',51,'微信','https://weixin.qq.com','12px',NULL,'navigation','微信','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('068d74e8-e37f-4e29-9d6d-c41a6c3a1b53',52,'美团','https://www.meituan.com','12px',NULL,'navigation','美团','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('579cc41b-bd2a-40a4-b616-eb583136bb2f',53,'大众点评','https://www.dianping.com','12px',NULL,'navigation','大众点评','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('c970652c-d2b7-4d11-93e8-1520cd6444a0',54,'饿了么','https://www.ele.me','12px',NULL,'navigation','饿了么','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('fdaadd19-0457-4a5d-8a46-b0c07d7486f3',55,'携程','https://www.ctrip.com','12px',NULL,'navigation','携程','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('0088a65f-3778-44b1-81c5-7e9d89942476',56,'去哪儿','https://www.qunar.com','12px',NULL,'navigation','去哪儿','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('eefce361-dcae-4bee-bdfb-b9f674b58a37',57,'飞猪','https://www.fliggy.com','12px',NULL,'navigation','飞猪','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('7204a70e-c65e-4fee-8b93-2aa939c397ee',58,'12306','https://www.12306.cn','12px',NULL,'navigation','12306','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('c422c1de-1ed0-49c8-afd2-3ed1f583b403',59,'高德地图','https://www.amap.com','12px',NULL,'navigation','高德地图','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('3fe7ac92-5a3e-43a1-8c11-57fe951b23d2',60,'百度地图','https://map.baidu.com','12px',NULL,'navigation','百度地图','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('1612badf-f7fa-4754-96fa-330f584a1143',61,'滴滴','https://www.didiglobal.com','12px',NULL,'navigation','滴滴','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('782a6f99-65db-48e4-8e0b-bef5366ba6dd',62,'GitHub','https://github.com','12px',NULL,'navigation','GitHub','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('1c09b1b2-f445-492a-9a3b-165e3c340e0a',63,'Gitee','https://gitee.com','12px',NULL,'navigation','Gitee','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('5c8532e2-ec5d-4e9b-acdd-36d6312e8ce4',64,'GitLab','https://gitlab.com','12px',NULL,'navigation','GitLab','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('e05d0af1-afcd-468a-8c41-a7b18a6b29a5',65,'Stack Overflow','https://stackoverflow.com','12px',NULL,'navigation','Stack Overflow','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('42da558d-e8e6-4dd4-99a7-b8e9ecdafc88',66,'MDN','https://developer.mozilla.org','12px',NULL,'navigation','MDN','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('af4721f2-a8bf-4ac8-af07-ab882e87a0f3',67,'npm','https://www.npmjs.com','12px',NULL,'navigation','npm','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('b8eabeb4-26f6-4a2b-b820-eab21a0ef3dc',68,'Rust','https://www.rust-lang.org','12px',NULL,'navigation','Rust','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('7960facb-f64c-4f8c-a613-53cfd9d094df',69,'Vue','https://vuejs.org','12px',NULL,'navigation','Vue','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('497fdc3a-5a3a-41ba-9432-d3c97cc8565c',70,'React','https://react.dev','12px',NULL,'navigation','React','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('57ddf3b0-d1a5-4e03-9f08-d20320f7f49b',71,'TypeScript','https://www.typescriptlang.org','12px',NULL,'navigation','TypeScript','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('08941c90-b9bb-4a10-ad18-d23c20467c16',72,'Vite','https://vitejs.dev','12px',NULL,'navigation','Vite','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('73d3133a-1640-4af0-99a5-49170390c17d',73,'Tailwind','https://tailwindcss.com','12px',NULL,'navigation','Tailwind','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('efa65bcb-c9be-453e-b208-bec00b010d26',74,'Ant Design','https://ant.design','12px',NULL,'navigation','Ant Design','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('7d2462fb-3e50-4535-9c67-d108f38af375',75,'Element Plus','https://element-plus.org','12px',NULL,'navigation','Element Plus','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('50696631-41c9-49db-b43f-71edcd25ad1d',76,'Iconify','https://icon-sets.iconify.design','12px',NULL,'navigation','Iconify','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('4b2a5c18-47bc-46ac-b30f-831a1b8f137a',77,'Can I Use','https://caniuse.com','12px',NULL,'navigation','Can I Use','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('3690f123-7b55-4914-9d18-15e14a74d6dc',78,'正则101','https://regex101.com','12px',NULL,'navigation','正则101','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('718b6155-26ff-4170-9457-c81f15e803f8',79,'JSON','https://json.cn','12px',NULL,'navigation','JSON','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('5db1b934-a452-49e0-b1c3-000f5990d4f5',80,'Excalidraw','https://excalidraw.com','12px',NULL,'navigation','Excalidraw','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('c2285e63-91ac-453a-8783-08ef2304875c',81,'Figma','https://www.figma.com','12px',NULL,'navigation','Figma','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('376c0894-8fcd-468d-b96e-14e4bfe2c519',82,'Notion','https://www.notion.so','12px',NULL,'navigation','Notion','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('b0cefb37-33db-4992-a453-2607296d46ac',83,'语雀','https://www.yuque.com','12px',NULL,'navigation','语雀','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('baaef2e9-1a81-4c6b-962d-b33284272f73',84,'飞书','https://www.feishu.cn','12px',NULL,'navigation','飞书','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('c3b1e910-7ac7-4526-ba3d-cf3d0a903006',85,'钉钉','https://www.dingtalk.com','12px',NULL,'navigation','钉钉','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('5d29ccb2-933d-43f7-94f6-1d6334b1c5f9',86,'腾讯文档','https://docs.qq.com','12px',NULL,'navigation','腾讯文档','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('2a876e1a-1996-466d-af46-a99a21774aa8',87,'石墨文档','https://shimo.im','12px',NULL,'navigation','石墨文档','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('f57e37ee-4335-42f7-91fb-8417e31e61c6',88,'CSDN','https://www.csdn.net','12px',NULL,'navigation','CSDN','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('c8e69a5a-42c1-4fcb-9976-2d595b5c39bf',89,'掘金','https://juejin.cn','12px',NULL,'navigation','掘金','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('66e368ae-5e33-49fb-a36a-431b543c2e42',90,'思否','https://segmentfault.com','12px',NULL,'navigation','思否','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('cf964a4c-6485-4bae-b145-6781ffe9ec68',91,'开源中国','https://www.oschina.net','12px',NULL,'navigation','开源中国','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('a07875e7-1345-4e50-b675-59ef91eb8ddd',92,'V2EX','https://www.v2ex.com','12px',NULL,'navigation','V2EX','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('3fb55802-a145-4c75-9371-997acc3ddae5',93,'少数派','https://sspai.com','12px',NULL,'navigation','少数派','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('8018c361-dc2b-45d2-8b6b-e451b55db7fb',94,'即刻','https://web.okjike.com','12px',NULL,'navigation','即刻','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('fdc45c93-cf66-46e2-b830-70141de8cf47',95,'YouTube','https://www.youtube.com','12px',NULL,'navigation','YouTube','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('2b5259a5-d66b-41f1-81c8-8dc3e57ceb14',96,'Twitter','https://x.com','12px',NULL,'navigation','Twitter','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('c5198173-723f-4bc0-8042-91130566c8d2',97,'Reddit','https://www.reddit.com','12px',NULL,'navigation','Reddit','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('a43096ef-c9df-4e08-a57a-ba4020937de7',98,'Wikipedia','https://www.wikipedia.org','12px',NULL,'navigation','Wikipedia','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('48b51c2e-7f61-43c6-9cf8-e10fb45ef799',99,'ChatGPT','https://chatgpt.com','12px',NULL,'navigation','ChatGPT','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('1afca13c-c686-41ed-9d91-8837126bd8c4',100,'Claude','https://claude.ai','12px',NULL,'navigation','Claude','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('a4dbc3e2-15e7-4423-be57-ce708a05de0b',101,'Gemini','https://gemini.google.com','12px',NULL,'navigation','Gemini','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('0d7669f0-1ada-4064-9251-cc71289fe714',102,'DeepSeek','https://chat.deepseek.com','12px',NULL,'navigation','DeepSeek','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('d0fe983b-2db5-4137-9169-16f8cd457b32',103,'通义千问','https://tongyi.aliyun.com','12px',NULL,'navigation','通义千问','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('732bddb5-1fbf-4f4a-9ae5-08d1d82a34d2',104,'Kimi','https://kimi.moonshot.cn','12px',NULL,'navigation','Kimi','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('c55e845f-7d06-4578-9e7e-ff1c43649a38',105,'文心一言','https://yiyan.baidu.com','12px',NULL,'navigation','文心一言','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('4a53f95d-7ec8-4454-b371-cc7f64eb37a9',106,'智谱清言','https://chatglm.cn','12px',NULL,'navigation','智谱清言','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('07c5ecd9-27be-48da-943e-209d8f5b5b47',107,'LeetCode','https://leetcode.cn','12px',NULL,'navigation','LeetCode','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('6081db3b-97c2-4f55-be8b-88f751c50bb2',108,'牛客','https://www.nowcoder.com','12px',NULL,'navigation','牛客','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('82b7457d-93ca-4052-9ed3-39f1577b85b4',109,'Coursera','https://www.coursera.org','12px',NULL,'navigation','Coursera','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('3c6fdafd-c293-4548-a97d-8c3579d6d60a',110,'B站课堂','https://www.bilibili.com/cheese','12px',NULL,'navigation','B站课堂','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('5aa8b078-f8b4-4ce2-b2b6-1f90314c36fc',111,'中国大学MOOC','https://www.icourse163.org','12px',NULL,'navigation','中国大学MOOC','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('1cdc2c31-cad1-4eea-b492-ffbc47dcc348',112,'支付宝','https://www.alipay.com','12px',NULL,'navigation','支付宝','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('af30a364-b8e7-4afe-a315-af4212b141a4',113,'招商银行','https://www.cmbchina.com','12px',NULL,'navigation','招商银行','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('634b63c3-ca81-476a-99b0-ce0c07276c3c',114,'东方财富','https://www.eastmoney.com','12px',NULL,'navigation','东方财富','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('b1b9d20b-9e23-4ae1-8698-d2911b7326df',115,'雪球','https://xueqiu.com','12px',NULL,'navigation','雪球','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('d758f23a-cd1d-4a42-abd8-b15392229546',116,'闲鱼','https://www.goofish.com','12px',NULL,'navigation','闲鱼','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('3aa9d82c-8d67-4f13-a902-d75ef3633794',117,'什么值得买','https://www.smzdm.com','12px',NULL,'navigation','什么值得买','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('d6023a0a-adeb-4776-b8be-edee221a8f6f',118,'汽车之家','https://www.autohome.com.cn','12px',NULL,'navigation','汽车之家','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('907a747c-8636-4499-afd5-4146eace73c7',119,'安居客','https://www.anjuke.com','12px',NULL,'navigation','安居客','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('b57cf7f4-a8e3-4501-87b7-8a9e333e8768',120,'链家','https://www.lianjia.com','12px',NULL,'navigation','链家','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('36cbdf06-95dc-479c-a6c6-6c705de8f4a5',121,'Boss直聘','https://www.zhipin.com','12px',NULL,'navigation','Boss直聘','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('f0f4b870-d4ca-461d-bbda-f2de3aa67c0b',122,'智联招聘','https://www.zhaopin.com','12px',NULL,'navigation','智联招聘','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('be436f78-a7c2-438b-8250-327a6b0eadf3',123,'拉勾','https://www.lagou.com','12px',NULL,'navigation','拉勾','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('10bcf04e-a64b-47f3-92f8-83d72f0eb93a',124,'译学馆','https://www.yxgapp.com','12px',NULL,'navigation','译学馆','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('83d74d02-594b-451c-8847-9531eae3fd93',125,'IconFont','https://www.iconfont.cn','12px',NULL,'navigation','IconFont','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('aaac07f3-2964-4884-8381-64590cd75748',126,'Unsplash','https://unsplash.com','12px',NULL,'navigation','Unsplash','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('b3c4fddc-458d-414f-9a31-eb1c311591e6',127,'Pexels','https://www.pexels.com','12px',NULL,'navigation','Pexels','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('73c5f14c-025d-4e68-8f05-669c81e4afae',128,'Dribbble','https://dribbble.com','12px',NULL,'navigation','Dribbble','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('18fe5caa-c810-433c-9321-65f30293e5ea',129,'Product Hunt','https://www.producthunt.com','12px',NULL,'navigation','Product Hunt','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('d52d0323-da74-4261-9157-ba46a89ab7a7',130,'Hacker News','https://news.ycombinator.com','12px',NULL,'navigation','Hacker News','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('47a04baa-646e-4e5d-9434-2731d32f9819',131,'Arch Wiki','https://wiki.archlinux.org','12px',NULL,'navigation','Arch Wiki','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('621382a2-0911-448b-8ef2-a3980e09ddce',132,'Docker Hub','https://hub.docker.com','12px',NULL,'navigation','Docker Hub','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('29bb5423-6f90-4520-957a-503d9e541d2b',133,'Cloudflare','https://www.cloudflare.com','12px',NULL,'navigation','Cloudflare','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('ea161ec5-391a-49ce-9d78-fe91f96519bd',134,'Vercel','https://vercel.com','12px',NULL,'navigation','Vercel','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('3175fa5c-195f-4311-9d18-ecbc7c29f6d5',135,'Netlify','https://www.netlify.com','12px',NULL,'navigation','Netlify','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
--> statement-breakpoint
INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('b2c3d4e5-6f70-4a81-9b2c-3d4e5f6a7b8c',136,'指令',NULL,'12px',NULL,'directive','指令','{"color":"#F5F3FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','5B21B6',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774);
