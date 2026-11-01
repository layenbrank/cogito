/**
 * 生成 navigation_seed.rs。
 * 仅写种子配置；运行时不读本文件映射（无域名特化拉取）。
 *
 * 配色：
 * - si: 品牌实色底 + 白/深色矢量
 * - g: Google s2 彩标（白底）；无 SI 时用
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const seedPath =
  'C:/Users/MACHENIKE/AppData/Local/Cursor/AgentStores/cursor_agent_stores/d5f30b50-69f2-43cd-8037-fd601e178dfc/files/navigation_seeds_v001.json'
const raw = fs.readFileSync(seedPath, 'utf8')
const match = raw.match(/\[\r?\n\s*\{/)
if (!match || match.index === undefined) {
  console.error('Could not find seed array')
  process.exit(1)
}
const seeds = JSON.parse(raw.slice(match.index))

/** 墙面分类集合：子导航挂 collectionID，不再平铺 */
const COLLECTIONS = [
  {
    id: '9ba4c4a7-ccd7-4965-b447-5d74a9f96b56',
    title: '搜索',
    bg: '#FFFFFF',
    text: '0F172A',
    titles: ['百度', '谷歌', '必应', '搜狗']
  },
  {
    id: 'e2ae5afe-d42e-4539-b942-3ab2a0771c82',
    title: '购物',
    bg: '#FFFFFF',
    text: '0F172A',
    titles: [
      '淘宝',
      '天猫',
      '京东',
      '拼多多',
      '唯品会',
      '苏宁',
      '亚马逊',
      '闲鱼',
      '什么值得买'
    ]
  },
  {
    id: '7f3c23ec-492c-4c15-9183-b3629bc9fd04',
    title: '社交',
    bg: '#FFFFFF',
    text: '0F172A',
    titles: ['微博', '知乎', '豆瓣', '小红书', '抖音', '快手', 'QQ', '微信']
  },
  {
    id: '99c15c6a-4e9a-4157-bc58-34a0a846697c',
    title: '影音',
    bg: '#FFFFFF',
    text: '0F172A',
    titles: [
      '哔哩哔哩',
      '爱奇艺',
      '优酷',
      '腾讯视频',
      '芒果TV',
      '网易云音乐',
      'QQ音乐',
      '喜马拉雅',
      'YouTube'
    ]
  },
  {
    id: 'e75bb91d-d4d3-40a0-990d-816c0aff8825',
    title: '资讯',
    bg: '#FFFFFF',
    text: '0F172A',
    titles: [
      '今日头条',
      '澎湃新闻',
      '新浪',
      '网易',
      '搜狐',
      '凤凰网',
      '央视网',
      '人民网',
      '新华网'
    ]
  },
  {
    id: 'b2b289d1-8b9e-4242-abf5-2f61c9e2f5d5',
    title: '生活',
    bg: '#FFFFFF',
    text: '0F172A',
    titles: [
      '美团',
      '大众点评',
      '饿了么',
      '携程',
      '去哪儿',
      '飞猪',
      '12306',
      '高德地图',
      '百度地图',
      '滴滴',
      '支付宝',
      '招商银行',
      '东方财富',
      '雪球',
      '汽车之家',
      '安居客',
      '链家'
    ]
  },
  {
    id: 'd2c015c9-aaef-4150-b910-2fffe0dce674',
    title: '开发',
    bg: '#FFFFFF',
    text: '0F172A',
    titles: [
      'GitHub',
      'Gitee',
      'GitLab',
      'Stack Overflow',
      'MDN',
      'npm',
      'Rust',
      'Vue',
      'React',
      'TypeScript',
      'Vite',
      'Tailwind',
      'Ant Design',
      'Element Plus',
      'Iconify',
      'Can I Use',
      '正则101',
      'JSON',
      'Docker Hub',
      'Cloudflare',
      'Vercel',
      'Netlify',
      'Arch Wiki',
      'Hacker News'
    ]
  },
  {
    id: '2c7e8425-7d72-4552-aea5-e2997569211a',
    title: '效率',
    bg: '#FFFFFF',
    text: '0F172A',
    titles: ['Excalidraw', 'Figma', 'Notion', '语雀', '飞书', '钉钉', '腾讯文档', '石墨文档']
  },
  {
    id: '32e1267a-e8e9-4431-a6fa-d0371b45d77c',
    title: '社区',
    bg: '#FFFFFF',
    text: '0F172A',
    titles: ['CSDN', '掘金', '思否', '开源中国', 'V2EX', '少数派', '即刻', 'Twitter', 'Reddit', 'Wikipedia']
  },
  {
    id: '7900cb78-3818-4d2b-905b-1ec7bbf6f69d',
    title: 'AI',
    bg: '#FFFFFF',
    text: '0F172A',
    titles: ['ChatGPT', 'Claude', 'Gemini', 'DeepSeek', '通义千问', 'Kimi', '文心一言', '智谱清言']
  },
  {
    id: '4ccdb143-2ed5-4aff-83bf-5e1738e7f45d',
    title: '学习',
    bg: '#FFFFFF',
    text: '0F172A',
    titles: ['LeetCode', '牛客', 'Coursera', 'B站课堂', '中国大学MOOC', '译学馆']
  },
  {
    id: 'da411c92-80d0-4617-aca0-8dd498d0cce8',
    title: '求职',
    bg: '#FFFFFF',
    text: '0F172A',
    titles: ['Boss直聘', '智联招聘', '拉勾']
  },
  {
    id: 'bf97ab1a-abaa-4a04-b8d3-3072e5fa7287',
    title: '设计',
    bg: '#FFFFFF',
    text: '0F172A',
    titles: ['IconFont', 'Unsplash', 'Pexels', 'Dribbble', 'Product Hunt']
  }
]

/** [bg, text, markToken] */
const SEED = {
  百度: ['#2932E1', 'FFFFFF', 'si:baidu/ffffff'],
  谷歌: ['#F8FAFC', '0F172A', 'g:www.google.com'],
  必应: ['#DBEAFE', '1E40AF', 'g:cn.bing.com'],
  搜狗: ['#FF6200', 'FFFFFF', 'si:sogou/ffffff'],
  淘宝: ['#FF5000', 'FFFFFF', 'si:taobao/ffffff'],
  // 电商：favicon 自带色块 → 品牌底 + 字形（种子定制，非运行时特例）
  天猫: ['#FFFFFF', '0F172A', 'g:tmall.com'],
  京东: ['#FFFFFF', '0F172A', 'g:jd.com'],
  拼多多: ['#FFFFFF', '0F172A', 'g:pinduoduo.com'],
  唯品会: ['#FFFFFF', '0F172A', 'g:vip.com'],
  苏宁: ['#FFFFFF', '0F172A', 'g:suning.com'],
  亚马逊: ['#FFFFFF', '0F172A', 'g:amazon.com'],
  微博: ['#E11D48', 'FFFFFF', 'si:sinaweibo/ffffff'],
  知乎: ['#0084FF', 'FFFFFF', 'si:zhihu/ffffff'],
  豆瓣: ['#00B51D', 'FFFFFF', 'si:douban/ffffff'],
  小红书: ['#FF2442', 'FFFFFF', 'si:xiaohongshu/ffffff'],
  抖音: ['#111827', 'F8FAFC', 'si:tiktok/ffffff'],
  快手: ['#FF4906', 'FFFFFF', 'si:kuaishou/ffffff'],
  哔哩哔哩: ['#FB7299', 'FFFFFF', 'si:bilibili/ffffff'],
  爱奇艺: ['#FFFFFF', '0F172A', 'g:iqiyi.com'],
  优酷: ['#FFFFFF', '0F172A', 'g:youku.com'],
  腾讯视频: ['#FFFFFF', '0F172A', 'g:v.qq.com'],
  芒果TV: ['#FFFFFF', '0F172A', 'g:mgtv.com'],
  网易云音乐: ['#FFFFFF', '0F172A', 'g:music.163.com'],
  QQ音乐: ['#FFFFFF', '0F172A', 'g:y.qq.com'],
  喜马拉雅: ['#FFFFFF', '0F172A', 'g:ximalaya.com'],
  今日头条: ['#FFFFFF', '0F172A', 'g:toutiao.com'],
  澎湃新闻: ['#FFFFFF', '0F172A', 'g:thepaper.cn'],
  新浪: ['#FFFFFF', '0F172A', 'g:sina.com.cn'],
  网易: ['#FFFFFF', '0F172A', 'g:163.com'],
  搜狐: ['#FFFFFF', '0F172A', 'g:sohu.com'],
  凤凰网: ['#FFFFFF', '0F172A', 'g:ifeng.com'],
  央视网: ['#FFFFFF', '0F172A', 'g:cctv.com'],
  人民网: ['#FFFFFF', '0F172A', 'g:people.com.cn'],
  新华网: ['#FFFFFF', '0F172A', 'g:xinhuanet.com'],
  QQ: ['#12B7F5', 'FFFFFF', 'si:qq/ffffff'],
  微信: ['#07C160', 'FFFFFF', 'si:wechat/ffffff'],
  美团: ['#FFD100', '1C1917', 'si:meituan/1c1917'],
  大众点评: ['#FFFFFF', '0F172A', 'g:dianping.com'],
  饿了么: ['#FFFFFF', '0F172A', 'g:ele.me'],
  携程: ['#FFFFFF', '0F172A', 'g:ctrip.com'],
  去哪儿: ['#FFFFFF', '0F172A', 'g:qunar.com'],
  飞猪: ['#FFFFFF', '0F172A', 'g:fliggy.com'],
  '12306': ['#FFFFFF', '0F172A', 'g:12306.cn'],
  高德地图: ['#FFFFFF', '0F172A', 'g:amap.com'],
  百度地图: ['#2932E1', 'FFFFFF', 'si:baidu/ffffff'],
  滴滴: ['#FFFFFF', '0F172A', 'g:didiglobal.com'],
  GitHub: ['#24292F', 'F8FAFC', 'si:github/ffffff'],
  Gitee: ['#C71D23', 'FFFFFF', 'si:gitee/ffffff'],
  GitLab: ['#FC6D26', 'FFFFFF', 'si:gitlab/ffffff'],
  'Stack Overflow': ['#F48024', 'FFFFFF', 'si:stackoverflow/ffffff'],
  MDN: ['#000000', 'F8FAFC', 'si:mdnwebdocs/ffffff'],
  npm: ['#CB3837', 'FFFFFF', 'si:npm/ffffff'],
  Rust: ['#DEA584', '1C1917', 'si:rust/000000'],
  Vue: ['#42B883', 'FFFFFF', 'si:vuedotjs/ffffff'],
  React: ['#087EA4', 'FFFFFF', 'si:react/ffffff'],
  TypeScript: ['#3178C6', 'FFFFFF', 'si:typescript/ffffff'],
  Vite: ['#646CFF', 'FFFFFF', 'si:vite/ffffff'],
  Tailwind: ['#38BDF8', '0F172A', 'si:tailwindcss/0f172a'],
  'Ant Design': ['#1677FF', 'FFFFFF', 'si:antdesign/ffffff'],
  'Element Plus': ['#FFFFFF', '0F172A', 'g:element-plus.org'],
  Iconify: ['#1769AA', 'FFFFFF', 'si:iconify/ffffff'],
  'Can I Use': ['#FEF3C7', '92400E', 'g:caniuse.com'],
  正则101: ['#E0E7FF', '3730A3', 'g:regex101.com'],
  JSON: ['#F1F5F9', '0F172A', 'g:www.json.org'],
  Excalidraw: ['#6965DB', 'FFFFFF', 'si:excalidraw/ffffff'],
  Figma: ['#F24E1E', 'FFFFFF', 'si:figma/ffffff'],
  Notion: ['#000000', 'F8FAFC', 'si:notion/ffffff'],
  语雀: ['#FFFFFF', '0F172A', 'g:yuque.com'],
  飞书: ['#FFFFFF', '0F172A', 'g:feishu.cn'],
  钉钉: ['#FFFFFF', '0F172A', 'g:dingtalk.com'],
  腾讯文档: ['#FFFFFF', '0F172A', 'g:docs.qq.com'],
  石墨文档: ['#FFFFFF', '0F172A', 'g:shimo.im'],
  CSDN: ['#FFFFFF', '0F172A', 'g:csdn.net'],
  掘金: ['#FFFFFF', '0F172A', 'g:juejin.cn'],
  思否: ['#FFFFFF', '0F172A', 'g:segmentfault.com'],
  开源中国: ['#FFFFFF', '0F172A', 'g:oschina.net'],
  V2EX: ['#FFFFFF', '0F172A', 'g:v2ex.com'],
  少数派: ['#FFFFFF', '0F172A', 'g:sspai.com'],
  即刻: ['#FFFFFF', '0F172A', 'g:okjike.com'],
  YouTube: ['#FF0000', 'FFFFFF', 'si:youtube/ffffff'],
  Twitter: ['#000000', 'F8FAFC', 'si:x/ffffff'],
  Reddit: ['#FF4500', 'FFFFFF', 'si:reddit/ffffff'],
  Wikipedia: ['#000000', 'F8FAFC', 'si:wikipedia/ffffff'],
  ChatGPT: ['#FFFFFF', '0F172A', 'g:chatgpt.com'],
  Claude: ['#D97706', 'FFFFFF', 'si:anthropic/ffffff'],
  Gemini: ['#4285F4', 'FFFFFF', 'si:googlegemini/ffffff'],
  DeepSeek: ['#FFFFFF', '0F172A', 'g:deepseek.com'],
  通义千问: ['#FFFFFF', '0F172A', 'g:tongyi.aliyun.com'],
  Kimi: ['#FFFFFF', '0F172A', 'g:kimi.moonshot.cn'],
  文心一言: ['#FFFFFF', '0F172A', 'g:yiyan.baidu.com'],
  智谱清言: ['#FFFFFF', '0F172A', 'g:chatglm.cn'],
  LeetCode: ['#FFA116', '0F172A', 'si:leetcode/0f172a'],
  牛客: ['#FFFFFF', '0F172A', 'g:nowcoder.com'],
  Coursera: ['#0056D2', 'FFFFFF', 'si:coursera/ffffff'],
  B站课堂: ['#FB7299', 'FFFFFF', 'si:bilibili/ffffff'],
  中国大学MOOC: ['#FFFFFF', '0F172A', 'g:icourse163.org'],
  支付宝: ['#1677FF', 'FFFFFF', 'si:alipay/ffffff'],
  招商银行: ['#FFFFFF', '0F172A', 'g:cmbchina.com'],
  东方财富: ['#FFFFFF', '0F172A', 'g:eastmoney.com'],
  雪球: ['#FFFFFF', '0F172A', 'g:xueqiu.com'],
  闲鱼: ['#FFFFFF', '0F172A', 'g:goofish.com'],
  什么值得买: ['#FFFFFF', '0F172A', 'g:smzdm.com'],
  汽车之家: ['#FFFFFF', '0F172A', 'g:autohome.com.cn'],
  安居客: ['#FFFFFF', '0F172A', 'g:anjuke.com'],
  链家: ['#FFFFFF', '0F172A', 'g:lianjia.com'],
  Boss直聘: ['#FFFFFF', '0F172A', 'g:zhipin.com'],
  智联招聘: ['#FFFFFF', '0F172A', 'g:zhaopin.com'],
  拉勾: ['#FFFFFF', '0F172A', 'g:lagou.com'],
  译学馆: ['#FFFFFF', '0F172A', 'g:yxgapp.com'],
  IconFont: ['#FFFFFF', '0F172A', 'g:iconfont.cn'],
  Unsplash: ['#000000', 'F8FAFC', 'si:unsplash/ffffff'],
  Pexels: ['#05A081', 'FFFFFF', 'si:pexels/ffffff'],
  Dribbble: ['#EA4C89', 'FFFFFF', 'si:dribbble/ffffff'],
  'Product Hunt': ['#DA552F', 'FFFFFF', 'si:producthunt/ffffff'],
  'Hacker News': ['#FFFFFF', '0F172A', 'g:news.ycombinator.com'],
  'Arch Wiki': ['#FFFFFF', '0F172A', 'g:wiki.archlinux.org'],
  'Docker Hub': ['#2496ED', 'FFFFFF', 'si:docker/ffffff'],
  Cloudflare: ['#F38020', 'FFFFFF', 'si:cloudflare/ffffff'],
  Vercel: ['#000000', 'F8FAFC', 'si:vercel/ffffff'],
  Netlify: ['#00C7B7', '0F172A', 'si:netlify/0f172a']
}

function parseMark(token) {
  if (token.startsWith('si:')) return `https://cdn.simpleicons.org/${token.slice(3)}`
  if (token.startsWith('g:')) {
    return `https://www.google.com/s2/favicons?domain=${token.slice(2)}&sz=256`
  }
  if (token.startsWith('glyph:')) return token.slice(6)
  return token
}

const titleToCollection = new Map()
for (const col of COLLECTIONS) {
  for (const title of col.titles) {
    if (titleToCollection.has(title)) {
      console.error('Title in multiple collections:', title)
      process.exit(1)
    }
    titleToCollection.set(title, col)
  }
}

const missing = []
const ungrouped = []
const memberCount = new Map(COLLECTIONS.map(function (col) {
  return [col.id, 0]
}))

const rows = seeds.map(function (seed) {
  const conf = SEED[seed.title]
  if (!conf) missing.push(seed.title)
  const [bg, text, markToken] = conf || ['#F8FAFC', '0F172A', `g:${seed.url}`]
  const collection = titleToCollection.get(seed.title)
  if (!collection) ungrouped.push(seed.title)
  const memberIndex = collection ? memberCount.get(collection.id) : 0
  if (collection) memberCount.set(collection.id, memberIndex + 1)

  let host = ''
  try {
    host = new URL(seed.url).hostname
  } catch {
    host = ''
  }
  return {
    ...seed,
    host,
    bg,
    text: text.replace(/^#/, ''),
    mark: parseMark(markToken),
    collectionId: collection ? collection.id : null,
    memberIndex
  }
})

if (missing.length) {
  console.error('Missing seed config:', missing)
  process.exit(1)
}
if (ungrouped.length) {
  console.error('Ungrouped titles:', ungrouped)
  process.exit(1)
}

/** 自研磁贴占 0..=14，分类集合从 15 起 */
const WALL_START = 15
const collectionLines = COLLECTIONS.map(function (col, i) {
  return `    ("${col.id}", ${WALL_START + i}, "${col.title}", "${col.bg}", "${col.text.replace(/^#/, '')}"),`
}).join('\n')

const navLines = rows
  .map(function (row) {
    return `    ("${row.id}", ${row.memberIndex}, "${row.title}", "${row.url}", "${row.host}", "${row.bg}", "${row.text}", "${row.mark}", "${row.collectionId}"),`
  })
  .join('\n')

const content = `//! 导航磁贴种子：品牌 background / textColor / mark + 分类 collection。
//! - si / glyph / google 均写在种子里；运行时不做域名特化拉取。
//! 改预设：改 gen-navigation-seed.mjs 后重新生成。

const MIRROR_ID: &str = "b7bc5d50-3b4a-46d7-b834-2938df56de24";
const TS: i64 = 1785423438774;

/// 墙面分类集合 (id, wall_index, title, background_hex, text_hex)
pub const COLLECTIONS: &[(&str, i32, &str, &str, &str)] = &[
${collectionLines}
];

/// (id, index_in_collection, title, url, host, background_hex, text_hex, mark, collection_id)
pub const NAVIGATION: &[(&str, i32, &str, &str, &str, &str, &str, &str, &str)] = &[
${navLines}
];

/// 仅冷启动插入；开发期不维护刷库 / 兼容 UPDATE。
pub fn insert_statements() -> Vec<String> {
    let mut out: Vec<String> = COLLECTIONS
        .iter()
        .map(|(id, index, title, bg, text)| {
            let background = format!(r#"{{"color":"{bg}"}}"#);
            format!(
                "INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('{id}',{index},'{title}',NULL,'12px',NULL,'collection','{title}','{background}',NULL,'{MIRROR_ID}','{text}',NULL,1,'square','vertical',0,NULL,{TS},{TS})"
            )
        })
        .collect();
    out.extend(NAVIGATION.iter().map(
        |(id, index, title, url, _host, bg, text, mark, collection_id)| {
            let background = format!(r#"{{"color":"{bg}"}}"#);
            format!(
                "INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('{id}',{index},'{title}','{url}','12px','{mark}','navigation','{title}','{background}',NULL,'{MIRROR_ID}','{text}','{collection_id}',1,'square','vertical',0,NULL,{TS},{TS})"
            )
        },
    ));
    out
}
`

const outPath = path.join(__dirname, '../src/migrations/navigation_seed.rs')
fs.writeFileSync(outPath, content, 'utf8')
console.log(
  'Wrote',
  rows.length,
  'nav +',
  COLLECTIONS.length,
  'collections →',
  outPath
)
