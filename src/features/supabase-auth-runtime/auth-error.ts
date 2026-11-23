// 只生成安全的页面反馈，不发起请求、修改 Session 或执行跳转。
type AuthMethodOperation =
  | 'signIn'
  | 'signUp'
  | 'signOut'
  | 'verifySignUp'
  | 'requestPasswordRecovery'
  | 'verifyPasswordRecovery'
  | 'resend'
  | 'updatePassword'
  | 'updateUser'
  | 'session'
  | 'mfa.challenge'
  | 'mfa.verify';

// 兼容已生成页面；新代码直接使用调用的方法名。
const legacyOperations = {
  login: 'signIn',
  signup: 'signUp',
  verify_signup: 'verifySignUp',
  request_recovery: 'requestPasswordRecovery',
  verify_recovery: 'verifyPasswordRecovery',
  update_password: 'updatePassword',
  update_user: 'updateUser',
  mfa_challenge: 'mfa.challenge',
  mfa_verify: 'mfa.verify',
} as const;

export type AuthFeedbackOperation =
  | AuthMethodOperation
  | keyof typeof legacyOperations;

export type AuthFeedbackAction =
  | 'retry'
  | 'edit_account'
  | 'edit_password'
  | 'verify_account'
  | 'resend_code'
  | 'wait'
  | 'login'
  | 'reauthenticate'
  | 'restart_mfa'
  | 'contact_support'
  | 'none';

export interface AuthFeedback {
  message: string;
  // 由页面按已实现的 SOP 提供操作入口，不代表可以自动执行或绕过校验。
  action: AuthFeedbackAction;
}

export interface AuthFeedbackOptions {
  operation: AuthFeedbackOperation;
  // 注册页按产品策略隐藏账号是否存在；找回密码始终使用防枚举文案。
  preventAccountEnumeration?: boolean;
}

// 同一业务码仅在适用操作下匹配；保持未知错误兜底。
function rule(
  operations: readonly AuthMethodOperation[],
  message: string,
  action: AuthFeedbackAction
) {
  return { operations, feedback: { message, action } };
}

const sessionExpired = rule(
  ['session', 'updatePassword', 'updateUser', 'mfa.challenge', 'mfa.verify'],
  '登录状态已失效，请重新登录',
  'login'
);

const feedbackRules: Record<string, ReturnType<typeof rule>> = {
  auth_input_required: rule(
    ['signIn', 'signUp'],
    '请输入用户名或邮箱',
    'edit_account'
  ),
  auth_input_phone_invalid: rule(
    ['signIn', 'signUp', 'verifySignUp', 'requestPasswordRecovery', 'verifyPasswordRecovery', 'resend'],
    '请输入正确的中国大陆手机号',
    'edit_account'
  ),
  auth_input_email_invalid: rule(
    ['signIn', 'signUp'],
    '请输入正确的邮箱地址',
    'edit_account'
  ),
  auth_input_username_invalid: rule(
    ['signIn', 'signUp'],
    '请输入正确的用户名',
    'edit_account'
  ),
  invalid_credentials: rule(
    ['signIn'],
    '账号或密码错误，请检查后重试',
    'retry'
  ),
  email_not_confirmed: rule(
    ['signIn'],
    '邮箱尚未验证，请先完成验证',
    'verify_account'
  ),
  phone_not_confirmed: rule(
    ['signIn'],
    '手机号尚未验证，请先完成验证',
    'verify_account'
  ),
  email_address_invalid: rule(
    ['signUp', 'requestPasswordRecovery', 'resend', 'updateUser'],
    '该邮箱地址不可用，请检查或更换邮箱',
    'edit_account'
  ),
  weak_password: rule(
    ['signUp', 'updatePassword', 'updateUser'],
    '密码不符合安全要求，请调整后重试',
    'edit_password'
  ),
  same_password: rule(
    ['updatePassword', 'updateUser'],
    '新密码不能与原密码相同',
    'edit_password'
  ),
  otp_expired: rule(
    ['verifySignUp', 'verifyPasswordRecovery'],
    '验证码无效或已失效，请检查或重新获取',
    'resend_code'
  ),
  over_email_send_rate_limit: rule(
    ['signUp', 'requestPasswordRecovery', 'resend', 'updateUser'],
    '验证码发送过于频繁，请稍后再试',
    'wait'
  ),
  over_sms_send_rate_limit: rule(
    [
      'signUp',
      'requestPasswordRecovery',
      'resend',
      'updateUser',
      'mfa.challenge',
    ],
    '验证码发送过于频繁，请稍后再试',
    'wait'
  ),
  user_banned: rule(
    [
      'signIn',
      'verifySignUp',
      'requestPasswordRecovery',
      'verifyPasswordRecovery',
      'session',
    ],
    '当前账号暂时无法使用，请联系管理员',
    'contact_support'
  ),
  session_expired: sessionExpired,
  session_not_found: sessionExpired,
  refresh_token_not_found: rule(
    ['session'],
    '登录状态已失效，请重新登录',
    'login'
  ),
  reauthentication_needed: rule(
    ['updatePassword', 'updateUser'],
    '请重新验证身份后修改密码',
    'reauthenticate'
  ),
  reauthentication_not_valid: rule(
    ['updatePassword', 'updateUser'],
    '身份验证未通过，请重试',
    'reauthenticate'
  ),
  mfa_challenge_expired: rule(
    ['mfa.verify'],
    '验证已失效，请重新发起',
    'restart_mfa'
  ),
  mfa_verification_failed: rule(['mfa.verify'], '验证码错误，请重试', 'retry'),
};

export function resolveAuthFeedback(
  error: unknown,
  {
    operation: inputOperation,
    preventAccountEnumeration = false,
  }: AuthFeedbackOptions
): AuthFeedback {
  const operation = Object.prototype.hasOwnProperty.call(
    legacyOperations,
    inputOperation
  )
    ? legacyOperations[inputOperation as keyof typeof legacyOperations]
    : (inputOperation as AuthMethodOperation);
  const value =
    error !== null && typeof error === 'object'
      ? (error as { code?: unknown; status?: unknown; message?: unknown })
      : {};
  const code =
    typeof value.code === 'string' ? value.code.trim().toLowerCase() : '';
  const status = typeof value.status === 'number' ? value.status : 0;

  // 不将账号不存在暴露给找回密码页面，也不把反馈当成发送成功凭据。
  if (code === 'user_not_found') {
    if (operation === 'requestPasswordRecovery') {
      return {
        message: '如果账号存在，我们会发送验证信息，请留意查收',
        action: 'none',
      };
    }
    if (operation === 'signIn') {
      return { message: '账号或密码错误，请检查后重试', action: 'retry' };
    }
    if (
      operation === 'verifySignUp' ||
      operation === 'verifyPasswordRecovery'
    ) {
      return {
        message: '验证码无效或已失效，请检查或重新获取',
        action: 'resend_code',
      };
    }
  }

  if (['user_already_exists', 'email_exists', 'phone_exists'].includes(code)) {
    if (operation === 'signUp') {
      return preventAccountEnumeration
        ? {
            message: '暂时无法完成注册，请检查输入或使用登录、找回密码入口',
            action: 'login',
          }
        : { message: '该账号已注册，请登录或找回密码', action: 'login' };
    }
    if (operation === 'updateUser') {
      return {
        message: '该邮箱或手机号暂不可用，请更换后重试',
        action: 'edit_account',
      };
    }
  }

  if (code === 'over_request_rate_limit') {
    return { message: '操作过于频繁，请稍后再试', action: 'wait' };
  }

  const rule = Object.prototype.hasOwnProperty.call(feedbackRules, code)
    ? feedbackRules[code]
    : undefined;
  if (rule?.operations.includes(operation)) {
    // 不把共享字典对象暴露给页面修改。
    return { ...rule.feedback };
  }

  // HTTP 状态只兜底通用提示，不能把所有 400/401 都说成密码错误或会话过期。
  if (status === 429) {
    return { message: '操作过于频繁，请稍后再试', action: 'wait' };
  }
  if (status >= 500 && status <= 599) {
    return { message: '认证服务暂时不可用，请稍后重试', action: 'retry' };
  }
  // 仅兼容没有 code 的常见网络异常；不展示或宽泛匹配原始响应。
  if (
    !code &&
    typeof value.message === 'string' &&
    [
      'failed to fetch',
      'fetch failed',
      'network request failed',
      'load failed',
      'networkerror when attempting to fetch resource.',
    ].includes(value.message.trim().toLowerCase())
  ) {
    return { message: '网络连接失败，请检查网络后重试', action: 'retry' };
  }
  return {
    message: '暂时无法完成此操作，请稍后重试；如持续失败，请联系管理员',
    action: 'retry',
  };
}
