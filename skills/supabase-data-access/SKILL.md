---
name: supabase-data-access
description: Meoo Cloud/Supabase 业务数据访问工程能力。开发或修改真实云端数据驱动的商品、订单、任务、内容等列表或详情时必须加载，包括已有项目从静态/Mock 数据改接真实数据库。覆盖 CRUD、搜索筛选、排序与稳定分页、精确计数、聚合、关联查询、写入确认、原子更新及 RLS/PostgREST 错误诊断；即使未点名 Supabase，只要业务数据需要长期保存、刷新恢复或多人共享也应选择。纯静态/Mock、前端本地筛选、仅认证或仅文件存储不使用。仅 Excel/CSV/SQLite 批量导入时使用 data-batch-upload；导入同时包含业务查询、分页、导出或 CRUD 时，仍须配套加载本技能。
allowed_create_modes:
  - create-desktop
  - create-app
  - miniprogram
component_keywords:
  - '(?:^|/)features/supabase-data-access(?:/|$)'
  - '(?:^|/)(?:dataAccess|supabaseDataAccess|postgrestError)\.[tj]s$'
---

# Supabase 业务数据访问

处理真实表数据的查询、写入、分页、聚合、关联和页面同步。先确认 schema 与权限，复用平台 Client，由数据库结果驱动页面状态。

## 范围与前提

先固定本次用户要求的字段、筛选和权限范围。负责人筛选不等于要求主管/管理员/全团队能力；“不同销售只看本人”先实现本人RLS与其可见范围内的筛选，不自动增加角色迁移、主管账号或团队RPC。已有明确角色规则沿用；用户另行要求团队管理时再扩展。


- 先加载 `meoo-cloud`，读取 `skills/meoo-cloud/references/database.md`；已有表先核对列、类型、空值、枚举、默认值、唯一键、外键及相关 RLS Policy，不从 UI 文案猜 schema。
- 认证与 Session 交给认证技能；原始附件、图片和对象存储不在本技能范围内；Excel/CSV/SQLite 解析、列映射和批量导入交给 `data-batch-upload`。导入后的业务查询和 CRUD 仍使用本技能。
- 复用平台生成的 Client 和已有 repository/store。云服务未就绪时说明未完成的接入步骤，不用 LocalStorage、内存或 Mock 替代后宣称云数据功能完成。

## 按需读取

| 当前任务 | 文档 |
| --- | --- |
| 列表、详情、搜索、分页、关联、导出或查询页面接线 | [查询指南](references/query.md) |
| 新增、修改、删除、原子更新、写入失败或写后同步 | [写入指南](references/mutation.md) |
| 某个模板函数的参数、返回值、默认值或限制不明确 | [模板接口速查](references/runtime-api.md)，只查对应接口 |

普通列表使用 `readPage`，确需完整有界数据时使用 `readAllPages`；强确认写入使用 `confirmMutationRows`；乱序响应隔离使用 `createLatestRequestGate`。先按任务选查询或写入指南；完整 CRUD 按需读两份。接口速查用于补充查询，不是每次必读，不沿链接通读全部参考或源码。

## 工程入口与源码读取

普通业务接入按本 Skill 和对应指南使用模板，无需读取 `dataAccess.ts`：

1. 按任务选择查询或写入指南，读取项目 `src/features/supabase-data-access/index.ts`，确认入口、所需导出及其目标文件存在；无需沿导出展开实现源码。
2. 参数、返回值或限制不明确时，查 [模板接口速查](references/runtime-api.md) 对应章节，不以通读源码代替接口查询。
3. 只有修改模板、排查模板内部行为，或发现项目实现与文档契约不一致时，才读取项目 `dataAccess.ts` 的相关函数和直接依赖。业务查询或 RLS 报错先检查调用方与数据库证据，不自动展开全部模板源码。

入口或导出缺失时，先搜索已有等价函数及 repository/store 并核对其接口；确实缺失且模板复制未在进行时，才读取 `skills/supabase-data-access/template-reference/src/features/supabase-data-access/` 下对应文件，补齐必要项目代码。参考目录只读，不能作为业务 import；Skill、参考文件或注入回执不代表项目代码已经可用。

React/Expo/Taro 共用相同的纯 TypeScript 核心；模板不创建 Client，不定义业务表、UI 或 RLS。已有项目沿用现有数据层和状态源，查询、筛选、排序及返回形状由真实业务决定，不为套模板新增一套架构。

## 接线要点

- **查询**：只取所需字段，使用业务排序加唯一键的确定排序。页面按页读，大规模统计交给数据库聚合／View／RPC。精确总数来自同条件查询，不能用本页长度代替。
- **写入**：检查结构化 error。需要生成字段、影响行确认或最终状态时，返回必要列并校验；未要求返回行的 `data === null` 正常。UPDATE/DELETE 的 `error === null` 不保证命中目标。
- **权限与并发**：JWT 不会自动填充所有权字段；写入须符合真实 Policy 和列默认值。库存、余额、计数等使用数据库原子操作。超时后的写入先确认结果，不自动重放。
- **页面状态**：加载、空态、错误与成功分别处理，旧请求不能覆盖新条件。写后使用返回行或回读同步页面；接口契约变化时同步适配直接调用方。

查询和写入的场景规则、示例及故障诊断分别在对应指南中；接口定义只在速查中维护。排查日志或请求时不复述完整 Token、Cookie 或密钥。

## 验收与交付

- 确认数据层与调用方类型一致，完成相关 typecheck/build，搜索旧字段与旧调用方式并更新受影响的调用方。
- 实现和接线完成后的最终验收时，只主动验证本轮新增的业务规则，用最小用例覆盖相关约束、权限或原子更新。常规 CRUD 不主动实测，即使新建了表或接口。用户明确要求测试时，按其指定的范围和时机执行。

外部条件阻塞时列明未完成项和未执行验证。中断只记录当前契约、已改文件、待办与证据位置，恢复后核对相关文件变化，不重复通读全部资料。
