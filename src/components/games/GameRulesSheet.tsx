// 规则卡弹层：玩法名/一句话规则/简化说明公示。
import { X } from "lucide-react";
import type { GameSpec } from "@/lib/games/types";

export function GameRulesSheet({ spec, onClose }: { spec: GameSpec; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-30 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="drawer-panel max-h-[75%] w-full overflow-y-auto rounded-t-3xl bg-[oklch(0.98_0.01_85)] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-neutral-800">{spec.name} · 规则</h3>
          <button type="button" className="jelly-icon rounded-full p-1.5 text-neutral-500" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        <p className="text-sm leading-relaxed text-neutral-700">{spec.ruleSummary}</p>
        <div className="mt-2 flex gap-3 text-[11px] text-neutral-400">
          <span>适合 {spec.players}</span>
          <span>{spec.undoable ? "支持悔棋" : "不支持悔棋"}</span>
          <span>回合上限 {spec.maxTurns}</span>
        </div>
        {spec.simplified && (
          <div className="mt-3 rounded-2xl bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
            {spec.simplified}
          </div>
        )}
      </div>
    </div>
  );
}
