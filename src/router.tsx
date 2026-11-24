/**
 * TanStack Router 实例。
 *
 * 路由约定：
 * - 页面文件放 src/routes/，用 createFileRoute 定义
 * - src/routeTree.gen.ts 由 Vite 插件（@tanstack/router-plugin）在 dev/build 时自动更新（勿手改）
 * - 根布局见 src/routes/__root.tsx；首页占位见 src/routes/index.tsx（须整体替换）
 */
import { QueryClient } from '@tanstack/react-query';
import { createHashHistory, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    // GitHub Pages 静态托管没有 SPA fallback：browser history 下刷新/主屏幕快捷方式
    // 会直接请求 /Doggie/xxx 命中 404。改用 hash history，任何入口都只加载 index.html。
    history: createHashHistory(),
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  console.log(`[router] history=hash base=${window.location.pathname}`);
  return router;
};
