// 四种通用渲染视图：grid（棋盘交叉点/方格）、cards（手牌+桌面）、dice（骰子）、panel（桌游面板）。
import type { GView } from "@/lib/games/types";

const TOKEN_STYLE: Record<string, string> = {
  blk: "bg-neutral-900", wht: "bg-white border border-neutral-300",
  me: "bg-rose-400", foe: "bg-sky-400", both: "bg-gradient-to-br from-rose-400 to-sky-400",
  myProp: "bg-rose-200", foeProp: "bg-sky-200", goalA: "bg-amber-100", goalB: "bg-emerald-100", empty: "",
};

export function BoardView({ view, onTap, disabled }: { view: GView; onTap: (r: number, c: number) => void; disabled: boolean }) {
  const rows = view.rows ?? 0, cols = view.cols ?? 0;
  const cellMap = new Map((view.cells ?? []).map((c) => [`${c.r},${c.c}`, c]));
  return (
    <div className="mx-auto w-full max-w-[360px]">
      <div className="glass rounded-2xl p-2 shadow-sm">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
          {Array.from({ length: rows * cols }, (_, i) => {
            const r = Math.floor(i / cols), c = i % cols;
            const cell = cellMap.get(`${r},${c}`);
            const token = cell?.token ?? "";
            const isCross = view.lineStyle === "cross";
            return (
              <button key={i} type="button" disabled={disabled} onClick={() => onTap(r, c)}
                className={`relative flex aspect-square items-center justify-center ${isCross ? "" : "m-[1px] rounded-[4px]"}`}
                aria-label={`格子${r}-${c}`}>
                {!isCross && (cell?.label || token) && (
                  <span className={`absolute inset-0 rounded-[4px] ${TOKEN_STYLE[token] ?? "bg-white/70"}`} />
                )}
                {isCross && (
                  <>
                    {/* 交叉线 */}
                    <span className="absolute left-1/2 top-0 h-full w-px bg-neutral-400/50" style={{ display: r > 0 && r < rows - 1 ? "block" : r === 0 ? "block" : "block", height: r === 0 ? "50%" : r === rows - 1 ? "50%" : "100%", top: r === 0 ? "50%" : r === rows - 1 ? 0 : 0 }} />
                    <span className="absolute top-1/2 left-0 w-full h-px bg-neutral-400/50" style={{ width: c === 0 ? "50%" : c === cols - 1 ? "50%" : "100%", left: c === 0 ? "50%" : 0 }} />
                  </>
                )}
                {isCross && token && (
                  <span className={`relative z-10 flex h-[86%] w-[86%] items-center justify-center rounded-full text-[10px] font-bold shadow ${TOKEN_STYLE[token] ?? "bg-neutral-700 text-white"}`}>{token}</span>
                )}
                {!isCross && cell?.label && (
                  <span className="relative z-10 px-0.5 text-center leading-tight text-[8px] font-medium text-neutral-700 line-clamp-2">{cell.label}</span>
                )}
                {cell?.hint && <span className="absolute inset-[18%] z-20 rounded-full ring-2 ring-emerald-400/70" />}
                {cell?.sel && <span className="absolute inset-[10%] z-20 rounded-md ring-2 ring-rose-400" />}
              </button>
            );
          })}
        </div>
      </div>
      {view.notes?.map((n, i) => <p key={i} className="mt-1.5 text-center text-[11px] text-neutral-500">{n}</p>)}
    </div>
  );
}

const SUIT_COLOR: Record<string, string> = { "0": "text-neutral-900", "1": "text-red-500", "2": "text-neutral-700", "3": "text-red-400", back: "" };

export function CardView({ view, meName, nameOf }: { view: GView; meName: string; nameOf: (seat: number) => string }) {
  const hands = view.hands ?? [];
  const me = hands.find((h) => h.seat === 0);
  const foes = hands.filter((h) => h.seat !== 0);
  return (
    <div className="mx-auto flex w-full max-w-[380px] flex-col gap-2">
      {/* 对手手牌（可多席） */}
      {foes.map((f) => (
        <div key={f.seat} className="glass rounded-2xl px-3 py-2">
          <p className="mb-1 text-[11px] text-neutral-500">{nameOf(f.seat)} · {f.cards.length} 张</p>
          <div className="flex gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {f.cards.slice(0, 20).map((c) => (
              <MiniCard key={c.id} token={c.token} label={c.label} small />
            ))}
          </div>
        </div>
      ))}
      {/* 桌面 */}
      <div className="rounded-2xl border border-dashed border-neutral-300/70 bg-white/40 px-3 py-2">
        <p className="mb-1 text-[11px] text-neutral-400">桌面 / 牌河</p>
        <div className="flex min-h-[44px] flex-wrap items-center gap-1">
          {(view.tableCards ?? []).length ? (view.tableCards ?? []).map((c) => <MiniCard key={c.id} token={c.token} label={c.label} />) : <span className="text-xs text-neutral-300">空</span>}
        </div>
      </div>
      {/* 我的手牌 */}
      <div className="glass-strong rounded-2xl px-3 py-2">
        <p className="mb-1 text-[11px] text-neutral-500">{meName} · {me?.cards.length ?? 0} 张</p>
        <div className="flex flex-wrap gap-1">
          {(me?.cards ?? []).map((c) => <MiniCard key={c.id} token={c.token} label={c.label} />)}
        </div>
      </div>
      {view.notes?.map((n, i) => <p key={i} className="text-center text-[11px] text-neutral-500">{n}</p>)}
    </div>
  );
}

function MiniCard({ token, label, small }: { token: string; label: string; small?: boolean }) {
  if (token === "back") {
    return <span className={`${small ? "h-8 w-6 text-[9px]" : "h-11 w-8 text-xs"} flex items-center justify-center rounded-md bg-gradient-to-br from-indigo-400 to-violet-500 text-white shadow-sm`}>🂠</span>;
  }
  const color = SUIT_COLOR[token] ?? "text-neutral-800";
  return (
    <span className={`${small ? "h-8 w-6 text-[9px]" : "h-11 w-8 text-[11px]"} flex items-center justify-center rounded-md border border-neutral-200 bg-white font-semibold shadow-sm ${color}`}>
      {label || "?"}
    </span>
  );
}

const DICE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

export function DiceView({ view, foeName }: { view: GView; foeName: string }) {
  return (
    <div className="mx-auto flex w-full max-w-[360px] flex-col items-center gap-3 pt-4">
      <div className="glass-strong flex gap-2 rounded-3xl px-6 py-5 shadow-inner">
        {(view.dice ?? []).map((d, i) => (
          <span key={i} className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-4xl text-neutral-800 shadow">{DICE_FACES[d - 1] ?? d}</span>
        ))}
        {!view.dice?.length && <span className="text-sm text-neutral-400">等待掷骰…</span>}
      </div>
      {view.diceCup && (
        <div className="flex items-center gap-2 rounded-2xl bg-neutral-700/80 px-4 py-2 text-white">
          <span className="text-xs opacity-70">{foeName} 的骰盅</span>
          <span className="text-2xl tracking-widest">🎲 {view.diceCup}</span>
        </div>
      )}
      {view.notes?.map((n, i) => <p key={i} className="w-full text-center text-[11px] text-neutral-500">{n}</p>)}
    </div>
  );
}

export function PanelView({ view, nameOf }: { view: GView; nameOf?: (seat: number) => string }) {
  return (
    <div className="mx-auto flex w-full max-w-[360px] flex-col gap-2">
      {(view.panels ?? []).map((p) => (
        <div key={p.seat} className={`glass rounded-2xl px-3 py-2 ${p.seat === 0 ? "border-l-4 border-rose-300" : "border-l-4 border-sky-300"}`}>
          <p className="text-xs font-semibold text-neutral-700">{nameOf && !/^\d/.test(p.title) && p.seat !== 0 ? `${p.title} · ${nameOf(p.seat)}` : p.title}</p>
          {p.lines.map((l, i) => <p key={i} className="mt-0.5 text-[11px] text-neutral-500">{l}</p>)}
        </div>
      ))}
      {view.dice && view.dice.length > 0 && (
        <div className="flex justify-center gap-1.5">
          {view.dice.map((d, i) => <span key={i} className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-2xl shadow">{DICE_FACES[d - 1] ?? d}</span>)}
        </div>
      )}
      {view.notes?.map((n, i) => <p key={i} className="text-center text-[11px] text-neutral-500">{n}</p>)}
    </div>
  );
}
