# Expo 认证适配

沿用 `expo-project` 的工程约束；Client 初始化与 Session 存储接入遵守 `skills/meoo-cloud/references/expo-cloud-runtime.md`。RN 兼容问题查 `skills/expo-project/references/RnPitfalls.md`，新增或调整依赖时查其 `references/dependencies.md`，不为普通认证接线重复加载整套工程资料。

新项目默认使用 `/login`、`/register`、`/reset-password` 对应的独立 screen，并固定各自 Gate mode；不要自行改为一个 screen 加 mode 参数切换。已有组合入口或用户明确要求时才沿用组合方式。

## 基础接线

- 复用平台生成的 Supabase Client：其包含 `react-native-url-polyfill` 和 `expo-secure-store`。不手写或编辑 Client，不用 localStorage／AsyncStorage 另存 Auth Session；若生成产物缺少适配，按初始化流程排查。
- UI 用 RN 组件与 `StyleSheet.create`，路由用 Expo Router；禁止 window、document、DOM 文件输入等 Web API。import 使用项目实际别名／正确相对路径。
- 使用 Router 前读 `skills/expo-project/references/RouterOverView.md` 或 `RouterLink.md`；直接使用 SecureStore API 时读 `SecureStore.md`。业务无需重写 Client 的存储适配。
- 同名 Gate 与 Web 状态语义一致；表单保留、恢复验证、新密码保存顺序复用共同流程。


注册确认与密码恢复均使用数字验证码，不需要邮箱 deep link 或 callback。
