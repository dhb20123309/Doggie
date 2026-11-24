// 双弈游戏中心薄壳：GameHall 选玩法/对手 → GameStage 通用对局；负责续局存储、战绩与聊天记忆。
import { useCallback, useState } from "react";
import type { AiConfig } from "@/lib/types";
import { useCharacters } from "@/lib/chat-store";
import { displayName } from "@/lib/chat-types";
import { getGame, gameName } from "@/lib/games";
import type { GameSpec } from "@/lib/games/types";
import { GameHall } from "./games/GameHall";
import { GameStage } from "./games/GameStage";
import { bumpStats, isLiveValid, recordDuel, useDuelLive, useDuelStats } from "@/lib/duel-store";

interface Props {
  config: AiConfig;
  /** 直达参数：从聊天工具箱带玩法进入 */
  gameId?: string;
  charId?: string;
  onBack: () => void;
  /** 终局回调：角色在聊天里发感想 */
  onFinish?: (charId: string, result: "win" | "lose" | "draw", gameName: string) => void;
}

export function DuelApp({ config, gameId, charId, onBack, onFinish }: Props) {
  const [characters] = useCharacters();
  const [live, setLive] = useDuelLive();
  const [stats, setStats] = useDuelStats();
  const [pickChar, setPickChar] = useState<string>(charId || characters[0]?.id || "");
  const [playing, setPlaying] = useState<{ spec: GameSpec; initial: unknown | null } | null>(() => {
    if (!gameId) return null;
    const spec = getGame(gameId);
    if (!spec) return null;
    // 同玩法的进行中局自动续上
    const rec = charId ? live[charId] : undefined;
    const resumable = rec && isLiveValid(rec) && rec.gameId === gameId ? rec.state ?? null : null;
    return { spec, initial: resumable };
  });

  const ch = characters.find((c) => c.id === pickChar) ?? characters[0];
  const liveRec = ch && live[ch.id] && isLiveValid(live[ch.id]) ? live[ch.id] : undefined;

  const start = useCallback(
    (spec: GameSpec) => {
      // 换玩法开局：清掉该角色的旧进行中局（不同玩法局面不互通）
      if (ch && liveRec && liveRec.gameId !== spec.id) {
        setLive((prev) => {
          const next = { ...prev };
          delete next[ch.id];
          return next;
        });
        console.log(`[duel] discard stale live ${liveRec.gameId} → new ${spec.id}`);
      }
      const same = ch && liveRec && liveRec.gameId === spec.id;
      setPlaying({ spec, initial: same ? liveRec.state ?? null : null });
      console.log(`[duel] start ${spec.id} char=${ch?.id} resume=${same}`);
    },
    [ch, liveRec, setLive],
  );

  const exit = useCallback(
    (finalState: unknown | null, result: "ongoing" | "win" | "lose" | "draw") => {
      if (!playing || !ch) return;
      const { spec } = playing;
      if (result === "ongoing" && finalState != null) {
        // 存进行中局，下次进来可续
        setLive((prev) => ({
          ...prev,
          [ch.id]: { game: spec.id as "gomoku", gameId: spec.id, charId: ch.id, state: finalState, turn: "r", startedAt: Date.now(), moveCount: 0 },
        }));
        recordDuel(ch.id, spec.id as "gomoku", "ongoing", spec.id);
      } else {
        setLive((prev) => {
          const next = { ...prev };
          delete next[ch.id];
          return next;
        });
        if (result !== "ongoing") {
          recordDuel(ch.id, spec.id as "gomoku", result, spec.id);
          setStats((prev) => bumpStats(prev, ch.id, result));
          onFinish?.(ch.id, result, gameName(spec.id));
        }
      }
      console.log(`[duel] exit ${spec.id} result=${result}`);
      setPlaying(null);
    },
    [playing, ch, setLive, setStats, onFinish],
  );

  if (!ch) {
    return <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">还没有角色，先去添加一个吧</div>;
  }

  if (playing) {
    return (
      <GameStage
        key={`${ch.id}:${playing.spec.id}`}
        spec={playing.spec}
        charName={displayName(ch)}
        config={config}
        initial={playing.initial}
        onExit={exit}
      />
    );
  }

  return (
    <GameHall
      characters={characters}
      activeCharId={ch.id}
      onPickChar={setPickChar}
      liveGameId={liveRec?.gameId ?? null}
      onResume={() => {
        const spec = getGame(liveRec!.gameId!);
        if (spec) setPlaying({ spec, initial: liveRec!.state ?? null });
      }}
      onStart={start}
      onBack={onBack}
    />
  );
}
