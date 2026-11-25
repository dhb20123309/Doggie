// 游戏大厅：分类 Tab + 玩法卡片网格 + 对手选择 + 继续对局入口。
// 可变人数玩法点「开局」先弹开局配置卡（人数步进 + 角色多选，空位自动人机）。
import { useMemo, useState } from "react";
import { ChevronLeft, Play, Gamepad2, Minus, Plus, X } from "lucide-react";
import type { Character } from "@/lib/chat-types";
import { displayName } from "@/lib/chat-types";
import { GAME_SPECS, CATEGORY_CN, CATEGORY_ORDER } from "@/lib/games";
import type { GameCategory, GameSpec } from "@/lib/games/types";

interface Props {
  characters: Character[];
  activeCharId: string;
  onPickChar: (id: string) => void;
  /** 有进行中局时的续局入口：gameId → 进入 */
  liveGameId?: string | null;
  onResume?: () => void;
  /** 开局：seats=总座位数（含 seat0 玩家），charIds=按 seat1.. 顺序的真实角色 id，其余补人机 */
  onStart: (spec: GameSpec, seats: number, charIds: string[]) => void;
  onBack: () => void;
}

const CAT_EMOJI: Record<GameCategory, string> = { board: "♟️", card: "🃏", dice: "🎲", table: "🎡" };

/** 玩法是否声明了可变/多于 2 的人数 */
export function seatRange(spec: GameSpec): { min: number; max: number } | null {
  const max = spec.maxSeats ?? 2;
  if (max <= 2 && (spec.minSeats ?? 2) <= 2) return null;
  return { min: spec.minSeats ?? 2, max };
}

export function GameHall({ characters, activeCharId, onPickChar, liveGameId, onResume, onStart, onBack }: Props) {
  const [cat, setCat] = useState<GameCategory>("board");
  const [setup, setSetup] = useState<{ spec: GameSpec; seats: number; charIds: string[] } | null>(null);
  const list = useMemo(() => GAME_SPECS.filter((g) => g.category === cat), [cat]);
  const ch = characters.find((c) => c.id === activeCharId) ?? characters[0];

  const openSetup = (spec: GameSpec) => {
    const range = seatRange(spec);
    if (!range) {
      // 固定 2 人：一点即开，沿用当前选中角色
      onStart(spec, 2, ch ? [ch.id] : []);
      return;
    }
    const seats = Math.min(range.max, Math.max(range.min, 1 + (characters.length ? 1 : 0)));
    setSetup({ spec, seats, charIds: ch ? [ch.id] : [] });
  };

  const confirmSetup = () => {
    if (!setup) return;
    const ids = setup.charIds.slice(0, setup.seats - 1);
    onStart(setup.spec, setup.seats, ids);
    setSetup(null);
  };

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-[oklch(0.97_0.015_85)] to-[oklch(0.94_0.02_75)]">
      <div className="glass-nav flex items-center gap-2 px-3 py-2">
        <button type="button" className="jelly-icon rounded-full p-1.5 text-neutral-600" onClick={onBack} aria-label="返回"><ChevronLeft size={18} /></button>
        <div className="flex-1">
          <p className="text-sm font-bold text-neutral-800">游戏大厅</p>
          <p className="text-[11px] text-neutral-500">{GAME_SPECS.length} 款玩法，和 TA 本地对战</p>
        </div>
        <Gamepad2 size={16} className="text-neutral-400" />
      </div>

      {/* 默认对手（固定 2 人玩法用；多人玩法在开局卡里再选） */}
      <div className="flex items-center gap-2 overflow-x-auto px-3 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className="shrink-0 text-[11px] text-neutral-400">对手</span>
        {characters.map((c) => (
          <button key={c.id} type="button" onClick={() => onPickChar(c.id)}
            className={`jelly-btn shrink-0 rounded-full px-3 py-1 text-xs ${c.id === ch?.id ? "bg-rose-400 text-white shadow" : "bg-white/70 text-neutral-600"}`}>
            {displayName(c)}
          </button>
        ))}
      </div>

      {/* 续局提示 */}
      {liveGameId && onResume && (
        <button type="button" onClick={onResume}
          className="mx-3 mb-1 flex items-center justify-between rounded-2xl bg-emerald-50 px-3 py-2 text-left jelly-btn">
          <span className="text-xs text-emerald-700">⏳ 你和 {ch ? displayName(ch) : "TA"} 还有一局{GAME_SPECS.find((g) => g.id === liveGameId)?.name ?? ""}没下完</span>
          <span className="text-[11px] font-semibold text-emerald-600">继续 →</span>
        </button>
      )}

      {/* 分类 Tab */}
      <div className="flex gap-1.5 px-3 py-2">
        {CATEGORY_ORDER.map((k) => (
          <button key={k} type="button" onClick={() => setCat(k)}
            className={`jelly-btn flex-1 rounded-xl py-1.5 text-xs font-medium ${cat === k ? "bg-neutral-800 text-white shadow" : "bg-white/60 text-neutral-500"}`}>
            {CAT_EMOJI[k]} {CATEGORY_CN[k]}
          </button>
        ))}
      </div>

      {/* 玩法卡片 */}
      <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto px-3 pb-4">
        {list.map((g) => (
          <button key={g.id} type="button" onClick={() => openSetup(g)}
            className="glass group relative flex flex-col items-start gap-1 rounded-2xl p-3 text-left transition-shadow hover:shadow-md">
            <div className="flex w-full items-center justify-between">
              <span className="text-sm font-bold text-neutral-800">{g.name}</span>
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">{g.players}</span>
            </div>
            <p className="line-clamp-2 text-[11px] leading-snug text-neutral-500">{g.ruleSummary}</p>
            <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-rose-400 opacity-80 transition-opacity group-hover:opacity-100">
              <Play size={11} /> {seatRange(g) ? "设置开局" : "开局"}
            </span>
            {g.simplified && <span className="absolute right-2 top-9 text-[9px] text-amber-500/80">简化规则</span>}
          </button>
        ))}
      </div>

      {/* 开局配置弹层 */}
      {setup && (
        <SetupSheet
          setup={setup}
          characters={characters}
          onChange={(next) => setSetup({ ...setup, ...next })}
          onClose={() => setSetup(null)}
          onConfirm={confirmSetup}
        />
      )}
    </div>
  );
}

function SetupSheet({ setup, characters, onChange, onClose, onConfirm }: {
  setup: { spec: GameSpec; seats: number; charIds: string[] };
  characters: Character[];
  onChange: (patch: { seats?: number; charIds?: string[] }) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const range = seatRange(setup.spec)!;
  const foeSlots = setup.seats - 1;
  const toggleChar = (id: string) => {
    const has = setup.charIds.includes(id);
    let next = has ? setup.charIds.filter((x) => x !== id) : [...setup.charIds, id];
    if (next.length > foeSlots) next = next.slice(-foeSlots); // 超位时挤掉最老的
    onChange({ charIds: next });
  };
  const setSeats = (n: number) => {
    const clamped = Math.max(range.min, Math.min(range.max, n));
    onChange({ seats: clamped, charIds: setup.charIds.slice(0, clamped - 1) });
  };
  return (
    <>
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 z-30 bg-black/30" />
      <div className="absolute inset-x-0 bottom-0 z-40 rounded-t-3xl bg-white px-4 pb-5 pt-3 shadow-2xl">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-bold text-neutral-800">{setup.spec.name} · 开局设置</p>
          <button type="button" onClick={onClose} className="jelly-icon rounded-full p-1.5 text-neutral-400" aria-label="关闭"><X size={16} /></button>
        </div>
        {/* 人数步进 */}
        <div className="mb-3 flex items-center justify-between rounded-2xl bg-neutral-50 px-3 py-2">
          <span className="text-xs text-neutral-500">总人数（含你）· 支持 {range.min}-{range.max} 人</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSeats(setup.seats - 1)} disabled={setup.seats <= range.min}
              className="jelly-icon flex size-7 items-center justify-center rounded-full bg-white text-neutral-600 shadow disabled:opacity-30" aria-label="减一人"><Minus size={14} /></button>
            <span className="w-6 text-center text-base font-bold text-neutral-800">{setup.seats}</span>
            <button type="button" onClick={() => setSeats(setup.seats + 1)} disabled={setup.seats >= range.max}
              className="jelly-icon flex size-7 items-center justify-center rounded-full bg-white text-neutral-600 shadow disabled:opacity-30" aria-label="加一人"><Plus size={14} /></button>
          </div>
        </div>
        {/* 角色多选 */}
        <p className="mb-1.5 text-[11px] text-neutral-400">邀请角色入座（最多 {foeSlots} 位），空位由「小机」人机补齐</p>
        <div className="mb-3 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
          {characters.length === 0 && <span className="text-xs text-neutral-400">还没有角色，本局全部人机陪玩</span>}
          {characters.map((c) => {
            const on = setup.charIds.includes(c.id);
            return (
              <button key={c.id} type="button" onClick={() => toggleChar(c.id)}
                className={`jelly-btn rounded-full px-3 py-1 text-xs ${on ? "bg-rose-400 text-white shadow" : "bg-neutral-100 text-neutral-600"}`}>
                {displayName(c)}
              </button>
            );
          })}
        </div>
        {/* 席位预览 */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] text-rose-500">你</span>
          {Array.from({ length: foeSlots }, (_, i) => {
            const id = setup.charIds[i];
            const c = id ? characters.find((x) => x.id === id) : undefined;
            return c
              ? <span key={i} className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] text-sky-600">{displayName(c)}</span>
              : <span key={i} className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] text-neutral-400">小机 {i + 1}</span>;
          })}
        </div>
        <button type="button" onClick={onConfirm}
          className="jelly-btn w-full rounded-2xl bg-neutral-800 py-2.5 text-sm font-semibold text-white shadow">
          开始对局（{setup.seats} 人）
        </button>
      </div>
    </>
  );
}
