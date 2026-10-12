# 招聘信源：上市公司官网招聘页

这个站盯的是上市公司官网招聘页上新增的岗位。信源清单在 `industry/sources.json`（58 条，一条一家公司），岗位数据由站外的采集程序推送进来。这份文档写清楚：信源怎么登记、为什么不做成网页列表、推送契约，以及招聘和新闻不一样的地方。

## 信源怎么登记

`industry/sources.json` 里每条对应一家公司，字段口径：

| 字段 | 值 |
|---|---|
| `id` | `ext-<公司 id>`，公司 id 见 `industry/taxonomy.ts` 的 `ENTITIES` |
| `kind` | `external`（网站自己不抓，等推送） |
| `tier` | `T1`（逸仙电商 `T2`，官网入口不稳定） |
| `participation_mode` | `editorial`（进公开页面） |
| `owner_entity_id` | 公司 id，决定岗位挂在哪家公司、哪个公司主题下 |
| `interval_minutes` | 60 |
| `tags` | `["官方", "招聘", "<平台>"]`，入口没核实的另加 `"待确认"` |
| `site_fulltext` | `false`（只展示摘要和原文链接） |

`node scripts/seed.ts` 把这份清单写进数据库（`T1` 同时把 `first_party` 置为 true），重复执行不会覆盖已有改动。

名单来自参考项目 jd-infos 的 `spider/jd_spider/targets/internet_companies.py`（`ADAPTER_TARGET_COMPANIES`）。其中 6 条的官方招聘入口没核实：网宿科技、南极电商、金山办公、金山云、首都在线、逸仙电商。

`external` 信源网站自己不会去抓：`packages/backend/src/sources/config-keys.ts` 只允许 `external` 配 `publisherRole` / `publisherUrlPrefixes` 两个键，没有列表选择器。

## 为什么不做成网页列表

57 家里绝大多数官网招聘页是前端渲染的 SPA 或第三方 ATS，服务端 HTML 里没有岗位；内置的 HTML 读取器不执行 JavaScript（见 [信源](sources.md)）。2026-10-12 实测：

| 情况 | 例子 |
|---|---|
| 第三方 ATS，服务端无岗位 | Moka（`app.mokahr.com`，完美世界、知乎、微博、搜狐等）、北森（`*.zhiye.com`，顺网、冰川、合合信息等）、飞书招聘（`*.jobs.feishu.cn`，值得买、蓝色光标）、薪人薪事（光云科技） |
| 前端渲染或需要登录 | 虎牙、斗鱼、宝尊、满帮、掌趣、挚文、智联/51job/国聘/猎聘/BOSS |
| 被拒或入口错配 | 网宿 406、金山云 403、首都在线指向了海航的招聘页 |
| 服务端 HTML 里有列表 | 万国数据（`jobslist_20.html`）、汽车之家（`recruit-list.html?fl=1001`）、盛天网络（`/Join/jobList/type/1`）、三七互娱（`zhaopin.37.com`）、巨人网络（`hr.ztgame.com/campus/`） |

最后一行这 5 个可以后续补成 `web_list` 信源（要逐页核对选择器，并用后台的抓取预览验证）。在补上之前，所有公司都靠推送。

## 推送契约

采集程序把岗位推到 `POST /api/ingest/items`（`apps/api/src/routes/ingest.ts`、`packages/backend/src/ingest/items.ts`）：

```http
POST /api/ingest/items
Authorization: Bearer $INGEST_TOKEN
Content-Type: application/json

{
  "sourceId": "ext-bytedance",
  "sourceName": "字节跳动 招聘",
  "items": [
    {
      "title": "字节跳动 招聘 大模型算法工程师（北京）",
      "url": "https://jobs.bytedance.com/experienced/position/123456",
      "publishedAt": "2026-10-12T09:00:00+08:00",
      "author": "字节跳动",
      "raw": { "jobId": "123456", "department": "抖音", "locations": "北京", "experience": "3-5 年" }
    }
  ]
}
```

- 认证用 `INGEST_TOKEN`：少于 16 位或占位值（`changeme`、`xxx`、`test` 等）一律拒绝；`INGEST_RATE_LIMIT`（默认 10）限制每个客户端每分钟的推送次数，`0` 表示交给前面的反向代理。
- 每批最多 50 条（`MAX_ITEMS`），同一批内按规范化 URL 去重。
- `title` 和 `url` 必填，其余可选。`publishedAt` 没有时按“没有可信发布时间”处理：先不公开，等从原文页读到日期再判断新旧（见 [信源](sources.md) 的“旧文不刷屏”）。
- `url` 是判重身份：同一个岗位刷新时要用同一个 URL，换了 URL 就会当成新岗位再走一遍分析。
- `sourceId` 用清单里注册过的 `ext-<公司>`，岗位才会挂到那家公司（`owner_entity_id`）和它的公司主题上；用没注册过的 `sourceId` 会被自动建成 `isolated` / `T2` 的信源，要管理员在后台把它改成 `editorial` 才公开。
- 带 `raw._aihot.backfill` 或 `raw._aihot.baseline` 的批次不会算成今天的新增（补历史数据用）。
- 参考项目里 jd-infos 的 CSV（`all_jobs.csv`）对应关系：`source_id` → `sourceId`、`company_name` → `sourceName`、`title` → `title`、`canonical_url` / `apply_url` → `url`、`published_at` → `publishedAt`，其余（`department_name`、`locations`、`experience_min_years` / `experience_max_years`、`degree`、`headcount`、`salary_min` / `salary_max`、`status`、`platform`）放进 `raw`。

## 招聘和新闻不一样的地方

框架原本是为新闻写的，这批信源按现状用，已知差异：

| 项 | 现状 |
|---|---|
| 时间线 | 按原文发布时间归档：发现时已发布超过 48 小时的资料不进“今天”。岗位常常没有发布时间，按现有规则先不公开。要改成“用首次发现时间、超过 48 小时也不归档”得改引擎，还没做 |
| 判重 | 按 URL，不按 `source_id + source_job_id` |
| 状态 | 不跟踪在招 / 关闭 / 刷新 / 重开 |
| 热度 | 按事件计（48 小时内每个独立来源计一次），没有“岗位相关性 + 更新时间 + 官方来源”的权重 |
| 精选门槛 | `industry/selection.ts` 还是框架默认（`T1` 60、`T1_5` 65、`T2` 76、`understandFloor` 50），要用本站标注的样本重新校准，见 [精选标准](selection.md) |
| 日报分节 | 按 `CATEGORIES`（技术 / 产品 / 运营 / 职能 / 游戏 / 行业）；“批量上新 / 冻结”这类信号用分类标签（招聘计划、岗位发布…）和 `topics.json` 的“招聘形态”组承载 |
| 报头指标 | `RELEASE` 设成 `null`：岗位横跨所有职能类别，没有单一类别可以计数，日报报头不再显示“N 个新模型”这类数字，改由 `REPORTS.entry` 计条目数 |

## 要使用者决定的事

- 第一批公司名单：现在是 jd-infos 的 57 家（58 条信源），标了“待确认”的 6 条要不要留、要不要再加公司。
- 采集频率（现在 60 分钟一次）和分级（哪些 `T1`、哪些 `T2`）。
- Moka / 北森等 ATS 的部分接口需要登录或企业授权，是否去申请。
- 使用规则和隐私说明里的运营主体、联系方式（`site/pages/`）。
