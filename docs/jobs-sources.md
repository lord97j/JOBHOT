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
| 服务端 HTML 里有链接，但链接不是岗位 | 万国数据、汽车之家、盛天网络、三七互娱（复核见下）、巨人网络（`hr.ztgame.com/campus/`，109 个链接多为校招项目页，未复核） |

### 复核：这 4 家能不能做成 `web_list`

2026-10-13 用后台“预览抓取”的同一套读取路径（`packages/backend/src/sources/web-list.ts` 的 `fetchWebList` + `sources/filters.ts` 的 `admitListing`）逐家跑了一遍，结论是**都不能**：

| 公司 | 预览用的页面 | 抓到的条数 | 服务端的岗位是什么样 |
|---|---|---|---|
| 万国数据 | `gds-services.com/zh_cn/jobslist_20.html` | 51，全是「关于我们 / 服务 / 投资者关系」等导航 | 岗位是 `<p style="font-weight:bold;">` 段落，同一页按华北/华东/华南平铺；每个岗位没有自己的网址，只有 `mailto:recruiting@gds-services.com`。把 `itemSelector` 收到岗位段落上得到 `no items matched (html)` |
| 汽车之家 | `talent.autohome.com.cn/recruit-list.html` | 2，是登录浮层里的「忘记密码？/ 去注册」 | `#position-list` 是空 `<ul>`，岗位由 `js/recruit_list.js` 请求 `POST /api/officialPosition/getPositionList` 后渲染；首页那 4 条 `class="zhiwei-box"` 在 HTML 里是注释掉的，`href="#"` |
| 盛天网络 | `shengtian.com/Join/jobList/type/1` | 42，全是导航 | 岗位在 `#js-list-job` 的 `<li>` 里，只有 `h1 span.title` 和正文（共 3 个），没有岗位网址也没有发布时间，只有 `mailto:zhaopin@stnts.com` |
| 三七互娱 | `zhaopin.37.com/index.php?m=Home&c=recruit&a=recruit&recruit=1` | 20，全是导航 | 服务端只有筛选用的 checkbox（招聘类型/岗位类型/城市），列表容器 `.recruit-list-wrap` 是空的，岗位由 `static/robot/js/entry.min.js` 按路由（`campus-job-details` 等）渲染 |

原因只有一个：内置 HTML 读取器不执行 JavaScript，而这 4 页的服务端 HTML 里没有逐岗位的网址——没有网址就没有可判重的岗位身份，`web_list` 收不到东西。汽车之家是 4 家里唯一有服务端接口的（`POST https://talent.autohome.com.cn/api/officialPosition/getPositionList`，表单编码，body 带 `currentPage` / `pageSize` / `targetId` / `work_place` / `func_cat_id` / `dept_id` / `search`，返回 `returnObject.list[]`，字段 `id`、`name`、`publicShowTime`、`update_time`、`workPlaceShow`、`funcCatShow`、`salaryShow`，岗位网址是 `recruit-delivery.html?pid=<id>`），但它要 POST 表单、要翻页参数，属于 `json_list` 或模块，不是 `web_list`。

所以“补成 `web_list`”这条路对这批信源是关的：所有公司继续靠推送，直到 `json_list`（按 ATS 平台）或模块做出来。

### 再复核：`json_list` 能不能接手（汽车之家 / Moka）

2026-10-13 用 `fetchJsonList` + `admitListing`（预览抓取对 `json_list` 走的同一条路径）和 `scripts/collect.ts` 的 `collectSource` 实测了两个平台。两家都能**读到**岗位，但都还不能只靠 `json_list` 跑通。

**汽车之家**：接口要 POST，但参数放在查询串、不带 body 就能用——`GET` 被拒（返回 `{"status":-1,"msg":"未知错误"}`），`POST` + 查询串参数返回全部 100 条。配置零框架改动：

```json
{
  "url": "https://talent.autohome.com.cn/api/officialPosition/getPositionList?currentPage=1&pageSize=1000&targetId=&work_place=&func_cat_id=&dept_id=&search=",
  "mode": "json_api", "method": "POST",
  "itemsPath": "returnObject.list", "titlePaths": ["name"],
  "urlTemplate": "https://talent.autohome.com.cn/recruit-delivery.html?pid={id}",
  "publishedAtPath": "publicShowTime", "externalIdPath": "id"
}
```

`pageSize=1000` 一页拉满；`bodyJson` 用不上（`fetchJsonList` 有 `bodyJson` 就强制 `content-type: application/json`，POST 表单编码表达不了；好在参数放查询串即可）。采集本身是通的：首次 `found: 100, created: 30`（首次导入上限 30），再跑一次 `created: 0`——**按 URL 判重正常**。

**但拿不到岗位正文**：`recruit-delivery.html?pid=` 是投递表单页，服务端只有「姓名 / 手机号 / 教育经历」这些表单标签；岗位描述只在**每个岗位各一次**的 `POST /api/officialPosition/getPositionDetail`（body `positionId=`，返回 `returnObject.detail` / `.requirement`）里。`json_list` 没有「每个条目再请求一次接口」的能力（`detail` 抓的是条目自己的网页），于是 `body_status` 停在 `pending`、分析阶段 `waitsForPage` 一直等页，日报直接报 `nothing judged in its window`——**没有描述就没有精选和日报**。

**Moka**（以知乎为例）：`GET https://api.mokahr.com/v1/jobs/zhihu?mode=social&limit=100&offset=0` 返回**明文** JSON（`jobs[]`：`id`、`title`、`description`、`publishedAt`、`status`），比站点自己用的接口好用——浏览器 Network 面板抓到站点实际调用的是 `POST https://app.mokahr.com/api/outer/ats-apply/website/jobs/module`（body 带 `orgId` / `siteId` / `moduleId`），返回的是**加密载荷** `{"data":"<密文>","necromancer":…}`，要用它得先复现 Moka 的解密。

Moka 的岗位网址是**片段路由**：`app.mokahr.com/social-recruitment/<org>/<siteId>#/job/<uuid>`（`siteId` 不在接口返回里，只能从站点地址取，知乎是 `78336`）。没有非片段形式——`social-recruitment/<org>/<siteId>/job/<id>` 是 404。而 `normalizeUrl` 会去掉 `#…`：

| 事实 | 结果 |
|---|---|
| `config-keys.ts` 给 `json_list` 的键表 | 没有 `preserveUrlFragment`（`web_list`、`rss` 有） |
| `collect.ts` 的判重 | 只有 `source.config.preserveUrlFragment === true` 才保留片段 |
| 实测（知乎 42 个在招岗位） | 首次采集 `found: 42, created: 1`——42 个岗位塌成 1 篇文章 |

另外 `limit` 服务端封顶 100：微博 211 个在招、金山办公 146 个，`json_list` 没有翻页配置，一页只能看到最新的 100 个。

**要动的地方（都是通用插口，不是站点专属逻辑）**

1. Moka 只差一行：把 `preserveUrlFragment` 加进 `config-keys.ts` 里 `json_list` 的键表。判重那段代码对所有 kind 都已经认这个键，改完 Moka 就能用。
2. 汽车之家要补一个「每个条目再读一次接口」的通用插口（例如给 `json_list` 的 `detail` 加一条接口路径），否则拿不到岗位描述。
3. **模块目前接不了采集**：`ServerModule.sourceKinds` 只给了 `resumed` 和 `fetchNow`（后台手动试抓），采集链路（`sources/*.ts`、`jobs/*.ts`）从不读 `serverModules()`。`docs/architecture.md` 说“插口不够用时，在框架里加一个通用的插口”——采集这条路上还没有这个插口，得先加，模块才有地方放适配器。

在此之前所有公司继续靠推送。汽车之家的 `getPositionList` / `getPositionDetail` 和 Moka 的 `api.mokahr.com/v1/jobs/<org>` 记在这里，省得下次重新探。

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
