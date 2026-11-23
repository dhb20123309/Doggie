// 全项目唯一的认证动作对象：basic_auth（用户名/邮箱形状 + 密码，无验证码/找回）。
// 输入解析（合法邮箱直传、普通名补 @meoo.local）由模板 auth-actions 内部完成。
import { createAuthActions } from "@/features/supabase-auth-runtime";

export const authActions = createAuthActions("basic_auth");
