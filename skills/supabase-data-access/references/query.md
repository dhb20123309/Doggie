# 查询与页面接线

用于列表、详情、搜索筛选、关联查询及导出。本文包含查询规则和完整列表示例；函数参数、返回值或限制不明确时再查 [模板接口速查](runtime-api.md) 对应章节。只实现查询无需读取写入指南。

按任务定位：[列表与详情](#列表与详情)、[完整列表接线](#完整列表接线)、[完整结果导出](#完整结果导出)、[关联与筛选](#关联与筛选)、[查询失败与异常结果](#查询失败与异常结果)。示例表名、字段及路由均须适配项目真实 schema。

## 列表与详情

只接本次真实查询需求和已授权范围，不为“负责人筛选”额外生成主管权限、全团队名单、角色初始化或团队聚合RPC。本人可见的列表使用相同筛选/归属谓词与确定排序；先约定数据层返回形状，再写页面与导出消费者，不在实现中反复更换返回对象。


- 只查询所需列，列表按业务字段加唯一键排序；仅按 created_at 排序不能保证同时间戳记录的跨页稳定性。
- 普通翻页使用 readPage，每次只读当前页；筛选变化重置为第 1 页，总数来自相同筛选下的精确计数。
- 加载、成功、空态和失败分开处理，成功和失败响应都要隔离旧请求；总数减少导致当前页越界时回到有效页，不无限重试。
- 详情先约定单对象、组合对象和不存在状态。关联数组、空值与聚合结果在数据层归一化，再交给页面；接口形状改变时同步更新消费者。
- 大规模统计优先数据库聚合、View 或 RPC；只有确需完整且有界结果时才连续读取多页。

## 完整列表接线

### 使用前提

本例演示“按状态筛选订单并分页”，用于确认各层如何交接。先核对项目真实 schema 和已有代码，再按需适配；不为套用示例创建订单表或另一套 repository/store。

示例假设 `orders` 有非空的 `id: string`、`status: 'pending' | 'done'`、`created_at: string`，且当前身份具备相应读取权限。实际类型以项目生成的数据库类型为准。`@/supabase/client` 是平台生成的 Client，`@/features/supabase-data-access` 是实际模板入口；先确认文件、导出和路径别名存在，不重新 `createClient()`。以下文件名为示例落点，已有等价模块时原地接入。

数据层不依赖 UI；Hook 和页面展示 React Web 接法。Expo/Taro 应沿用业务契约，适配当前平台的组件、页面生命周期和既有状态管理，不引入 DOM 标签。

### 1. 数据查询、归一化和稳定业务 API

示例文件：`src/services/orders.ts`。先确定 `listOrders(query): Promise<OrderPage>`，再实现消费者。使用真实生成类型让字段或 enum 不一致尽早报错，不用 `any` 或强制断言掩盖差异。

```ts
import { supabase } from '@/supabase/client';
import { readPage } from '@/features/supabase-data-access';

export type OrderStatus = 'pending' | 'done';
export type OrderQuery = { status: OrderStatus | 'all'; page: number };
export type OrderListItem = { id: string; status: OrderStatus; createdAt: string };
export type OrderPage = {
  items: OrderListItem[];
  total: number;
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

export async function listOrders(query: OrderQuery): Promise<OrderPage> {
  const result = await readPage(async ({ from, to }) => {
    let request = supabase.from('orders')
      .select('id,status,created_at', { count: 'exact' });
    if (query.status !== 'all') request = request.eq('status', query.status);
    const { data, error, count, status } = await request
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw { ...error, status };
    return { rows: data ?? [], count };
  }, { page: query.page, pageSize: 20 });

  return {
    items: result.rows.map(row => ({
      id: row.id, status: row.status, createdAt: row.created_at,
    })),
    total: result.total,
    page: result.page,
    hasPrevious: result.hasPrevious,
    hasNext: result.hasNext,
  };
}
```

`total` 来自相同筛选条件的精确计数，不能用本页长度替代。需要关联数据时，也在这里归一化：例如经真实查询验证的 `order_items: [{ count: 5 }]` 转为业务字段 `itemCount: 5`。先核对外键、聚合权限、返回形状和计数范围；不能把“全部明细数”命名为“失败明细数”，也不能把缺失的 count 默认为 0 来掩盖查询错误。详情接口同样先约定单对象、组合对象或不存在状态，禁止实现中途从 `record` 改为 `{ row, record }` 却不更新消费者。

### 2. Hook 管理请求状态与旧响应

示例文件：`src/hooks/useOrders.ts`。成功、失败都必须通过当前请求票据提交；卸载、筛选、翻页和重试使旧票据失效。请求键用于在新 effect 执行前隐藏旧条件的数据，不能在新筛选标题下短暂展示旧列表。

```ts
import { useEffect, useState } from 'react';
import { classifyPostgrestError, createLatestRequestGate } from '@/features/supabase-data-access';
import { listOrders } from '@/services/orders';
import type { OrderPage, OrderQuery } from '@/services/orders';

type OrderState =
  | { key: string; phase: 'loading' }
  | { key: string; phase: 'ready'; data: OrderPage }
  | { key: string; phase: 'error'; message: string; retryable: boolean };

export function useOrders({ status, page }: OrderQuery) {
  const [revision, setRevision] = useState(0);
  const key = `${status}:${page}:${revision}`;
  const [state, setState] = useState<OrderState>({ key, phase: 'loading' });

  useEffect(() => {
    const gate = createLatestRequestGate();
    const ticket = gate.begin();
    setState({ key, phase: 'loading' });
    void listOrders({ status, page }).then(
      data => ticket.commit(() => setState({ key, phase: 'ready', data })),
      (error: unknown) => {
        const failure = classifyPostgrestError(
          typeof error === 'object' && error !== null ? error : {},
        );
        const message = failure.kind === 'authentication' ? '请登录后查看订单'
          : failure.kind === 'permission' ? '当前账号无法读取订单，请联系管理员'
          : '订单加载失败，请稍后再试；持续失败请联系管理员';
        ticket.commit(() => setState({
          key, phase: 'error', message, retryable: failure.retry === 'read-only',
        }));
      },
    );
    return () => gate.invalidate();
  }, [key, status, page]);

  const visibleState: OrderState = state.key === key ? state : { key, phase: 'loading' };
  return { state: visibleState, retry: () => setRevision(value => value + 1) };
}
```

这里不自动重试；只有明确的限流或上游暂时失败显示手动重试。权限/schema 错误应修正身份或查询后重新进入页面。诊断时保留结构化错误供项目既有诊断机制使用，不直接展示数据库原始信息或凭据。卸载时使票据失效；若项目已有查询框架，沿用其过期响应处理能力。

### 3. 页面消费业务类型

示例文件：`src/pages/OrdersPage.tsx`。筛选和页码一次更新；空态从成功结果判断，异常不能降级成“暂无数据”。RLS 可能让 SELECT 返回空集合，不能仅凭空数组断言没有数据或确认权限正确。

```tsx
import { useState } from 'react';
import { useOrders } from '@/hooks/useOrders';
import type { OrderQuery } from '@/services/orders';

export function OrdersPage() {
  const [query, setQuery] = useState<OrderQuery>({ status: 'all', page: 1 });
  const { state, retry } = useOrders(query);
  return <main>
    <label>订单状态
      <select value={query.status} onChange={event => {
        const status = event.target.value;
        if (status === 'all' || status === 'pending' || status === 'done') {
          setQuery({ status, page: 1 });
        }
      }}>
        <option value="all">全部</option>
        <option value="pending">待处理</option>
        <option value="done">已完成</option>
      </select>
    </label>
    {state.phase === 'loading' && <p role="status">加载中…</p>}
    {state.phase === 'error' && <div role="alert">
      <p>{state.message}</p>
      {state.retryable && <button onClick={retry}>重试</button>}
    </div>}
    {state.phase === 'ready' && <>
      <p>共 {state.data.total} 条，第 {state.data.page} 页</p>
      {state.data.items.length === 0 ? <p>当前条件下无可显示订单</p>
        : <ul>{state.data.items.map(item => <li key={item.id}>
          {item.id} · {item.status === 'pending' ? '待处理' : '已完成'} · {item.createdAt}
        </li>)}</ul>}
      <button disabled={!state.data.hasPrevious}
        onClick={() => setQuery(value => ({ ...value, page: value.page - 1 }))}>上一页</button>
      <button disabled={!state.data.hasNext}
        onClick={() => setQuery(value => ({ ...value, page: value.page + 1 }))}>下一页</button>
      {query.page > 1 && state.data.items.length === 0 &&
        <button onClick={() => setQuery(value => ({ ...value, page: 1 }))}>返回第一页</button>}
    </>}
  </main>;
}
```

将页面挂到项目实际路由并沿用设计组件和主题。总数减少导致当前页越界时，本例提供返回第一页入口；不要无限重试当前页。现有项目若用 store/query 框架，应保留该状态源，实现同等的状态和过期响应隔离，而不是再叠加本例 Hook。

## 完整结果导出

只有导出、有限批处理等确实需要全部记录的场景才使用 `readAllPages`。它会在一次业务操作中连续发起多页查询，不用于普通列表翻页或无限滚动。

```ts
import { readAllPages } from '@/features/supabase-data-access';

const rows = await readAllPages(
  async ({ from, to }) => {
    const { data, error, count } = await supabase
      .from('orders')
      .select('id,status,total_cents,created_at', { count: 'exact' })
      .eq('status', activeStatus)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return { rows: data ?? [], count };
  },
  { keyOf: row => row.id, pageSize: 20, maxRows: 20_000 },
);
```

精确总数变化或稳定键重复时，核心抛错，页面应提示重新加载。它不提供数据库快照隔离：总数不变时的数据替换或字段更新仍可能穿插在多页结果中；需要一致快照的导出应由服务端实现。

## 关联与筛选

- `PGRST201` 表示关系歧义。先确认外键约束，再写 `author:profiles!posts_author_id_fkey(...)` 之类的显式关系；不要反复改关系别名碰运气。
- URL 编码后的超长 `.in(...)` 容易失败。少量只读补数可用 `planEncodedFilterBatches` 分组；聚合、复杂筛选和大 ID 集合优先 View/RPC/服务端查询。
- 对用户可输入的搜索词使用 Supabase 查询构造器，不拼接原始 PostgREST 过滤表达式。

## 查询失败与异常结果

- 保留结构化 code 与 HTTP status；原始 message/details/hint 用于诊断，页面按错误类别显示提示。分类接口见 [接口速查](runtime-api.md#3-错误分类)。
- 401 核对当前身份；403／42501 核对表、列读取权限、Policy 目标角色和 USING 条件，不放宽全表策略绕过。
- SELECT 空数组可能来自筛选或 RLS 可见性；先核对当前身份、查询条件和已知记录，不能据空数组认定数据库无数据或权限正常。
- PGRST116／406 核对单行查询的预期行数；关系歧义按上文真实外键消歧，schema 错误核对实际列和类型。
- 限流或暂时性上游失败可提供有界的只读重试；权限或 schema 错误修正后再查询。总数漂移、重复键等完整读取异常提示重新加载，不把部分结果当作完成。

实测范围和时机见 [Skill 验收与交付](../SKILL.md#验收与交付)。
