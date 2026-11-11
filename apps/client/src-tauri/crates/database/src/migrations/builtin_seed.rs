//! 自研磁贴种子（配色 + 显示名）。开发期改这里即可，并入 `migrations_0001`。

const MIRROR_ID: &str = "b7bc5d50-3b4a-46d7-b834-2938df56de24";
const TS: i64 = 1785423438774;

/// (id, wall_index, title, background_hex, text_hex)
pub const BUILTIN: &[(&str, i32, &str, &str, &str)] = &[
    (
        "d50246f5-1a28-4659-b002-a31448c1382d",
        0,
        "书签",
        "#2563EB",
        "FFFFFF",
    ),
    (
        "a9908a07-e685-49d9-a517-0caf7ce27e75",
        1,
        "日历",
        "#FFFFFF",
        "0F172A",
    ),
    (
        "b0ed3c9e-9bec-409f-9303-e4b51f361d0d",
        2,
        "时钟",
        "#FFFFFF",
        "0F172A",
    ),
    (
        "0dac7ddf-c4ee-46cd-88cf-802d0f32ee08",
        3,
        "倒计时",
        "#FFFFFF",
        "0F172A",
    ),
    (
        "9c06aee0-dfa2-4807-bd8b-d51cde7d5687",
        4,
        "编辑器",
        "#1E293B",
        "F8FAFC",
    ),
    (
        "5c03e12b-f7c1-4312-a9f5-ebe410915f1e",
        5,
        "剪辑",
        "#0284C7",
        "FFFFFF",
    ),
    (
        "bc55915c-5552-4e65-95c6-bb88c28f8060",
        6,
        "商店",
        "#1D4ED8",
        "FFFFFF",
    ),
    (
        "63e46df5-44a7-494f-a9ca-b4303186a511",
        7,
        "知识库",
        "#047857",
        "FFFFFF",
    ),
    (
        "447f9800-edaa-4f85-a0f1-97b76e375706",
        8,
        "PDF",
        "#6D28D9",
        "FFFFFF",
    ),
    (
        "705ad233-7068-4c45-a079-967e5a79a6d6",
        9,
        "设置",
        "#475569",
        "FFFFFF",
    ),
    (
        "f3ed970a-b07c-44bc-b54d-4bdfb454f207",
        10,
        "Agent",
        "#4338CA",
        "FFFFFF",
    ),
    (
        "34bca8e6-b96f-498b-a0f1-86aba76663db",
        11,
        "图库",
        "#C2410C",
        "FFFFFF",
    ),
    (
        "83bbda55-d029-4a24-bb76-328843d616f9",
        12,
        "看板",
        "#B45309",
        "FFFFFF",
    ),
    (
        "f4e10078-03d0-45b8-86f9-4f7cab94abf9",
        13,
        "截录",
        "#44403C",
        "FFFFFF",
    ),
    (
        "b2c3d4e5-6f70-4a81-9b2c-3d4e5f6a7b8c",
        14,
        "指令",
        "#7C3AED",
        "FFFFFF",
    ),
];

/// component 与 id 一一对应（种子插入用）
const COMPONENTS: &[(&str, &str)] = &[
    ("d50246f5-1a28-4659-b002-a31448c1382d", "bookmark"),
    ("a9908a07-e685-49d9-a517-0caf7ce27e75", "calendar"),
    ("b0ed3c9e-9bec-409f-9303-e4b51f361d0d", "clock"),
    ("0dac7ddf-c4ee-46cd-88cf-802d0f32ee08", "countdown"),
    ("9c06aee0-dfa2-4807-bd8b-d51cde7d5687", "code"),
    ("5c03e12b-f7c1-4312-a9f5-ebe410915f1e", "clipchamp"),
    ("bc55915c-5552-4e65-95c6-bb88c28f8060", "marketplace"),
    ("63e46df5-44a7-494f-a9ca-b4303186a511", "knowledge"),
    ("447f9800-edaa-4f85-a0f1-97b76e375706", "morph"),
    ("705ad233-7068-4c45-a079-967e5a79a6d6", "settings"),
    ("f3ed970a-b07c-44bc-b54d-4bdfb454f207", "agent"),
    ("34bca8e6-b96f-498b-a0f1-86aba76663db", "gallery"),
    ("83bbda55-d029-4a24-bb76-328843d616f9", "signboard"),
    ("f4e10078-03d0-45b8-86f9-4f7cab94abf9", "capture"),
    ("b2c3d4e5-6f70-4a81-9b2c-3d4e5f6a7b8c", "directive"),
];

fn find_component(id: &str) -> &'static str {
    COMPONENTS
        .iter()
        .find(|(tile_id, _)| *tile_id == id)
        .map(|(_, component)| *component)
        .unwrap_or("example")
}

pub fn insert_statements() -> Vec<String> {
    BUILTIN
        .iter()
        .map(|(id, index, title, bg, text)| {
            let background = format!(r#"{{"color":"{bg}"}}"#);
            let component = find_component(id);
            format!(
                "INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('{id}',{index},'{title}',NULL,'12px',NULL,'{component}','{title}','{background}',NULL,'{MIRROR_ID}','{text}',NULL,1,'square','vertical',0,NULL,{TS},{TS})"
            )
        })
        .collect()
}
