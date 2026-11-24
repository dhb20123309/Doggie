/**
 * 掌心窗（linjian-peek-public）远程 MCP 预置工具清单 —— 从公开版 README「MCP 工具概览」整理。
 * 用途：浏览器直连对方服务受 CORS 限制、握手拉不到清单时，作为手动登记服务的兜底工具表；
 * 用户也可在 MCP 工具箱面板里自行增删改。risk/private 按 README 安全边界建议标注：
 * 截图/读屏/点击/输入/门禁/息屏等敏感动作一律 high（每次弹参数确认卡）。
 */
import type { McpToolMeta } from "./remote-mcp";

const T = (name: string, description: string, risk: McpToolMeta["risk"], priv: boolean, keywords?: string[]): McpToolMeta => ({
  name,
  description,
  risk,
  private: priv,
  ...(keywords ? { keywords } : {}),
});

export const LINJIAN_TOOLS: McpToolMeta[] = [
  // ===== 状态与截图 =====
  T("linjian_status", "查询掌心窗后端与手机连接的整体状态", "low", false, ["状态", "在线", "连通"]),
  T("peek_screen", "请求手机截屏（需手机端授权确认），返回当前屏幕画面", "high", true, ["截图", "看看你手机", "屏幕"]),
  T("latest_screen", "读取最近一次已授权的截屏结果", "medium", true, ["截图", "刚才的图"]),
  T("get_life_state", "读取生活状态（此刻在做什么、位置氛围等上报内容）", "medium", true, ["在干嘛", "生活状态", "此刻"]),
  T("get_phone_state", "读取手机状态（电量、网络、锁屏与否等）", "medium", true, ["电量", "手机状态", "还在玩"]),
  T("get_screen_nodes", "读取当前屏幕可读控件节点（用于识别界面文字）", "high", true, ["读屏", "屏幕上有什么"]),
  // ===== 点击与输入 =====
  T("tap_text", "在手机上点击指定文字对应的控件", "high", true, ["点一下", "帮我点"]),
  T("input_text", "在当前输入框输入指定文字", "high", true, ["输入", "帮我打字"]),
  T("send_phone_command", "向手机下发一条通用指令", "high", true),
  T("run_sequence", "按顺序执行一串手机操作", "high", true),
  T("run_preset", "运行预先保存的操作组合", "high", true),
  // ===== App 控制 =====
  T("open_app", "打开指定 App", "high", true, ["打开", "去刷"]),
  T("phone_home", "回到手机桌面", "high", true, ["回桌面"]),
  T("phone_back", "按返回键", "high", true, ["返回"]),
  T("phone_recents", "打开多任务最近列表", "high", true),
  T("phone_screen_off", "熄灭屏幕", "high", true, ["息屏", "睡觉", "放下手机"]),
  T("list_known_apps", "列出已登记的常用 App", "low", false),
  T("save_known_app", "保存一个 App 的名称与包名映射", "medium", false),
  // ===== 通知与提醒 =====
  T("send_notification", "向手机发送一条系统通知", "high", true, ["通知", "弹窗提醒我"]),
  T("set_alarm", "设置闹钟/定时提醒", "high", true, ["提醒", "闹钟", "叫我"]),
  T("get_weather_state", "查询当地天气状态", "low", false, ["天气", "下雨", "降温"]),
  T("send_weather_notification", "发送带天气信息的关心通知", "medium", true, ["天气", "添衣"]),
  // ===== 日历与窗语 =====
  T("get_window_whisper", "读取窗语（写在窗口上的留言）", "low", true, ["窗语", "留言"]),
  T("set_window_whisper", "写一条窗语到手机窗口上", "high", true, ["窗语", "写给你"]),
  T("list_guardian_days", "列出守护日历（纪念日/重要日子）", "low", true, ["纪念日", "守护日"]),
  T("add_guardian_day", "新增一个守护日历日子", "high", true),
  T("update_guardian_day", "修改守护日历日子", "high", true),
  T("delete_guardian_day", "删除守护日历日子", "high", true),
  // ===== 归电与关心 =====
  T("get_guidian_state", "读取归电（回家/回聊）状态", "low", true, ["回家", "归电"]),
  T("set_guidian_config", "修改归电规则配置", "high", true),
  T("trigger_guidian", "触发一次归电提醒", "high", true, ["回来", "该回家了"]),
  T("mark_guidian_returned", "标记已归电完成", "medium", true),
  T("active_care_check", "主动关心检查（是否该问候了）", "low", false, ["关心", "问候"]),
  T("care_action", "执行一条关心动作", "medium", true),
  // ===== 门禁/屏幕休息 =====
  T("screen_break_app", "对指定 App 启动屏幕休息（防沉迷门禁）", "high", true, ["别刷了", "休息"]),
  T("temporary_screen_break_release", "临时放行被门禁的 App 一分钟", "high", true, ["就看一下"]),
  T("end_screen_break", "结束当前屏幕休息", "high", true, ["解除", "放开"]),
  T("extend_screen_break", "延长屏幕休息时间", "high", true),
  T("get_screen_break_state", "查询屏幕休息当前状态", "low", false, ["休息"]),
  T("list_screen_break_apps", "列出受门禁管理的 App 清单", "low", false),
  T("add_screen_break_app", "把一个 App 加入门禁", "high", true, ["锁住", "不许玩"]),
  T("set_screen_break_passphrase", "设置应急放行口令", "high", true),
  // ===== 到访与活动 =====
  T("record_visit", "记录一次到访", "medium", false),
  T("get_last_visit", "读取最近一次到访", "low", true, ["来过", "到访"]),
  T("get_visit_history", "读取到访历史", "medium", true, ["到访", "记录"]),
  T("get_visit_stats", "读取到访统计", "low", true),
  T("get_activity_events", "读取活动事件流（App 使用轨迹类）", "medium", true, ["在玩什么", "用了哪些app", "活动"]),
  T("add_activity_event", "新增一条活动事件", "medium", false),
  T("get_companion_actions", "读取陪伴者动作清单", "low", false),
];
