# Supabase 原生登录二次校验（MFA）

本文件处理已选第一因子登录成功后的二次校验；注册邮箱／短信确认和找回密码不属于 MFA。

## 能力边界

- Supabase 原生 MFA 第二因子只使用 TOTP 身份验证器或 Phone MFA。
- 邮箱 OTP 不是 Supabase MFA factor。用户要求“密码 + 邮箱验证码二次校验”时，明确说明当前不能按原生 MFA 实现，并让用户改选 TOTP 或 Phone MFA；未确认前 STOP。
- Phone MFA 必须先确认当前 Meoo Cloud 实例已开放该能力并已配置可用的短信/WhatsApp provider。无法确认或未开放时 STOP，优先建议 TOTP；不得退化为 `signInWithOtp({ phone })`。
- `signInWithOtp()` / `verifyOtp()` 的普通 OTP 登录、注册确认或恢复流程不会把密码登录 Session 自动升级为 MFA Session，禁止用前端布尔值冒充二次校验结果。

## 完整接入的四段流程

仅完整接入时覆盖以下流程；局部修复复用已有实现，不因本文新增或重建无关页面。可选 MFA 的普通页面不强制套 MfaGate；只有明确要求 AAL2 的资源才强制 enrollment/challenge。

1. **Enrollment**：通过 `supabase.auth.mfa.enroll()` 注册 TOTP 或 phone factor，并完成首次 challenge/verify；提供查看和 `unenroll()` 管理入口。
2. **登录 Challenge**：第一因子登录后调用 `getAuthenticatorAssuranceLevel()`；`currentLevel='aal1' && nextLevel='aal2'` 时进入 challenge 页面，通过 `challenge()` + `verify()` 或 `challengeAndVerify()` 完成校验。
3. **状态恢复**：从 `@/features/supabase-auth-runtime/optional/auth-guards` 导入 `resolveMfaSnapshot()`、`initialMfaSnapshot` 和 `MfaGate`，通过 `resolveMfaSnapshot()` 区分 `not_enrolled`、`challenge_required`、`verified` 和 `error`。不要把 MFA 查询放进 `onAuthStateChange` 回调；在 Auth 状态更新后的 effect 中查询，并在 challenge 成功后重新解析 AAL。
4. **服务端强制**：真正要求二次校验的敏感表、API 或 Edge Function 必须校验 JWT 的 `aal='aal2'`。仅使用前端 `MfaGate` 不构成安全控制。

## AAL 状态语义

| currentLevel | nextLevel | 状态 | 页面行为 |
| --- | --- | --- | --- |
| `aal1` / `null` | `aal1` / `null` | `not_enrolled` | 强制 MFA 场景进入 enrollment；可选 MFA 场景允许继续 |
| `aal1` | `aal2` | `challenge_required` | 进入 challenge，不展示受保护内容 |
| `aal2` | `aal2` | `verified` | 允许进入要求 AAL2 的页面 |
| 查询错误 | 查询错误 | `error` | 显示错误并允许重试；不得按未注册或无权限处理 |

## Factor 与错误处理

通过 `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` 查询等级、`listFactors()` 查询 factor，每步检查返回 error。首次 challenge 使用 enroll 刚返回的 unverified factor id；后续登录只使用 listFactors 返回的 verified factor，不信任 URL 或本地存储中的任意 factor id。

模板只封装 MFA 状态与 Gate，不封装以下动作；通过项目 Client 的 `supabase.auth.mfa` 调用：

| 动作 | 必要参数／结果衔接 |
| --- | --- |
| `enroll` | TOTP：`{ factorType: 'totp' }`；Phone：`{ factorType: 'phone', phone }`；成功后取 `data.id` 作为首次 factorId |
| `challenge` → `verify` | 先 `challenge({ factorId })`，成功后用同一 factorId、返回的 `data.id` 作为 challengeId，以及用户 code 调用 `verify({ factorId, challengeId, code })` |
| `unenroll` | `{ factorId }`，仅操作当前用户已有的 factor |

前一步失败不读取 data 或继续下一步，验证成功后重新查询 AAL；不要混用旧 challenge 或另一 factor 的验证码。

## RLS 基线

只有产品明确要求某张表必须完成二次校验才能访问时，才增加限制性策略：

```sql
CREATE POLICY require_aal2_for_sensitive_data
ON public.sensitive_data
AS RESTRICTIVE
FOR ALL
TO authenticated
USING ((SELECT auth.jwt()->>'aal') = 'aal2')
WITH CHECK ((SELECT auth.jwt()->>'aal') = 'aal2');
```

存量项目修改 RLS 遵守主 Skill 的授权和兼容边界。不要为了添加 MFA 放宽、替换或删除已有业务策略。

## 完成门禁

- 第一因子成功后，已注册 factor 的用户进入 challenge，而不是直接进入敏感页面。
- 验证成功后的新 Session/JWT 为 `aal2`；刷新后仍能从 AAL 恢复正确状态。
- challenge 失败、网络失败和 429 保持错误态，不降级为允许访问。
- 未完成 AAL2 时，直接请求受保护数据会被 RLS/API 拒绝。
- TOTP/Phone 的 enrollment、challenge、verify、unenroll 均检查错误；Phone MFA 的平台能力和消息 provider 已确认。
