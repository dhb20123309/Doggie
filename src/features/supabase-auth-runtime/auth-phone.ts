// 大陆短信认证使用唯一手机号格式；不改变 basic_auth 的用户名语义。
export function normalizeMainlandPhone(phone: string): string {
  const value = phone.trim();
  const national = value.replace(/^\+?86/, '');
  if (!/^1[3-9]\d{9}$/.test(national)) {
    throw Object.assign(new Error('请输入正确的中国大陆手机号'), {
      code: 'auth_input_phone_invalid',
    });
  }
  return `+86${national}`;
}
