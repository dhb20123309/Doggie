// 普通认证公共入口；恢复使用 optional/usePasswordRecoveryFlow，角色和 MFA 守卫从 optional/auth-guards 按需导入。
export { AuthProvider, useAuth } from './AuthProvider';
export type { AuthStatus, AuthFlow, AuthContextValue } from './AuthProvider';
export { createAuthActions } from './auth-actions';
export type {
  AuthImplementationSop,
  BasicAuthSignUpInput,
  EmailPasswordSignUpInput,
  PhonePasswordSignUpInput,
} from './auth-actions';
export { AuthGate, AuthEntryGate } from './AuthGate';
export { LoginEntry, ProtectedLayout } from './WebAuthLayout';
export type { AuthEntryMode } from './AuthGate';
export { resolveAuthFeedback } from './auth-error';
export type {
  AuthFeedback,
  AuthFeedbackOptions,
  AuthFeedbackOperation,
  AuthFeedbackAction,
} from './auth-error';
export { resolveSafeReturnTo, buildLoginPath } from './auth-navigation';
export { normalizeMainlandPhone } from './auth-phone';
export { useAuthSubmit } from './useAuthSubmit';
export { useRegistrationFlow } from './useRegistrationFlow';
export type { RegistrationState, RegistrationFinalizationScope } from './useRegistrationFlow';

export { PasswordRegistrationForm, PasswordLoginForm } from './PasswordAuthForms';
export type { PasswordRegistrationFormProps, PasswordLoginFormProps } from './PasswordAuthForms';
