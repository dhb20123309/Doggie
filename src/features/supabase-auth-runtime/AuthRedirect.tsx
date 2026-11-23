import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';

// runtime 内部导航边界，不从公共入口导出；一次挂载对应一次认证跳转。
export function AuthRedirect({ href }: { href: string }) {
  const navigate = useNavigate();
  const [target] = useState(href);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const request = useRef<{ attempt: number; promise: Promise<void> } | null>(
    null
  );

  useEffect(() => {
    let active = true;
    // 在调用路由前登记，父层重渲染和 StrictMode effect 重放共用同一请求。
    if (!request.current || request.current.attempt !== attempt) {
      const current = { attempt, promise: Promise.resolve() };
      request.current = current;
      try {
        current.promise = Promise.resolve(
          navigate({ href: target, replace: true })
        );
      } catch (error) {
        current.promise = Promise.reject(error);
      }
    }
    void request.current.promise.catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [navigate, target, attempt]);

  if (failed) {
    return (
      <div role="alert">
        <p>页面跳转失败，请重试。</p>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setAttempt(value => value + 1);
          }}
        >
          重试跳转
        </button>
      </div>
    );
  }
  // 地址变化或 navigate 返回都不代表目标页已经提交；由路由完成切换并卸载这里。
  return <p role="status">正在跳转…</p>;
}
