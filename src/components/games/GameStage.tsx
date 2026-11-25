// 通用对局壳：只依赖 GameSpec，负责多座位 AI 调度、悔棋、提和认输、终局播报与续局。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Undo2, Flag, Handshake, RotateCcw } from "lucide-react";
import type { AiConfig } from "@/lib/types";
import type { GameSpec, GAction } from "@/lib/games/types";
import { makeRng } from "@/lib/games/types";
import { BoardView, CardView, DiceView, PanelView } from "./GameViews";
import { GameRulesSheet } from "./GameRulesSheet";

/** seat≥1 的对手席位：charId 为空即人机「小机 N」 */
export interface OpponentSeat {
  seat: number;
  name: string;
  charId?: string;
}

interface Props {
  spec: GameSpec;
  opponents: OpponentSeat[];
  config: AiConfig;
  initial?: unknown;
  /** 终局/退出回调；seatResults=各真实角色席位的胜负（相对该角色），人机位不含 */
  onExit: (finalState: unknown | null, result: "ongoing" | "win" | "lose" | "draw", seatResults?: { charId: string; result: "win" | "lose" | "draw" }[]) => void;
  /** 每回合结束回调（供上层记日志） */
  onTurnEnd?: (plies: number) => void;
}

const AI_DELAY = 700;

export function GameStage({ spec, opponents, config, initial, onExit, onTurnEnd }: Props) {
  void config;
  const seats = 1 + opponents.length;
  const [state, setState] = useState(() => {
    if (initial != null) {
      const restored = spec.deserialize(initial);
      if (restored) return restored;
    }
    return spec.create(seats, makeRng(Date.now() >>> 0));
  });
  const history = useRef<unknown[]>([]);
  const [selected, setSelected] = useState<GAction | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [toast, setToast] = useState("");
  const aiTimer = useRef<number | undefined>(undefined);
  /** 各真实角色席位的结果（相对该角色自己）；玩家视角整体结果作兜底 */
  const seatResults = (playerResult: "win" | "lose" | "draw"): { charId: string; result: "win" | "lose" | "draw" }[] => {
    const out: { charId: string; result: "win" | "lose" | "draw" }[] = [];
    for (const o of opponents) {
      if (!o.charId) continue;
      let r: "win" | "lose" | "draw";
      const mine = spec.resultFor(state, o.seat);
      if (mine === "ongoing") {
        // 认输/求和等壳层终局：spec 没写名次时按玩家结果镜像
        r = playerResult === "draw" ? "draw" : playerResult === "win" ? "lose" : "win";
      } else {
        r = mine;
      }
      out.push({ charId: o.charId, result: r });
    }
    return out;
  };

  const turn = spec.turnOf(state);
  const status = spec.status(state);
  const over = status === "over";
  const myTurn = !over && turn === 0;
  const acts = useMemo(() => (myTurn ? spec.legalActions(state) : []), [spec, state, myTurn]);
  // 棋类点选式：grid 且动作带坐标时隐藏按钮条，直接点棋盘
  const view = useMemo(() => spec.view(state, selected, acts), [spec, state, selected, acts]);
  const clickBoard = view.kind === "grid";
  const foeNameOf = (seat: number) => opponents.find((o) => o.seat === seat)?.name ?? `小机 ${seat}`;
  const thinkingName = over ? "" : foeNameOf(turn);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  // AI 回合：任意非 0 座位都走 aiMove，逐个接力
  useEffect(() => {
    if (over || turn === 0) return;
    aiTimer.current = window.setTimeout(() => {
      const mv = spec.aiMove(state);
      if (!mv) { finishIfStuck(); return; }
      const nx = spec.apply(state, mv);
      if (!nx) { finishIfStuck(); return; }
      history.current.push(spec.serialize(state));
      if (history.current.length > 60) history.current.shift();
      setState(nx);
      onTurnEnd?.(nx.plies ?? 0);
    }, AI_DELAY);
    return () => window.clearTimeout(aiTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, over, turn]);

  const finishIfStuck = useCallback(() => {
    setToast("对手没有可走的棋了，本局结束");
    window.setTimeout(() => onExit(null, "draw"), 900);
    // eslint-disable-next-line react-hooks/exhaustive-refs-deps
  }, []);

  const doAction = useCallback((a: GAction) => {
    if (!myTurn) return;
    // grid 玩法两步走：先选中再落子（象棋/军棋等有 from/to 的）
    if (clickBoard && a.from && a.to && !selected) { setSelected(a); return; }
    const nx = spec.apply(state, a);
    if (!nx) { setToast("这步不合法"); return; }
    setSelected(null);
    history.current.push(spec.serialize(state));
    if (history.current.length > 60) history.current.shift();
    setState(nx);
    onTurnEnd?.(nx.plies ?? 0);
  }, [myTurn, clickBoard, selected, spec, state, onTurnEnd]);

  // grid 点击：把 (r,c) 映射到合法动作
  const onCellTap = useCallback((r: number, c: number) => {
    if (!myTurn) return;
    if (selected) {
      const hit = acts.find((a) => a.from?.r === selected.from?.r && a.from?.c === selected.from?.c && a.to?.r === r && a.to?.c === c);
      if (hit) { doDirect(hit); return; }
      const reselect = acts.find((a) => a.from?.r === r && a.from?.c === c && a.to);
      setSelected(reselect ?? null);
      if (!reselect) { const put = acts.find((a) => (a.n !== undefined || a.to) && !a.from && cellMatch(a, r, c, view.kind === "grid" ? view.cols ?? 15 : 15)); if (put) doDirect(put); }
      return;
    }
    const boardCols = view.kind === "grid" ? view.cols ?? 15 : 15;
    const put = acts.find((a) => cellMatch(a, r, c, boardCols));
    if (!put) return;
    if (put.to || (put.from && acts.some((x) => x !== put && x.from && (x.from.r !== put.from!.r || x.from.c !== put.from!.c)))) {
      // 有落点含义的直接执行；纯"选中源"的先选中
      const isSourceOnly = acts.filter((a) => a.from?.r === put.from?.r && a.from?.c === put.from?.c).length > 1;
      if (isSourceOnly && !put.to) { setSelected(put); return; }
    }
    doDirect(put);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTurn, selected, acts]);

  const doDirect = (a: GAction) => {
    const nx = spec.apply(state, a);
    if (!nx) { setToast("这步不合法"); return; }
    setSelected(null);
    history.current.push(spec.serialize(state));
    if (history.current.length > 60) history.current.shift();
    setState(nx);
    onTurnEnd?.(nx.plies ?? 0);
  };

  const undo = () => {
    if (!spec.undoable || !history.current.length) return;
    // 回退到上一个玩家局面（可能跨多个 AI 手）
    let snap: unknown | undefined;
    while (history.current.length) {
      snap = history.current.pop();
      const st = spec.deserialize(snap);
      if (st && spec.turnOf(st) === 0) break;
      snap = undefined;
    }
    const st = spec.deserialize(snap);
    if (st) { setState(st); setSelected(null); setToast("已悔棋"); }
  };

  const askDraw = () => {
    const accept = spec.acceptDraw ? spec.acceptDraw(state) : false;
    if (accept) { setToast(`${thinkingName || opponents[0]?.name} 同意了求和`); window.setTimeout(() => onExit(spec.serialize(state), "draw", seatResults("draw")), 800); }
    else {
      setToast(`${opponents[0]?.name ?? "对手"}：“这才刚开始，和什么和？”`);
      // 被拒后对手继续走
      const mv = spec.aiMove(state);
      if (mv) { const nx = spec.apply(state, mv); if (nx) setState(nx); }
    }
  };

  const resign = () => {
    setToast("你投子认负");
    window.setTimeout(() => onExit(spec.serialize(state), "lose", seatResults("lose")), 700);
  };

  const restart = () => {
    history.current = [];
    setSelected(null);
    setState(spec.create(seats, makeRng(Date.now() >>> 0)));
    setToast("重新开局");
  };

  // 终局
  useEffect(() => {
    if (!over) return;
    const res = spec.resultFor(state, 0);
    const first = opponents[0]?.name ?? "对手";
    const line = res === "ongoing" ? "本局结束" : res === "win" ? "你赢了！" : res === "lose" ? `${first} 赢了这局` : "平局";
    setToast(line);
    const t = window.setTimeout(() => onExit(spec.serialize(state), res === "ongoing" ? "draw" : res, seatResults(res === "ongoing" ? "draw" : res)), 1400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over]);

  const hintActs = selected ? acts.filter((a) => a.from?.r === selected.from?.r && a.from?.c === selected.from?.c && a.to) : acts;

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-[oklch(0.97_0.015_85)] to-[oklch(0.94_0.02_75)]">
      {/* 顶栏 */}
      <div className="glass-nav flex items-center gap-2 px-3 py-2">
        <button type="button" className="jelly-icon rounded-full p-1.5 text-neutral-600" onClick={() => onExit(spec.serialize(state), "ongoing")} aria-label="退出对局">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-neutral-800">{spec.name}{seats > 2 ? ` · ${seats}人` : ""}</p>
          <p className="truncate text-[11px] text-neutral-500">
            {over ? "对局结束" : myTurn ? "轮到你出手" : `${thinkingName} 思考中…`} · 第{Math.floor(((state as { plies?: number }).plies ?? 0) / seats) + 1}回合
          </p>
        </div>
        <button type="button" className="jelly-icon rounded-full p-1.5 text-neutral-500" onClick={() => setRulesOpen(true)} aria-label="规则"><BookOpen size={16} /></button>
        <button type="button" className="jelly-icon rounded-full p-1.5 text-neutral-500 disabled:opacity-30" onClick={restart} aria-label="重新开局"><RotateCcw size={16} /></button>
      </div>

      {/* 局面区 */}
      <div className="relative flex-1 overflow-y-auto px-3 py-2">
        {view.kind === "grid" && <BoardView view={view} onTap={onCellTap} disabled={!myTurn} />}
        {view.kind === "cards" && <CardView view={view} meName="你" nameOf={foeNameOf} />}
        {view.kind === "dice" && <DiceView view={view} foeName={opponents[0]?.name ?? "对手"} />}
        {view.kind === "panel" && <PanelView view={view} nameOf={foeNameOf} />}
        {toast && (
          <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center px-6">
            <span className="glass-strong max-w-full truncate rounded-full px-3 py-1.5 text-xs text-neutral-700 shadow-lg">{toast}</span>
          </div>
        )}
      </div>

      {/* 操作区 */}
      {!over && (
        <div className="border-t border-white/60 bg-white/50 px-3 pb-3 pt-2 backdrop-blur-md">
          {clickBoard && selected && (
            <p className="mb-1.5 text-[11px] text-neutral-500">已选中 ({selected.from?.r},{selected.from?.c})，再点目标位置落子；点空白取消</p>
          )}
          <div className="flex gap-1.5 overflow-x-auto pb-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(clickBoard ? hintActs.filter((a) => a.to).slice(0, 12) : acts.slice(0, 16)).map((a, i) => (
              <button key={`${a.kind}-${i}`} type="button" disabled={!myTurn} onClick={() => doAction(a)}
                className={`jelly-btn shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${clickBoard && a.to ? "bg-primary/15 text-primary" : "bg-white/80 text-neutral-700"} disabled:opacity-40`}>
                {a.label ?? a.kind}
              </button>
            ))}
            {!clickBoard && !acts.length && myTurn && <span className="text-xs text-neutral-400">等待局面…</span>}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500">
            {spec.undoable && (
              <button type="button" onClick={undo} disabled={!myTurn || !history.current.length} className="flex items-center gap-1 rounded-full bg-white/60 px-2.5 py-1 disabled:opacity-35">
                <Undo2 size={12} /> 悔棋
              </button>
            )}
            <button type="button" onClick={askDraw} disabled={!myTurn} className="flex items-center gap-1 rounded-full bg-white/60 px-2.5 py-1 disabled:opacity-35">
              <Handshake size={12} /> 求和
            </button>
            <button type="button" onClick={resign} disabled={!myTurn} className="flex items-center gap-1 rounded-full bg-white/60 px-2.5 py-1 text-red-400 disabled:opacity-35">
              <Flag size={12} /> 认输
            </button>
          </div>
        </div>
      )}

      {rulesOpen && <GameRulesSheet spec={spec} onClose={() => setRulesOpen(false)} />}
    </div>
  );
}

/** 把格子坐标映射到动作：支持 n(索引)/from/to 三种定位 */
function cellMatch(a: GAction, r: number, c: number, cols = 15): boolean {
  if (a.from && a.from.r === r && a.from.c === c) return true;
  if (a.to && !a.from && a.to.r === r && a.to.c === c) return true;
  // 单点落子玩法（五子棋/井字/四子连珠等）：动作用 n=行*cols+列 索引定位，此前漏判导致点棋盘无反应
  if (a.n !== undefined && !a.from && !a.to) return Math.floor(a.n / cols) === r && a.n % cols === c;
  return false;
}
