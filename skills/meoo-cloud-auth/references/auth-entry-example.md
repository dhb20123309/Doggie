# 认证页面接线索引

只读当前流程，公共模板原样复用。普通密码注册登录无需通读恢复、MFA 或内部工程约束。

| 当前需求 | 按需加载 |
| --- | --- |
| 用户名/邮箱/手机号密码注册登录 | [业务接线](password-flow.md) + 参数不明确时 [密码公共接口](password-api.md) |
| 登录/注册共页 | [共页 Gate 与收尾](auth-shared-page-wiring.md) |
| 首次接路由或改变访问边界 | [路由关系](auth-route-plan.md) |
| 注册建立 Session 后业务收尾失败 | [注册收尾](auth-registration-navigation.md) |
| 邮箱/短信确认 | [确认流程](verification-flow.md)，再加载已选 SOP 差异 |
| 密码恢复 | [恢复流程](recovery-flow-example.md) |
| MFA 或可信角色守卫 | [MFA](auth-mfa.md) |
| 真实跨流程/祖先 Gate 提前导航故障 | [完整排障示例](archive/auth-entry-example-full.md)，只读失败链路 |
| 公共入口缺失、存量架构迁移、模板内部故障 | [工程接入](integration.md)，先核对现状 |

根布局唯一 Provider + Outlet；业务边界 AuthGate；普通 login Gate 跟随真实身份；register/recovery 从进入起保持该模式，确认和业务收尾全部成功后才能导航。同页标签与外层 mode 同一父组件管理。返回 error、无 Session 或写入失败不能当成功。

真实注册、错误密码重试、自动返回目标、刷新恢复和退出刷新匿名必须实际验收。模板测试和构建不能替代页面成功。
