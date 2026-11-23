// 零花钱钱包：用户余额 + 各角色余额 + 收支流水（localStorage vp-phone:wallet:v1）
// 转账功能的数据底座：发起即扣款冻结，对方点卡片"收下"才入账；24h 未收可退回。

import { usePersisted } from "./chat-store";

export interface WalletTx {
  at: number;
  /** 正数=收入，负数=支出 */
  delta: number;
  /** 对手方显示名 */
  who: string;
  note: string;
}

export interface WalletState {
  userBalance: number;
  /** charId → 角色余额 */
  charBalances: Record<string, number>;
  /** 最近 50 条流水（最新在前） */
  txs: WalletTx[];
}

const DEFAULT_WALLET: WalletState = { userBalance: 5200, charBalances: {}, txs: [] };

export const WALLET_KEY = "vp-phone:wallet:v1";

export function useWallet() {
  return usePersisted<WalletState>(WALLET_KEY, DEFAULT_WALLET);
}

/** 纯函数版读写（供 settleReply 等直写 localStorage 的链路使用，不依赖 React state） */
export function readWallet(): WalletState {
  try {
    const raw = JSON.parse(localStorage.getItem(WALLET_KEY) || "") as WalletState;
    return {
      userBalance: Number.isFinite(raw?.userBalance) ? raw.userBalance : DEFAULT_WALLET.userBalance,
      charBalances: raw?.charBalances ?? {},
      txs: Array.isArray(raw?.txs) ? raw.txs : [],
    };
  } catch {
    return { ...DEFAULT_WALLET };
  }
}

export function writeWallet(fn: (prev: WalletState) => WalletState) {
  try {
    localStorage.setItem(WALLET_KEY, JSON.stringify(fn(readWallet())));
  } catch {
    /* ignore */
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 用户 → 角色 转账（发起即扣）；余额不足返回 false */
export function walletUserSend(charId: string, amount: number, note: string, who: string): boolean {
  const a = round2(amount);
  if (!Number.isFinite(a) || a <= 0 || a > 52000) return false;
  let ok = false;
  writeWallet((prev) => {
    if (prev.userBalance < a) return prev;
    ok = true;
    return {
      userBalance: round2(prev.userBalance - a),
      charBalances: { ...prev.charBalances, [charId]: round2((prev.charBalances[charId] ?? 0) + a) },
      txs: [{ at: Date.now(), delta: -a, who, note }, ...prev.txs].slice(0, 50),
    };
  });
  console.log(`[wallet] user→char send ${a} to=${charId} ok=${ok}`);
  return ok;
}

/** 角色 → 用户 转账（挂账待收：只扣角色余额，用户点收下卡片时才入账） */
export function walletCharSend(charId: string, amount: number, note: string): void {
  const a = round2(amount);
  if (!Number.isFinite(a) || a <= 0 || a > 52000) return;
  writeWallet((prev) => ({
    ...prev,
    charBalances: { ...prev.charBalances, [charId]: round2((prev.charBalances[charId] ?? 0) - a) },
  }));
  console.log(`[wallet] char→user offer ${a} from=${charId}（待用户点收）`);
}

/** 用户收下角色的待收转账：用户入账（角色侧已在 walletCharSend 扣过，不重复扣） */
export function walletUserReceive(charId: string, amount: number, note: string, who: string): void {
  const a = round2(amount);
  writeWallet((prev) => ({
    ...prev,
    userBalance: round2(prev.userBalance + a),
    txs: [{ at: Date.now(), delta: a, who, note }, ...prev.txs].slice(0, 50),
  }));
  console.log(`[wallet] user received ${a} from=${charId}`);
}

/** 退回/超时作废：把角色挂账扣掉的金额加回角色余额 */
export function walletCharRestore(charId: string, amount: number): void {
  const a = round2(amount);
  writeWallet((prev) => ({
    ...prev,
    charBalances: { ...prev.charBalances, [charId]: round2((prev.charBalances[charId] ?? 0) + a) },
  }));
  console.log(`[wallet] char offer restored ${a} to=${charId}`);
}

export function walletCharBalance(w: WalletState, charId: string): number {
  return w.charBalances[charId] ?? 0;
}
