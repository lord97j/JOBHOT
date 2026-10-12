// 这个行业的分类体系：类别、标签词表、公司（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉结构抽取模型这一类收什么、
 * 和相邻类别的边界在哪（总的归类原则写在 prompts/structure.md 里）。
 * commentary 标出评论类（教程、观点）：日报写过的事又有评论类的后续报道，只占一行快讯（报道它的信源够多时除外）。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 * feedLabel 是分类 RSS 标题里的名字（不写就用 label）。公开接口、RSS 和 MCP 里要把一类并进另一类发布，写在站点设置里（site/site.ts 的 PUBLIC_CATEGORIES）。
 */
export const CATEGORIES = [
  { key: "tech", label: "技术", feedLabel: "技术岗位", section: "技术与研发", guide: "研发、算法、数据、测试、运维、安全、硬件与工程类岗位的公开招聘信息。同一条招聘公告里列了多个职能时，按这条岗位本身所属的职能归类，不按公司的主业归类。" },
  { key: "product", label: "产品", feedLabel: "产品岗位", section: "产品与设计", guide: "产品经理、产品规划、用户研究、体验与视觉设计、项目管理岗位。写代码的实现岗归技术，做内容的运营岗归运营。" },
  { key: "operations", label: "运营", feedLabel: "运营与市场岗位", section: "运营与市场", guide: "内容、用户、活动、社区、电商运营，以及市场、品牌、公关、销售、商务、渠道、海外拓展岗位。面向客户的售前售后与客户成功也算运营。" },
  { key: "corporate", label: "职能", feedLabel: "职能岗位", section: "职能与支持", guide: "人力、财务、法务、合规、行政、战略、投资、采购、政府关系等职能岗位。校招与实习不论职能都归校招。" },
  { key: "game", label: "游戏", feedLabel: "游戏岗位", section: "游戏与内容", guide: "游戏策划、美术、音频、制作人、发行与本地化岗位。游戏公司的引擎、后端与算法岗归技术；游戏内容运营归运营。" },
  { key: "industry", label: "行业", feedLabel: "招聘行业动态", section: "行业与公司动态", guide: "招聘政策与监管、行业薪酬与用工行情、公司经营与组织变化中与招聘相关的部分，以及不属于具体岗位的招聘情报。单个岗位的发布不归这里。" },
] as const satisfies ReadonlyArray<{ key: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

/**
 * 这个行业最受关注的一类发布（AI 行业是新模型）：日报报头的“N 个新模型”、改分类后修订已出的报告都按它数。
 * category 是类别，tag 是标签，两者都对上才算；unit 接在数字后面。
 * 没有这样一类的行业设成 null，报头就不显示这个数。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = null;

/** 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。 */
export const PLAIN_TERMS: readonly string[] = ["ai", "api", "hr", "ceo", "cto", "cfo", "bd", "ipo", "kpi", "okr", "saas"];

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = ["job_post", "hiring_plan", "comp_offer", "people_move", "policy_regulation", "company_shift", "market_insight"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "岗位发布", "招聘计划", "薪酬/福利", "人事变动", "招聘政策", "公司信号", "求职洞察", "行业行情", "其他",
] as const;

/** 可选的主题标签。 */
export const TOPIC_TAGS = [
  "技术/研发", "算法/AI", "数据", "产品", "设计", "运营", "市场/品牌", "销售/商务", "职能/管理", "游戏研发",
  "校招/实习", "社招", "海外/出海", "远程/灵活办公", "面试流程", "雇主品牌",
] as const;

/** 可选的实体标签（公司、机构、平台）。 */
export const ENTITY_TAGS = [
  "字节跳动", "阿里巴巴", "腾讯", "美团", "京东", "小米", "网易", "百度",
  "哔哩哔哩", "拼多多", "携程", "唯品会", "腾讯音乐", "三七互娱", "三六零", "完美世界",
] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  招聘: "岗位发布", 新岗位: "岗位发布", 职位: "岗位发布", 岗位信息: "岗位发布", 招人: "岗位发布", 职位发布: "岗位发布", 岗位: "岗位发布",
  扩招: "招聘计划", 裁员: "招聘计划", 冻结: "招聘计划", 缩编: "招聘计划", 编制: "招聘计划", 招聘规模: "招聘计划", 人员调整: "招聘计划",
  薪资: "薪酬/福利", 工资: "薪酬/福利", 待遇: "薪酬/福利", 福利: "薪酬/福利", 期权: "薪酬/福利", 股权激励: "薪酬/福利", 涨薪: "薪酬/福利", 年包: "薪酬/福利", 奖金: "薪酬/福利",
  高管: "人事变动", 任命: "人事变动", 离职: "人事变动", 人事: "人事变动", 组织架构: "人事变动", 换届: "人事变动",
  政策: "招聘政策", 监管: "招聘政策", 法规: "招聘政策", 用工政策: "招聘政策", 签证: "招聘政策",
  财报: "公司信号", 业绩: "公司信号", 业务调整: "公司信号", 公司动态: "公司信号", 战略: "公司信号", 融资: "公司信号",
  面经: "求职洞察", 求职: "求职洞察", 求职经验: "求职洞察", 招聘洞察: "求职洞察",
  行业: "行业行情", 行情: "行业行情", 趋势: "行业行情", 市场行情: "行业行情",
};

// ── 公司与主体 ──────────────────────────────────────────────────────────────────────────

/**
 * 公司主题：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。
 * aliases 给结构抽取模型看；otherNames 是公司自己的其他称呼（官方账号名、子品牌），
 * 把事实的主体对到发布方时也认它们。
 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; otherNames?: string[] }> = {
  bytedance: { name: "字节跳动", displayTag: "字节跳动", aliases: ["字节跳动", "ByteDance", "字节"], otherNames: ["抖音", "TikTok", "飞书", "豆包", "火山引擎"] },
  alibaba: { name: "阿里巴巴", displayTag: "阿里巴巴", aliases: ["阿里巴巴", "Alibaba", "阿里", "BABA"], otherNames: ["淘宝", "天猫", "阿里云", "Alibaba Cloud", "通义", "高德", "菜鸟"] },
  tencent: { name: "腾讯", displayTag: "腾讯", aliases: ["腾讯", "Tencent", "TCEHY"], otherNames: ["微信", "WeChat", "QQ", "腾讯云", "混元"] },
  meituan: { name: "美团", displayTag: "美团", aliases: ["美团", "Meituan", "3690"], otherNames: ["美团外卖", "大众点评", "Keeta"] },
  jd: { name: "京东", displayTag: "京东", aliases: ["京东", "JD.com", "JD"], otherNames: ["京东物流", "京东健康", "京东零售"] },
  xiaomi: { name: "小米", displayTag: "小米", aliases: ["小米", "Xiaomi", "1810"], otherNames: ["Redmi", "小米汽车", "米家"] },
  netease: { name: "网易", displayTag: "网易", aliases: ["网易", "NetEase", "NTES"], otherNames: ["网易游戏", "网易云音乐", "有道", "雷火"] },
  baidu: { name: "百度", displayTag: "百度", aliases: ["百度", "Baidu", "BIDU"], otherNames: ["文心", "Apollo", "百度智能云"] },
  bilibili: { name: "哔哩哔哩", displayTag: "哔哩哔哩", aliases: ["哔哩哔哩", "B站", "Bilibili", "BILI"], otherNames: ["Bilibili"] },
  pinduoduo: { name: "拼多多", displayTag: "拼多多", aliases: ["拼多多", "Pinduoduo", "PDD"], otherNames: ["Temu", "多多买菜"] },
  trip: { name: "携程", displayTag: "携程", aliases: ["携程", "Ctrip", "Trip.com", "TCOM"], otherNames: ["去哪儿"] },
  vipshop: { name: "唯品会", displayTag: "唯品会", aliases: ["唯品会", "Vipshop", "VIPS"] },
  tencentmusic: { name: "腾讯音乐", displayTag: "腾讯音乐", aliases: ["腾讯音乐", "TME", "Tencent Music"], otherNames: ["QQ音乐", "酷狗", "酷我"] },
  sanqi: { name: "三七互娱", displayTag: "三七互娱", aliases: ["三七互娱", "37 Interactive", "002555"] },
  qihoo360: { name: "三六零", displayTag: "三六零", aliases: ["三六零", "360", "奇虎360", "601360"], otherNames: ["360数科", "360集团"] },
  wanmei: { name: "完美世界", displayTag: "完美世界", aliases: ["完美世界", "Perfect World", "002624"] },
  gbits: { name: "吉比特", displayTag: null, aliases: ["吉比特", "G-bits", "603444"], otherNames: ["雷霆游戏"] },
  ztgame: { name: "巨人网络", displayTag: null, aliases: ["巨人网络", "Giant Network", "002558"] },
  kingnet: { name: "恺英网络", displayTag: null, aliases: ["恺英网络", "Kingnet", "002517"] },
  kunlun: { name: "昆仑万维", displayTag: null, aliases: ["昆仑万维", "Kunlun", "300418"], otherNames: ["Opera", "天工"] },
  ourpalm: { name: "掌趣科技", displayTag: null, aliases: ["掌趣科技", "Ourpalm", "300315"] },
  shunwang: { name: "顺网科技", displayTag: null, aliases: ["顺网科技", "Shunwang", "300113"] },
  focuschina: { name: "焦点科技", displayTag: null, aliases: ["焦点科技", "Focus Technology", "002315"], otherNames: ["中国制造网"] },
  wangsu: { name: "网宿科技", displayTag: null, aliases: ["网宿科技", "Wangsu", "300017"] },
  bosszhipin: { name: "BOSS直聘", displayTag: null, aliases: ["BOSS直聘", "Boss Zhipin", "BZ"], otherNames: ["看准网"] },
  fulltruck: { name: "满帮集团", displayTag: null, aliases: ["满帮", "满帮集团", "Full Truck Alliance", "YMM"], otherNames: ["运满满", "货车帮"] },
  ke: { name: "贝壳", displayTag: null, aliases: ["贝壳", "KE Holdings", "BEKE"], otherNames: ["链家"] },
  zhihu: { name: "知乎", displayTag: null, aliases: ["知乎", "Zhihu", "ZH"] },
  weibo: { name: "微博", displayTag: null, aliases: ["微博", "Weibo", "WB"], otherNames: ["新浪微博", "Sina Weibo"] },
  autohome: { name: "汽车之家", displayTag: null, aliases: ["汽车之家", "Autohome", "ATHM"] },
  huya: { name: "虎牙", displayTag: null, aliases: ["虎牙", "HUYA"] },
  douyu: { name: "斗鱼", displayTag: null, aliases: ["斗鱼", "Douyu", "DOYU"] },
  joyy: { name: "欢聚集团", displayTag: null, aliases: ["欢聚", "欢聚集团", "JOYY", "YY"] },
  immomo: { name: "挚文集团", displayTag: null, aliases: ["挚文集团", "Hello Group", "MOMO"], otherNames: ["陌陌", "探探"] },
  sohu: { name: "搜狐", displayTag: null, aliases: ["搜狐", "Sohu", "SOHU"] },
  chineseall: { name: "中文在线", displayTag: null, aliases: ["中文在线", "ChineseAll", "300364"] },
  yoozoo: { name: "游族网络", displayTag: null, aliases: ["游族网络", "Yoozoo", "002174"] },
  dianhun: { name: "电魂网络", displayTag: null, aliases: ["电魂网络", "Dianhun", "603258"] },
  shengtian: { name: "盛天网络", displayTag: null, aliases: ["盛天网络", "Shengtian", "300494"], otherNames: ["易乐游"] },
  bingchuan: { name: "冰川网络", displayTag: null, aliases: ["冰川网络", "Bingchuan", "300533"] },
  fanli: { name: "返利科技", displayTag: null, aliases: ["返利科技", "Fanli", "600228"], otherNames: ["返利网"] },
  baozun: { name: "宝尊电商", displayTag: null, aliases: ["宝尊", "宝尊电商", "Baozun", "BZUN"] },
  yixian: { name: "逸仙电商", displayTag: null, aliases: ["逸仙电商", "Yatsen", "YSG"], otherNames: ["完美日记"] },
  nanjids: { name: "南极电商", displayTag: null, aliases: ["南极电商", "002127"], otherNames: ["南极人"] },
  smzdm: { name: "值得买", displayTag: null, aliases: ["值得买", "SMZDM", "300785"], otherNames: ["什么值得买"] },
  onechance: { name: "壹网壹创", displayTag: null, aliases: ["壹网壹创", "300792"] },
  focusmedia: { name: "分众传媒", displayTag: null, aliases: ["分众传媒", "Focus Media", "002027"] },
  inmyshow: { name: "天下秀", displayTag: null, aliases: ["天下秀", "Inmyshow", "600556"] },
  bluefocus: { name: "蓝色光标", displayTag: null, aliases: ["蓝色光标", "BlueFocus", "300058"] },
  ywwl: { name: "遥望科技", displayTag: null, aliases: ["遥望科技", "002291"] },
  kingsoftcloud: { name: "金山云", displayTag: null, aliases: ["金山云", "Kingsoft Cloud", "KC"] },
  kingsoftoffice: { name: "金山办公", displayTag: null, aliases: ["金山办公", "WPS", "688111"], otherNames: ["WPS Office"] },
  gds: { name: "万国数据", displayTag: null, aliases: ["万国数据", "GDS", "GDS Holdings"] },
  ofidc: { name: "奥飞数据", displayTag: null, aliases: ["奥飞数据", "300738"] },
  capitalonline: { name: "首都在线", displayTag: null, aliases: ["首都在线", "300846"], otherNames: ["CDS首云"] },
  qingcloud: { name: "青云科技", displayTag: null, aliases: ["青云科技", "QingCloud", "688316"] },
  raycloud: { name: "光云科技", displayTag: null, aliases: ["光云科技", "Raycloud", "688365"] },
  intsig: { name: "合合信息", displayTag: null, aliases: ["合合信息", "INTSIG", "688615"], otherNames: ["扫描全能王", "名片全能王"] },
};

/**
 * 身份词典：摘要和标题里出现的公司，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 * 行业没有这个问题时可以留空数组。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "bytedance", name: "字节跳动", patterns: [/字节跳动|bytedance/i, /\b抖音\b|tiktok|飞书|火山引擎|豆包/i] },
  { id: "alibaba", name: "阿里巴巴", patterns: [/阿里巴巴|\balibaba\b|\b阿里(?!巴巴)\b|alibabacloud|阿里云/i] },
  { id: "tencent", name: "腾讯", patterns: [/腾讯(?!音乐)|\btencent\b(?!\s*music)/i] },
  { id: "tencentmusic", name: "腾讯音乐", patterns: [/腾讯音乐|\btme\b|tencent\s*music/i] },
  { id: "meituan", name: "美团", patterns: [/美团|meituan|keeta/i] },
  { id: "jd", name: "京东", patterns: [/京东|jd\.com|jd\s*retail/i] },
  { id: "xiaomi", name: "小米", patterns: [/小米|xiaomi|redmi/i] },
  { id: "netease", name: "网易", patterns: [/网易|netease/i] },
  { id: "baidu", name: "百度", patterns: [/百度|baidu|\bernie\b/i] },
  { id: "bilibili", name: "哔哩哔哩", patterns: [/哔哩哔哩|\bb站\b|bilibili/i] },
  { id: "pinduoduo", name: "拼多多", patterns: [/拼多多|pinduoduo|\bpdd\b|temu/i] },
  { id: "trip", name: "携程", patterns: [/携程|ctrip|trip\.com/i] },
  { id: "vipshop", name: "唯品会", patterns: [/唯品会|vipshop/i] },
  { id: "sanqi", name: "三七互娱", patterns: [/三七互娱|37\s*interactive/i] },
  { id: "qihoo360", name: "三六零", patterns: [/奇虎360|三六零|360集团|360数科/i] },
  { id: "wanmei", name: "完美世界", patterns: [/完美世界|perfect\s*world/i] },
  { id: "zhihu", name: "知乎", patterns: [/知乎|zhihu/i] },
  { id: "weibo", name: "微博", patterns: [/微博|weibo/i] },
  { id: "autohome", name: "汽车之家", patterns: [/汽车之家|autohome/i] },
  { id: "huya", name: "虎牙", patterns: [/虎牙|huya/i] },
  { id: "douyu", name: "斗鱼", patterns: [/斗鱼|douyu/i] },
  { id: "bosszhipin", name: "BOSS直聘", patterns: [/boss直聘|zhipin/i] },
  { id: "ke", name: "贝壳", patterns: [/贝壳|ke\s*holdings|beike|链家/i] },
  { id: "smzdm", name: "值得买", patterns: [/值得买|smzdm/i] },
  { id: "bluefocus", name: "蓝色光标", patterns: [/蓝色光标|bluefocus/i] },
  { id: "focusmedia", name: "分众传媒", patterns: [/分众传媒|focus\s*media/i] },
  { id: "kingsoftoffice", name: "金山办公", patterns: [/金山办公|\bwps\b/i] },
  { id: "gds", name: "万国数据", patterns: [/万国数据|gds\s*holdings/i] },
  { id: "qingcloud", name: "青云科技", patterns: [/青云科技|qingcloud/i] },
  { id: "intsig", name: "合合信息", patterns: [/合合信息|intsig|扫描全能王/i] },
];

/** 这些域名上的文章，发布方就是对应的公司（托管平台如 GitHub、arXiv 不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "bytedance", domains: ["bytedance.com"] },
  { entityId: "alibaba", domains: ["alibaba.com"] },
  { entityId: "tencent", domains: ["tencent.com"] },
  { entityId: "tencentmusic", domains: ["tencentmusic.com"] },
  { entityId: "meituan", domains: ["meituan.com"] },
  { entityId: "jd", domains: ["jd.com"] },
  { entityId: "xiaomi", domains: ["xiaomi.com"] },
  { entityId: "netease", domains: ["netease.com"] },
  { entityId: "baidu", domains: ["baidu.com"] },
  { entityId: "bilibili", domains: ["bilibili.com"] },
  { entityId: "pinduoduo", domains: ["pinduoduo.com"] },
  { entityId: "trip", domains: ["ctrip.com"] },
  { entityId: "vipshop", domains: ["vip.com"] },
  { entityId: "sanqi", domains: ["37.com"] },
  { entityId: "qihoo360", domains: ["360.cn"] },
  { entityId: "wanmei", domains: ["wanmei.com"] },
  { entityId: "gbits", domains: ["g-bits.com"] },
  { entityId: "ztgame", domains: ["ztgame.com"] },
  { entityId: "kunlun", domains: ["kunlun.com"] },
  { entityId: "ourpalm", domains: ["ourpalm.com"] },
  { entityId: "shunwang", domains: ["shunwang.com"] },
  { entityId: "focuschina", domains: ["focuschina.com"] },
  { entityId: "wangsu", domains: ["wangsu.com"] },
  { entityId: "bosszhipin", domains: ["zhipin.com"] },
  { entityId: "fulltruck", domains: ["fulltruckalliance.com"] },
  { entityId: "ke", domains: ["ke.com"] },
  { entityId: "zhihu", domains: ["zhihu.com"] },
  { entityId: "weibo", domains: ["weibo.com"] },
  { entityId: "autohome", domains: ["autohome.com.cn"] },
  { entityId: "huya", domains: ["huya.com"] },
  { entityId: "douyu", domains: ["douyu.com"] },
  { entityId: "joyy", domains: ["yylive.com"] },
  { entityId: "immomo", domains: ["immomo.com"] },
  { entityId: "sohu", domains: ["sohu.com"] },
  { entityId: "chineseall", domains: ["chineseall.com"] },
  { entityId: "yoozoo", domains: ["yoozoo.com"] },
  { entityId: "shengtian", domains: ["shengtian.com"] },
  { entityId: "fanli", domains: ["fanli.com"] },
  { entityId: "baozun", domains: ["baozun.com"] },
  { entityId: "smzdm", domains: ["smzdm.com"] },
  { entityId: "focusmedia", domains: ["focusmedia.cn"] },
  { entityId: "inmyshow", domains: ["inmyshow.com"] },
  { entityId: "bluefocus", domains: ["bluefocus.com"] },
  { entityId: "kingsoftcloud", domains: ["ksyun.com"] },
  { entityId: "kingsoftoffice", domains: ["wps.cn"] },
  { entityId: "gds", domains: ["gds-services.com"] },
  { entityId: "ofidc", domains: ["ofidc.com"] },
  { entityId: "qingcloud", domains: ["qingcloud.com"] },
  { entityId: "raycloud", domains: ["raycloud.com"] },
  { entityId: "intsig", domains: ["intsig.com"] },
];

/** 原文里的这些写法也算提到了对应公司。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [
  { entityId: "bytedance", pattern: /@(?:ByteDance|字节跳动)/i },
  { entityId: "alibaba", pattern: /@(?:Alibaba|阿里巴巴)/i },
  { entityId: "tencent", pattern: /@(?:Tencent|腾讯)/i },
  { entityId: "meituan", pattern: /@(?:Meituan|美团)/i },
  { entityId: "jd", pattern: /@(?:JD|京东)/i },
];
