---
name: meoo-cloud-auth
description: Web/Expo 的用户名、邮箱、手机号密码登录、注册、Session、退出、路由和恢复；静态登录页、小程序认证或仅分析登录故障不加载。
allowed_create_modes:
  - create-desktop
  - create-app
component_keywords:
  - '(?:^|/)[^/]*(?:auth|login|account)[^/]*\.[tj]sx?$'
  - '(?:^|/)(?:features/(?:supabase-)?auth(?:-runtime)?|auth)(?:/|$)'
  - '(?:^|/)(?:AuthProvider|auth-state|auth-actions|auth-store|authStore)\.[tj]sx?$'
---

# 真实认证

先确认 `meoo-cloud` 与项目 Client 可用，按 `skills/meoo-cloud/references/auth-routing.md` 确定唯一 SOP。邮箱注册用 auth_email_password、手机号注册用 auth_sms_password；普通用户名模式 basic_auth 的输入原样交动作解析，不能按字符串形状改模式。已有明确模式直接沿用，缺失的通道选择才澄清，不重新迁移认证架构。

本轮按用户当前要求划定交付范围：只要求账户入口、客户概览与基础资料时，就完成这条闭环；不从产品名称推导客户新建/编辑/详情、跟进、多角色等后续功能。更多页面不等于本轮完成度更高。

## 最小公共合同

公共入口为 `src/features/supabase-auth-runtime/index.ts`，从 `@/features/supabase-auth-runtime` 导入。

先核对复制回执。Web 上下文已提供真实公共入口导出和 password-api 公共合同，直接按已注入接口接线，不再为发现接口读取 index 或遍历 AuthProvider、动作、Gate、Hook 内部源码。已有实现、复制不可用、编译错误或具体契约缺失时才核对对应实际文件；未收到公共合同的环境仍按需读取入口。保留现有实现，只修复确认缺失的能力：

- 根布局唯一 `AuthProvider`，用 `useAuth()` 的 status、session、user；状态为 loading / authenticated / anonymous / error。Session 初始化和唯一监听器由 Provider 负责，页面不另建 store/订阅。普通密码接口在下述完整接线合同内；额外参数确实缺失才查 [密码公共合同](references/password-api.md)；恢复、MFA 或内部排障才查完整 runtime-api 对应章节。
- 创建一个 `createAuthActions(<SOP>)`，复用 signUp / signIn / signOut。basic_auth 入参 `{username,password}`；邮箱注册 `{email,password,username}`、登录 `{email,password}`；短信注册 `{phone,password,username}`、登录 `{phone,password}`。密码不 trim。
- Web 普通用户名密码登录路由使用 `LoginEntry`，传 signIn 和实际登录后目标 authenticatedPath；业务父路由用 `ProtectedLayout` 包住 Outlet。两个入口共享根 AuthProvider，不再外套 Gate 或手动 navigate。普通注册复用 `PasswordRegistrationForm`，按 [当前流程接线](references/password-flow.md) 绑定实际资料 service。存量项目先核对公共导出；缺少组合组件时沿用已有 AuthEntryGate、PasswordLoginForm 和 AuthGate。其他平台或不同注册交互按需使用 useRegistrationFlow。
- 动作返回 SDK 原始 `{data,error}`；登录/普通动作表单用 `useAuthSubmit().execute(operation,()=>动作(values))` 管理互斥、错误反馈和按钮恢复，返回原始 data 或 null。signUp 无 error 不代表已有 Session 或注册已完成；验证码/SMS 仅按已选模式补 [确认流程](references/verification-flow.md) 和 [邮箱](references/auth-email-password.md) / [短信](references/auth-sms-password.md) 差异。
- 用户数据/RLS 沿用认证数据基线。角色/profile 业务收尾检查真实结果再导航；不直接写 auth.users、不生成密码哈希、不伪造登录态。
- 用户明确要求 Web 管理员、多角色或权限控制时，按 [角色查询接线](references/role-access-example.md) 组合身份保护、业务查询和 RoleGate；区分 loading、error、granted、denied，查询按用户隔离，错误允许重试。

## 页面与导航

写页面前一次确定「文件名→实际URL→父布局」。已有业务前缀就沿用；新项目先用一个受保护概览页验证路由，不先写两组不同前缀页面再搬迁。路由调整复用正文，只修改文件名/声明/导航，不整页重写。

只创建本轮需要的入口，登录/注册复用正文；仅明确要求密码恢复时创建 `/reset-password`。根布局只挂 Provider 和 Outlet，不按 Session 统一跳转；要求登录的业务边界挂 AuthGate，游客可浏览页面不挂整页 Gate。

普通 Web 用户名密码登录页由 LoginEntry 内置 AuthEntryGate(mode='login')；自定义登录页直接使用该 Gate。跳转随身份状态触发，表单不再重复 navigate。注册 mode='register'、恢复 mode='recovery' 必须从进入流程起固定，Session 提前到达不能抢走步骤。注册完成身份确认及业务收尾后才导航；恢复成功改密并退出恢复会话再返回登录。普通退出只 signOut，匿名后由业务 Gate 导航。路由 pending 时同一跳转固定目标并去重，不用全局 location 拼套娃 returnTo，不用 location key 重挂 Gate。

普通密码注册/登录只读一次 [完整可执行接线合同](references/password-flow.md)，其中已包含现成表单的少量业务绑定和完整受保护父子路由；先接线编译，再按当前需求添加业务内容；不要再顺着索引遍历同主题参考。登录/注册共页时标签与外层 Gate.mode 必须由同一父组件持有，提交期间禁用切换。Web现成表单已复用这些Hook；用className及CSS调整样式，不另写SDK提交、反馈或复制模板正文。实际组件按钮 type='submit' 且透传事件。路由或参数契约确实缺失才查对应参考；只实现本轮要求的页面和业务收尾。


## 验证标准

验证真实注册、登录自动到目标页无需刷新、错误密码后可重试、刷新恢复与退出后刷新匿名。注册确认或密码恢复有独立步骤时检查 Session 提前到达不误跳；权限由数据库 RLS 验证。没有验证码/测试身份时完成其余项并记录未验证，不能以 build 或模板复制替代功能成功。验收方式和测试身份来源遵循当前用户指令；明确指定 cloud create-test-user 时按现有命令合同单独执行，其他情况使用测试管理接口提供的身份。脚本装载/语法错误先修验收驱动，不改业务去迎合错误测试，也不把工具退出码代替业务断言；用户明确要求交付账号时才读 [测试账号](references/test-accounts.md)。

跨流程导航排障查 [完整接线示例](references/auth-entry-example.md)，复杂存量迁移或模板内部排障查 [高级约束](references/advanced-workflows.md)，不作为普通接入必读。普通接入不提前实现恢复、MFA 或迁移。需要时分别查 [恢复例](references/recovery-flow-example.md)、[MFA](references/auth-mfa.md)、[工程约束](references/integration.md)，排障按具体失败链路读取。已有内容未变不重复加载。


