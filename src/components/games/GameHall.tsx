// 双弈游戏大厅：分类 Tab + 玩法卡片网格 + 对手选择 + 继续对局入口。
import { useMemo, useState } from "react";
import { ChevronLeft, Play, Gamepad2 } from "lucide-react";
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
  onStart: (spec: GameSpec) => void;
  onBack: () => void;
}

const CAT_EMOJI: Record<GameCategory, string> = { board: "♟️", card: "🃏", dice: "🎲", table: "🎡" };

export function GameHall({ characters, activeCharId, onPickChar, liveGameId, onResume, onStart, onBack }: Props) {
  const [cat, setCat] = useState<GameCategory>("board");
  const list = useMemo(() => GAME_SPECS.filter((g) => g.category === cat), [cat]);
  const ch = characters.find((c) => c.id === activeCharId) ?? characters[0];

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

      {/* 对手选择 */}
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
          <button key={g.id} type="button" onClick={() => onStart(g)}
            className="glass group relative flex flex-col items-start gap-1 rounded-2xl p-3 text-left transition-shadow hover:shadow-md">
            <div className="flex w-full items-center justify-between">
              <span className="text-sm font-bold text-neutral-800">{g.name}</span>
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">{g.players}</span>
            </div>
            <p className="line-clamp-2 text-[11px] leading-snug text-neutral-500">{g.ruleSummary}</p>
            <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-rose-400 opacity-80 transition-opacity group-hover:opacity-100">
              <Play size={11} /> 开局
            </span>
            {g.simplified && <span className="absolute right-2 top-9 text-[9px] text-amber-500/80">简化规则</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
