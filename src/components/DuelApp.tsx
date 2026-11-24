// 双弈对局全屏页：五子棋 + 中国象棋，和 TA 下棋（内置引擎，不依赖外部服务）
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, RotateCcw, Hand, Flag, Swords, CircleDot } from "lucide-react";
import type { AiConfig } from "@/lib/types";
import type { Character, ChatEntry } from "@/lib/chat-types";
import { useCharacters } from "@/lib/chat-store";
import {
  GOMO_N,
  gomokuCreate,
  gomokuAiMove,
  gomokuDeserialize,
  gomokuFull,
  gomokuSerialize,
  gomokuWin,
  xiangqiAiMove,
  xiangqiApply,
  xiangqiClone,
  xiangqiCreate,
  xiangqiInCheck,
  xiangqiLegalMoves,
  xiangqiStatus,
  type DuelGame,
  type GomokuBoard,
  type Pt,
  type XState,
} from "@/lib/duel-engine";
import { bumpStats, isLiveValid, recordDuel, useDuelLive, useDuelStats, type DuelRecord } from "@/lib/duel-store";

interface Props {
  config: AiConfig;
  charId?: string;
  game?: DuelGame;
  onBack: () => void;
  /** 终局回调：角色在聊天里发感想 */
  onFinish?: (charId: string, result: "win" | "lose" | "draw", gameName: string) => void;
}

type Result = "win" | "lose" | "draw" | "declined" | null;

const GAME_NAME: Record<DuelGame, string> = { gomoku: "五子棋", xiangqi: "中国象棋" };

export function DuelApp({ config, charId, game, onBack, onFinish }: Props) {
  const [characters] = useCharacters();
  const [live, setLive] = useDuelLive();
  const [stats, setStats] = useDuelStats();

  // 开局选择：无 charId/game 参数时先选对手与棋种
  const [pickChar, setPickChar] = useState<string>(charId || characters[0]?.id || "");
  const [pickGame, setPickGame] = useState<DuelGame>(game || "gomoku");
  const started = Boolean(charId && game);

  if (!started) {
    return <DuelPicker characters={characters} pickChar={pickChar} setPickChar={setPickChar} pickGame={pickGame} setPickGame={setPickGame} live={live} onBack={onBack} config={{ baseUrl: "", apiKey: "", model: "" }} />;
  }
  const ch = characters.find((c) => c.id === charId);
  if (!ch) {
    return <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">角色不存在</div>;
  }
  return <DuelBoard key={`${charId}:${game}`} ch={ch} game={game!} live={live} setLive={setLive} stats={stats} setStats={setStats} onFinish={onFinish} onBack={onBack} />;
}

/* ---------- 选择器 ---------- */

function DuelPicker({
  characters,
  pickChar,
  setPickChar,
  pickGame,
  setPickGame,
  live,
  onBack,
  config,
}: {
  characters: Character[];
  pickChar: string;
  setPickChar: (v: string) => void;
  pickGame: DuelGame;
  setPickGame: (v: DuelGame) => void;
  live: Record<string, DuelRecord>;
  onBack: () => void;
  config: AiConfig;
}) {
  const [go, setGo] = useState<{ charId: string; game: DuelGame } | null>(null);
  if (go) return <DuelApp config={config} charId={go.charId} game={go.game} onBack={onBack} />;
  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-amber-50 to-orange-50">
      <header className="glass-nav flex items-center gap-2 px-3 pb-2 pt-9">
        <button type="button" onClick={onBack} className="jelly-icon p-1.5 text-neutral-700">
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="text-[15px] font-bold text-neutral-800">双弈 · 和 TA 下棋</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">选一个对手和棋盘。棋局会保存，中途退出随时回来接着下。</p>
        <div className="mb-4 grid grid-cols-2 gap-2.5">
          {(["gomoku", "xiangqi"] as DuelGame[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setPickGame(g)}
              className={`jelly-btn rounded-2xl border p-3 text-left transition-colors ${pickGame === g ? "border-primary/60 bg-white shadow-sm" : "border-transparent bg-white/60"}`}
            >
              {g === "gomoku" ? <CircleDot className="mb-1 size-4 text-neutral-600" /> : <Swords className="mb-1 size-4 text-neutral-600" />}
              <p className="text-[13px] font-bold text-neutral-800">{GAME_NAME[g]}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{g === "gomoku" ? "黑先，连五即胜" : "红先，将死为胜"}</p>
            </button>
          ))}
        </div>
        <p className="mb-2 text-[12px] font-semibold text-neutral-700">选择对手</p>
        <ul className="space-y-2">
          {characters.map((c) => {
            const resuming = live[c.id] && isLiveValid(live[c.id]) && live[c.id].game === pickGame;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setGo({ charId: c.id, game: pickGame })}
                  className="jelly-btn flex w-full items-center gap-3 rounded-2xl bg-white/80 p-2.5 text-left hover:bg-white"
                >
                  <img src={c.avatar} alt="" className="size-11 shrink-0 rounded-xl object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-neutral-800">{c.name}</span>
                    <span className="block text-[10px] text-muted-foreground">{resuming ? "有进行中的一局，点击继续" : "发起新对局"}</span>
                  </span>
                  {resuming && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[9.5px] font-semibold text-primary">续局</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* ---------- 对局主体 ---------- */

function DuelBoard({
  ch,
  game,
  live,
  setLive,
  stats,
  setStats,
  onFinish,
  onBack,
}: {
  ch: Character;
  game: DuelGame;
  live: Record<string, DuelRecord>;
  setLive: (updater: (prev: Record<string, DuelRecord>) => Record<string, DuelRecord>) => void;
  stats: Record<string, { win: number; lose: number; draw: number; streakLose: number; streakWin: number }>;
  setStats: (updater: (prev: typeof stats) => typeof stats) => void;
  onFinish?: (charId: string, result: "win" | "lose" | "draw", gameName: string) => void;
  onBack: () => void;
}) {
  const existing = live[ch.id];
  const valid = existing && isLiveValid(existing) && existing.game === game;

  const [gBoard, setGBoard] = useState<GomokuBoard>(() => (valid && existing.gomoku ? gomokuDeserialize(existing.gomoku) : gomokuCreate()));
  const [gTurnBlack, setGTurnBlack] = useState<boolean>(() => {
    if (!valid || !existing.gomoku) return true;
    let black = 0;
    let white = 0;
    for (const v of existing.gomoku) {
      if (v === 1) black++;
      if (v === 2) white++;
    }
    return black <= white; // 手数相等 → 轮到黑(玩家)
  });
  const [xq, setXq] = useState<XState>(() => (valid && existing.xq ? existing.xq : xiangqiCreate()));
  const [history, setHistory] = useState<{ g?: GomokuBoard; x?: XState }[]>([]);
  const [undoLeft, setUndoLeft] = useState(3);
  const [selected, setSelected] = useState<Pt | null>(null);
  const [thinking, setThinking] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [resultText, setResultText] = useState("");
  const aiTimer = useRef<number | null>(null);

  const myTurn = game === "gomoku" ? gTurnBlack : xq.turn === "r";
  const inCheck = game === "xiangqi" && !result && xiangqiInCheck(xq, "r");

  const legalTargets = useMemo<Pt[]>(() => {
    if (!selected || result || !myTurn) return [];
    if (game === "gomoku") return gBoard[selected.r * GOMO_N + selected.c] === 0 ? [selected] : [];
    return xiangqiLegalMoves(xq, selected.r, selected.c);
  }, [selected, game, gBoard, xq, myTurn, result]);

  const finish = useCallback(
    (res: "win" | "lose" | "draw", text: string) => {
      setResult(res);
      setResultText(text);
      setStats((prev) => bumpStats(prev, ch.id, res));
      setLive((prev) => {
        const next = { ...prev };
        delete next[ch.id];
        return next;
      });
      recordDuel(ch.id, game, res);
      console.log(`[duel] end ${game} char=${ch.id} result=${res}`);
      onFinish?.(ch.id, res, GAME_NAME[game]);
    },
    [ch.id, game, onFinish, setLive, setStats],
  );

  // 中途退出：有局面就算"下过但没下完"，写进记忆（角色会记得这盘悬着的棋）
  const exitWithPending = useCallback(() => {
    const played = game === "gomoku" ? history.length > 0 : xq.last != null;
    if (!result && played) recordDuel(ch.id, game, "ongoing");
    onBack();
  }, [ch.id, game, history.length, xq.last, result, onBack]);

  // 持久化当前局面
  const persist = useCallback(
    (patch: Partial<DuelRecord>) => {
      setLive((prev) => ({
        ...prev,
        [ch.id]: { ...(prev[ch.id] ?? { game, charId: ch.id, startedAt: Date.now(), moveCount: 0, turn: "r" as const }), ...patch } as DuelRecord,
      }));
    },
    [ch.id, game, setLive],
  );

  /* AI 应招 */
  useEffect(() => {
    if (result) return;
    const needAi = game === "gomoku" ? !gTurnBlack : xq.turn === "b";
    if (!needAi) return;
    setThinking(true);
    const delay = 700 + Math.random() * 1300;
    aiTimer.current = window.setTimeout(() => {
      if (game === "gomoku") {
        const mv = gomokuAiMove(gBoard);
        if (mv) {
          const nb = gomokuCreate();
          nb.set(gBoard);
          nb[mv.r * GOMO_N + mv.c] = 2;
          setGBoard(nb);
          persist({ gomoku: gomokuSerialize(nb), turn: "r", moveCount: (live[ch.id]?.moveCount ?? 0) + 1 });
          if (gomokuWin(nb, mv.r, mv.c)) finish("lose", `${ch.name} 连成了五子，你输了`);
          else if (gomokuFull(nb)) finish("draw", "棋盘下满了，平局");
        }
      } else {
        const mv = xiangqiAiMove(xq);
        if (mv) {
          const nx = xiangqiApply(xq, mv.from, mv.to)!;
          setXq(nx);
          persist({ xq: nx, turn: "b", moveCount: (live[ch.id]?.moveCount ?? 0) + 1 });
          const st = xiangqiStatus(nx);
          if (st === "checkmate") finish("lose", `被${ch.name}将死了`);
          else if (st === "stalemate") finish("lose", "困毙——无路可走算输");
          else if (st === "draw") finish("draw", "60 回合未吃子，判和");
        }
      }
      setThinking(false);
    }, delay);
    return () => {
      if (aiTimer.current) clearTimeout(aiTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gTurnBlack, xq.turn, result, game]);

  /* 玩家落子 */
  const playGomoku = (r: number, c: number) => {
    if (gBoard[r * GOMO_N + c] !== 0 || !gTurnBlack || result) return;
    setHistory((h) => [...h.slice(-6), { g: (() => { const cp = gomokuCreate(); cp.set(gBoard); return cp; })() }]);
    const nb = gomokuCreate();
    nb.set(gBoard);
    nb[r * GOMO_N + c] = 1;
    setGBoard(nb);
    setGTurnBlack(false);
    persist({ gomoku: gomokuSerialize(nb), turn: "b", moveCount: (live[ch.id]?.moveCount ?? 0) + 1 });
    if (gomokuWin(nb, r, c)) finish("win", "五子连珠，你赢了！");
    else if (gomokuFull(nb)) finish("draw", "棋盘下满了，平局");
  };

  const playXiangqi = (to: Pt) => {
    if (!selected || result) return;
    const nx = xiangqiApply(xq, selected, to);
    if (!nx) return;
    setHistory((h) => [...h.slice(-6), { x: xiangqiClone(xq) }]);
    setXq(nx);
    setSelected(null);
    persist({ xq: nx, turn: "b", moveCount: (live[ch.id]?.moveCount ?? 0) + 1 });
    const st = xiangqiStatus(nx);
    if (st === "checkmate") finish("win", `将死！${ch.name} 认输了`);
    else if (st === "stalemate") finish("win", "困毙——TA 无路可走");
    else if (st === "draw") finish("draw", "60 回合未吃子，判和");
  };

  const tapCell = (r: number, c: number) => {
    if (result || !myTurn) return;
    if (game === "gomoku") {
      playGomoku(r, c);
      return;
    }
    const p = xq.board[r][c];
    if (selected && legalTargets.some((m) => m.r === r && m.c === c)) {
      playXiangqi({ r, c });
      return;
    }
    if (p && p[0] === "r") {
      setSelected({ r, c });
      return;
    }
    setSelected(null);
  };

  /* 悔棋：撤销最近两手（AI+玩家各一） */
  const undo = () => {
    if (undoLeft <= 0 || history.length === 0 || thinking || result) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setUndoLeft((n) => n - 1);
    if (game === "gomoku" && last.g) {
      setGBoard(last.g);
      setGTurnBlack(true);
      persist({ gomoku: gomokuSerialize(last.g), turn: "r" });
    } else if (game === "xiangqi" && last.x) {
      setXq(last.x);
      persist({ xq: last.x, turn: "r" });
    }
    setSelected(null);
    console.log(`[duel] undo ${game} left=${undoLeft - 1}`);
  };

  const resign = () => finish("lose", "你认输了");
  const offerDraw = () => {
    // 角色按局势决定：大优拒绝、均势接受
    const edge = game === "xiangqi" ? materialEdge(xq) : 0;
    if (edge > 150) {
      setResultText(`${ch.name} 冷笑一声："想得美，认输吧。"`);
      setResult("declined");
      setTimeout(() => setResult(null), 2200);
    } else {
      finish("draw", `${ch.name} 同意了和棋`);
    }
  };
  const restart = () => {
    // 终局卡上点"再来一局"时旧局已记过；未终局直接重开（顶栏重开钮）则把上一局记为中途退出
    if (!result && (game === "gomoku" ? history.length > 0 : xq.last != null)) recordDuel(ch.id, game, "ongoing");
    if (game === "gomoku") {
      setGBoard(gomokuCreate());
      setGTurnBlack(true);
    } else setXq(xiangqiCreate());
    setHistory([]);
    setUndoLeft(3);
    setResult(null);
    setSelected(null);
    persist(game === "gomoku" ? { gomoku: gomokuSerialize(gomokuCreate()), turn: "r", moveCount: 0 } : { xq: xiangqiCreate(), turn: "r", moveCount: 0 });
    console.log(`[duel] restart ${game} char=${ch.id}`);
  };

  const s = stats[ch.id];
  const statusLine = result
    ? resultText
    : thinking
      ? `${ch.name} 在琢磨…`
      : myTurn
        ? game === "gomoku"
          ? "轮到你落黑子"
          : inCheck
            ? "将军！快救驾"
            : "轮到你走棋"
        : "等 TA 出手";

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-amber-50 to-orange-50">
      <header className="glass-nav flex items-center gap-2 px-3 pb-2 pt-9">
        <button type="button" onClick={exitWithPending} className="jelly-icon p-1.5 text-neutral-700">
          <ArrowLeft className="size-5" />
        </button>
        <img src={ch.avatar} alt="" className="size-7 rounded-lg object-cover" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold text-neutral-800">{GAME_NAME[game]} · vs {ch.name}</p>
          {s && <p className="text-[9.5px] text-muted-foreground">战绩 {s.win}胜 {s.lose}负 {s.draw}和</p>}
        </div>
        <button type="button" onClick={restart} aria-label="重开" className="jelly-icon p-1.5 text-neutral-600">
          <RotateCcw className="size-4.5" />
        </button>
      </header>

      {/* 状态条 */}
      <div className="px-4 py-2">
        <p className={`text-center text-[11.5px] font-semibold ${result ? "text-primary" : inCheck && !result ? "text-rose-600" : "text-neutral-600"}`}>{statusLine}</p>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-2">
        {game === "gomoku" ? <GomokuView board={gBoard} onTap={tapCell} disabled={!myTurn || !!result} /> : <XiangqiView st={xq} selected={selected} targets={legalTargets} onTap={tapCell} disabled={!myTurn || !!result} name={ch.name} />}
      </div>

      {/* 底部操作 */}
      <footer className="flex items-center justify-center gap-2 px-4 pb-8 pt-2">
        <button type="button" onClick={undo} disabled={undoLeft <= 0 || thinking || !!result || history.length === 0} className="jelly-btn flex items-center gap-1 rounded-full bg-white px-3.5 py-1.5 text-[11px] font-semibold text-neutral-700 shadow-sm disabled:opacity-40">
          <Hand className="size-3.5" /> 悔棋({undoLeft})
        </button>
        <button type="button" onClick={offerDraw} disabled={thinking || !!result} className="jelly-btn flex items-center gap-1 rounded-full bg-white px-3.5 py-1.5 text-[11px] font-semibold text-neutral-700 shadow-sm disabled:opacity-40">
          <Hand className="size-3.5" /> 提和
        </button>
        <button type="button" onClick={resign} disabled={thinking || !!result} className="jelly-btn flex items-center gap-1 rounded-full bg-white px-3.5 py-1.5 text-[11px] font-semibold text-rose-500 shadow-sm disabled:opacity-40">
          <Flag className="size-3.5" /> 认输
        </button>
      </footer>

      {/* 终局结果卡 */}
      {result && result !== "declined" && (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/40 p-6">
          <div className="drawer-panel w-full max-w-[300px] rounded-3xl bg-white p-5 text-center shadow-xl">
            <p className="text-[22px] font-black text-neutral-800">{result === "win" ? "你赢了 🎉" : result === "lose" ? "你输了" : "和棋"}</p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">{resultText}</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={onBack} className="jelly-btn flex-1 rounded-full bg-neutral-100 py-2 text-[12px] font-semibold text-neutral-700">回聊天</button>
              <button type="button" onClick={restart} className="jelly-btn flex-1 rounded-full bg-primary py-2 text-[12px] font-semibold text-primary-foreground">再来一局</button>
            </div>
          </div>
        </div>
      )}
      {result === "declined" && (
        <div className="notify-banner absolute inset-x-6 top-24 z-[80]">
          <div className="glass-strong rounded-2xl p-3 text-center text-[11.5px] font-semibold text-neutral-700 shadow-lg">{resultText}</div>
        </div>
      )}
    </div>
  );
}

function materialEdge(st: XState): number {
  const VAL: Record<string, number> = { 车: 900, 马: 400, 炮: 450, 兵: 100, 卒: 100, 士: 200, 相: 200, 象: 200 };
  let s = 0;
  for (const row of st.board) for (const p of row) if (p && VAL[p[1]]) s += p[0] === "r" ? VAL[p[1]] : -VAL[p[1]];
  return s;
}

/* ---------- 五子棋视图（SVG 网格 + 绝对定位棋子） ---------- */

function GomokuView({ board, onTap, disabled }: { board: GomokuBoard; onTap: (r: number, c: number) => void; disabled: boolean }) {
  const N = GOMO_N;
  const cell = 100 / (N + 1);
  return (
    <div className="relative aspect-square w-full max-w-[min(100%,420px)] rounded-2xl bg-[#f3ddb0] shadow-inner ring-1 ring-amber-900/10">
      <svg viewBox={`0 0 ${N + 1} ${N + 1}`} className="absolute inset-0 h-full w-full">
        {Array.from({ length: N }, (_, i) => (
          <g key={i} stroke="#8a6b3f" strokeWidth="0.045">
            <line x1={1 + cell} y1={1 + i} x2={N} y2={1 + i} />
            <line x1={1 + i} y1={1 + cell} x2={1 + i} y2={N} />
          </g>
        ))}
        {[3, 7, 11].map((r) => [3, 7, 11].map((c) => <circle key={`${r}-${c}`} cx={1 + c} cy={1 + r} r={0.12} fill="#8a6b3f" />))}
      </svg>
      {Array.from({ length: N * N }, (_, i) => {
        const r = Math.floor(i / N);
        const c = i % N;
        const v = board[i];
        return (
          <button
            key={i}
            type="button"
            aria-label={`第${r + 1}行第${c + 1}列`}
            disabled={disabled || v !== 0}
            onClick={() => onTap(r, c)}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${((1 + c) / (N + 1)) * 100}%`, top: `${((1 + r) / (N + 1)) * 100}%`, width: `${cell * 1.9}%`, height: `${cell * 1.9}%` }}
          >
            {v !== 0 && (
              <span
                className={`block h-full w-full rounded-full shadow-md ${v === 1 ? "bg-neutral-900" : "bg-white ring-1 ring-neutral-300"}`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- 象棋视图 ---------- */

const X_LABEL: Record<string, string> = { r帅: "帅", r仕: "仕", r相: "相", r马: "馬", r车: "車", r炮: "炮", r兵: "兵", b将: "将", b士: "士", b象: "象", b马: "傌", b车: "俥", b炮: "砲", b卒: "卒" };

function XiangqiView({ st, selected, targets, onTap, disabled, name }: { st: XState; selected: Pt | null; targets: Pt[]; onTap: (r: number, c: number) => void; disabled: boolean; name: string }) {
  const cw = 100 / 10; // 列距（9 格线 10 列坐标）
  const rh = 100 / 11;
  const x = (c: number) => ((0.5 + c) / 10) * 100;
  const y = (r: number) => ((0.5 + r) / 11) * 100;
  return (
    <div className="relative aspect-[10/11] w-full max-w-[min(100%,380px)] rounded-2xl bg-[#f6e3b8] shadow-inner ring-1 ring-amber-900/10">
      <svg viewBox="0 0 10 11" className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        <g stroke="#8a6b3f" strokeWidth="0.035">
          {Array.from({ length: 10 }, (_, r) => <line key={r} x1={0.5} y1={0.5 + r} x2={9.5} y2={0.5 + r} />)}
          {Array.from({ length: 9 }, (_, i) => (
            <g key={i}>
              <line x1={0.5 + i} y1={0.5} x2={0.5 + i} y2={4.5} />
              <line x1={0.5 + i} y1={6.5} x2={0.5 + i} y2={10.5} />
            </g>
          ))}
          <line x1={0.5} y1={0.5} x2={9.5} y2={0.5} strokeWidth="0.06" />
          <line x1={0.5} y1={10.5} x2={9.5} y2={10.5} strokeWidth="0.06" />
          <line x1={0.5} y1={0.5} x2={0.5} y2={10.5} strokeWidth="0.06" />
          <line x1={9.5} y1={0.5} x2={9.5} y2={10.5} strokeWidth="0.06" />
          <line x1={3.5} y1={0.5} x2={6.5} y2={1.5} />
          <line x1={6.5} y1={0.5} x2={3.5} y2={1.5} />
          <line x1={3.5} y1={9.5} x2={6.5} y2={10.5} />
          <line x1={6.5} y1={9.5} x2={3.5} y2={10.5} />
        </g>
        <text x={5} y={5.5} textAnchor="middle" fontSize="0.55" fill="#8a6b3f" opacity="0.7">楚河 漢界</text>
      </svg>
      {/* 上一步高亮 */}
      {st.last && (
        <>
          <Ring x={x(st.last.from.c)} y={y(st.last.from.r)} tone="neutral" />
          <Ring x={x(st.last.to.c)} y={y(st.last.to.r)} tone="neutral" />
        </>
      )}
      {selected && <Ring x={x(selected.c)} y={y(selected.r)} tone="primary" />}
      {targets.map((m) => (
        <span key={`${m.r}-${m.c}`} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/70 shadow" style={{ left: `${x(m.c)}%`, top: `${y(m.r)}%`, width: "3.4%", height: "3.1%" }} />
      ))}
      {st.board.map((row, r) =>
        row.map((p, c) =>
          p ? (
            <button
              key={`${r}-${c}`}
              type="button"
              disabled={disabled}
              onClick={() => onTap(r, c)}
              className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 shadow-md transition-transform active:scale-95 ${
                p[0] === "r" ? "border-red-700/60 bg-gradient-to-br from-red-50 to-red-100 text-red-700" : "border-neutral-700/60 bg-gradient-to-br from-stone-50 to-stone-200 text-neutral-800"
              }`}
              style={{ left: `${x(c)}%`, top: `${y(r)}%`, width: "8.6%", height: "7.8%" }}
            >
              <span className="text-[clamp(9px,3.4vw,15px)] font-black leading-none">{X_LABEL[p] ?? p[1]}</span>
            </button>
          ) : (
            <button key={`${r}-${c}`} type="button" aria-label="空位" disabled={disabled} onClick={() => onTap(r, c)} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${x(c)}%`, top: `${y(r)}%`, width: "8.6%", height: "7.8%" }} />
          ),
        ),
      )}
      <p className="absolute -bottom-0 left-0 right-0 pb-0.5 text-center text-[9px] text-amber-900/50">{name} 执黑</p>
    </div>
  );
}

function Ring({ x, y, tone }: { x: number; y: number; tone: "primary" | "neutral" }) {
  return (
    <span
      className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${tone === "primary" ? "border-primary" : "border-sky-500/60"}`}
      style={{ left: `${x}%`, top: `${y}%`, width: "9.4%", height: "8.6%" }}
    />
  );
}
