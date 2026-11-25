// 双弈游戏中心注册表：所有玩法在此汇总，UI/持久化只按 id 取 spec。
import type { GameSpec, GameCategory } from "./types";
import { gomokuSpec as gomoku, xiangqiSpec as xiangqi } from "./legacy-adapter";
import ticTacToe from "./tic-tac-toe";
import connectFour from "./connect-four";
import reversi from "./reversi";
import chessIntl from "./chess-intl";
import checkers from "./checkers";
import douShouQi from "./dou-shou-qi";
import memoryChess from "./memory-chess";
import junqi from "./junqi";
import go from "./go";
import doudizhu from "./doudizhu";
import uno from "./uno";
import ganDengYan from "./gan-deng-yan";
import fourColor from "./four-color";
import kaiHuoChe from "./kai-huo-che";
import zhaJinHua from "./zha-jin-hua";
import blackjack from "./blackjack";
import texasHoldem from "./texas-holdem";
import rummy from "./rummy";
import guandan from "./guandan";
import kawuxing from "./xiangyang-kawuxing";
import mahjong from "./mahjong";
import bluffDice from "./lia-ma";
import yachtDice from "./yacht-dice";
import monopoly from "./monopoly";
import monopolyPlus from "./monopoly-plus";
import ludo from "./ludo";
import jumpChecker from "./jump-checker";
import carcassonne from "./carcassonne";
import splendor from "./splendor";

export const GAME_SPECS: GameSpec[] = [
  gomoku, xiangqi, ticTacToe, connectFour, reversi, chessIntl, checkers, douShouQi, memoryChess, junqi, go,
  doudizhu, uno, ganDengYan, fourColor, kaiHuoChe, zhaJinHua, blackjack, texasHoldem, rummy, guandan, kawuxing, mahjong,
  bluffDice, yachtDice,
  monopoly, monopolyPlus, ludo, jumpChecker, carcassonne, splendor,
];

export const CATEGORY_CN: Record<GameCategory, string> = { board: "棋类", card: "牌类", dice: "骰子", table: "桌游" };
export const CATEGORY_ORDER: GameCategory[] = ["board", "card", "dice", "table"];

const byId = new Map(GAME_SPECS.map((g) => [g.id, g]));
export function getGame(id: string): GameSpec | undefined {
  return byId.get(id);
}
export function gameName(id: string): string {
  return byId.get(id)?.name ?? id;
}
export function gamesOf(cat: GameCategory): GameSpec[] {
  return GAME_SPECS.filter((g) => g.category === cat);
}
