// 游戏大厅薄壳：GameHall 选玩法/人数/对手 → GameStage 通用对局；负责续局存储、战绩与聊天记忆。
import { useCallback, useMemo, useState } from "react";
import type { AiConfig } from "@/lib/types";
import { useCharacters } from "@/lib/chat-store";
import { displayName } from "@/lib/chat-types";
import { getGame, gameName } from "@/lib/games";
import type { GameSpec } from "@/lib/games/types";
import { GameHall } from "./games/GameHall";
import { GameStage } from "./games/GameStage";
import type { OpponentSeat } from "./games/GameStage";
import { bumpStats, isLiveValid, recordDuel, useDuelLive, useDuelStats } from "@/lib/duel-store";

interface Props {
  config: AiConfig;
  /** 直达参数：从聊天工具箱带玩法进入 */
  gameId?: string;
  charId?: string;
  onBack: () => void;
  /** 终局回调：角色在聊天里发感想（多人局逐个触发） */
  onFinish?: (charId: string, result: "win" | "lose" | "draw", gameName: string) => void;
}

/** 进行中局按主角色隔离；纯人机局用伪键 */
const AI_LIVE_KEY = "__ai__";

export function DuelApp({ config, gameId, charId, onBack, onFinish }: Props) {
  const [characters] = useCharacters();
  const [live, setLive] = useDuelLive();
  const [stats, setStats] = useDuelStats();
  void stats;
  const [pickChar, setPickChar] = useState<string>(charId || characters[0]?.id || "");
  const [playing, setPlaying] = useState<{ spec: GameSpec; seats: number; charIds: string[]; initial: unknown | null } | null>(() => {
    if (!gameId) return null;
    const spec = getGame(gameId);
    if (!spec) return null;
    // 同玩法的进行中局自动续上
    const key = charId || AI_LIVE_KEY;
    const rec = live[key];
    const resumable = rec && isLiveValid(rec) && rec.gameId === gameId ? rec.state ?? null : null;
    return { spec, seats: 2, charIds: charId ? [charId] : [], initial: resumable };
  });

  const ch = characters.find((c) => c.id === pickChar) ?? characters[0];
  const liveKey = ch ? ch.id : AI_LIVE_KEY;
  const liveRec = live[liveKey] && isLiveValid(live[liveKey]) ? live[liveKey] : undefined;

  // 席位表：seat1.. 依次是选中角色，不足 seats-1 补人机
  const opponents: OpponentSeat[] = useMemo(() => {
    if (!playing) return [];
    return Array.from({ length: playing.seats - 1 }, (_, i) => {
      const id = playing.charIds[i];
      const c = id ? characters.find((x) => x.id === id) : undefined;
      return c ? { seat: i + 1, name: displayName(c), charId: c.id } : { seat: i + 1, name: `小机 ${i + 1}` };
    });
  }, [playing, characters]);

  const start = useCallback(
    (spec: GameSpec, seats: number, charIds: string[]) => {
      const key = charIds[0] ?? (ch ? ch.id : AI_LIVE_KEY);
      // 换玩法开局：清掉该键的旧进行中局（不同玩法局面不互通）
      const rec = live[key] && isLiveValid(live[key]) ? live[key] : undefined;
      if (rec && rec.gameId !== spec.id) {
        setLive((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        console.log(`[duel] discard stale live ${rec.gameId} → new ${spec.id}`);
      }
      const same = rec && rec.gameId === spec.id;
      setPlaying({ spec, seats, charIds, initial: same ? rec!.state ?? null : null });
      console.log(`[duel] start ${spec.id} seats=${seats} chars=${charIds.join(",") || "-"} resume=${!!same}`);
    },
    [ch, live, setLive],
  );

  const exit = useCallback(
    (finalState: unknown | null, result: "ongoing" | "win" | "lose" | "draw", seatResults?: { charId: string; result: "win" | "lose" | "draw" }[]) => {
      if (!playing) return;
      const { spec, charIds } = playing;
      const key = charIds[0] ?? liveKey;
      if (result === "ongoing" && finalState != null) {
        // 存进行中局，下次进来可续
        setLive((prev) => ({
          ...prev,
          [key]: { game: spec.id as "gomoku", gameId: spec.id, charId: key, state: finalState, turn: "r", startedAt: Date.now(), moveCount: 0 },
        }));
        recordDuel(key, spec.id as "gomoku", "ongoing", spec.id);
      } else {
        setLive((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        if (result !== "ongoing") {
          // 每个真实角色席位各自记战绩/记忆/聊天感想；纯人机位跳过
          const perSeat = seatResults?.length ? seatResults : charIds.map((id) => ({ charId: id, result }));
          for (const s of perSeat) {
            recordDuel(s.charId, spec.id as "gomoku", s.result, spec.id);
            setStats((prev) => bumpStats(prev, s.charId, s.result));
            onFinish?.(s.charId, s.result, gameName(spec.id));
          }
        }
      }
      console.log(`[duel] exit ${spec.id} result=${result} seats=${charIds.length}`);
      setPlaying(null);
    },
    [playing, liveKey, setLive, setStats, onFinish],
  );

  if (!ch && characters.length === 0 && !playing) {
    return <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">还没有角色，先去添加一个吧</div>;
  }

  if (playing) {
    return (
      <GameStage
        key={`${playing.charIds.join("_")}:${playing.spec.id}:${playing.seats}`}
        spec={playing.spec}
        opponents={opponents}
        config={config}
        initial={playing.initial}
        onExit={exit}
      />
    );
  }

  return (
    <GameHall
      characters={characters}
      activeCharId={ch?.id ?? ""}
      onPickChar={setPickChar}
      liveGameId={liveRec?.gameId ?? null}
      onResume={() => {
        const spec = getGame(liveRec!.gameId!);
        if (!spec) return;
        // 从存档恢复席位数：state.seats 优先，否则按记录 charId 推断
        const st = liveRec!.state as { seats?: number } | null | undefined;
        const seats = typeof st?.seats === "number" ? st.seats : 2;
        const ids = liveKey === AI_LIVE_KEY ? [] : [liveKey];
        setPlaying({ spec, seats, charIds: ids.slice(0, Math.max(0, seats - 1)), initial: liveRec!.state ?? null });
      }}
      onStart={start}
      onBack={onBack}
    />
  );
}

