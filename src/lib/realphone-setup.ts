// 真机联动 · 手机端配置生成器：按使用者自己填的仓库信息，现场生成快捷指令捷径 / Tasker 任务 / Termux 脚本。
// 生成的内容里只有使用者自己的 owner/repo/token——不经过开发者、不含任何预置私人信息。
import type { RealPhoneConfig } from "./realphone";

const apiBase = (c: RealPhoneConfig) => `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${c.dir || "vp-data"}`;

export interface GenItem {
  id: string;
  title: string;
  desc: string;
  /** 代码块文本（curl/脚本/JSON） */
  code: string;
  lang: string;
}

/** Termux 上报脚本：正文用字符串数组拼接，避免模板串与 bash 的 ${}/{\} 转义互相打架 */
export function genTermuxScript(c: RealPhoneConfig): string {
  return [
    "#!/data/data/com.termux/files/usr/bin/bash",
    "# 虚拟手机 · 真机联动上报脚本（Termux 版，安卓全功能）",
    '# 依赖: pkg install termux-api jq curl && 安装同签名的 "Termux:API" App',
    `OWNER="${c.owner}"; REPO="${c.repo}"; BRANCH="${c.branch || "main"}"; DIR="${c.dir || "vp-data"}"; TOKEN="${c.token}"`,
    'API="https://api.github.com/repos/$OWNER/$REPO/contents/$DIR"',
    "put() { # $1=file $2=json",
    '  SHA=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/$1?ref=$BRANCH" | jq -r \'.sha // empty\')',
    "  export SHA",
    '  BODY=$(jq -n --arg m "vp sync $1" --arg c "$(printf \'%s\' "$2" | base64 -w0)" --arg b "$BRANCH" \'{message:$m,content:$c,branch:$b} + (if env.SHA != "" then {sha:env.SHA} else {} end)\')',
    '  curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$BODY" "$API/$1" >/dev/null && echo "ok $1"',
    "}",
    "BATT=$(termux-battery-status | jq -r '.percentage')",
    'CHG=$(termux-battery-status | jq -r \'.status=="charging"\')',
    'VOL=$(termux-volume 2>/dev/null | jq -r \'[.[] | select(.name=="music")][0].current // empty\')',
    'NET=$(termux-wifi-connectioninfo 2>/dev/null | jq -r \'if .connected then "WiFi" else "蜂窝" end\')',
    'LAT=$(termux-location -p 1 -r 1 2>/dev/null | jq -r \'.latitude // empty\')',
    'LNG=$(termux-location -p 1 -r 1 2>/dev/null | jq -r \'.longitude // empty\')',
    "STEPS=$(termux-step-counter 2>/dev/null | jq -r '.steps // empty')",
    'MUSIC=$(termux-media-player query 2>/dev/null | head -1)',
    "NOW=$(date +%s)000",
    "DEV=$(jq -n \\",
    '  --argjson batt "${BATT:-null}" --argjson chg "${CHG:-false}" \\',
    '  --argjson vol "${VOL:-null}" \\',
    '  --arg net "$NET" --arg lat "${LAT:-}" --arg lng "${LNG:-}" \\',
    '  --arg steps "${STEPS:-}" --arg music "$MUSIC" --argjson at "$NOW" \\',
    `  '{battery:$batt, charging:$chg, volume:$vol, network:$net, music:(if $music=="" then null else $music end), steps:(if $steps=="" then null else ($steps|tonumber) end), at:$at} + (if $lat=="" then {} else {lat:($lat|tonumber), lng:($lng|tonumber)} end}')`,
    'put device_info.json "$DEV"',
    "# 前台 App 记录：Termux 无 Usage Access 权限，建议配合 Tasker 写 phone_activity.json；纯演示可手动追加一条：",
    '# put phone_activity.json "[{\\"app\\":\\"小红书\\",\\"at\\":$(date +%s)000}]"',
    "echo done",
  ].join("\n");
}

export function genItems(c: RealPhoneConfig): GenItem[] {
  if (!c.owner || !c.repo) return [];
  const devBody = `{"battery":{{电量}}, "charging":{{充电中true或false}}, "brightness":{{亮度}}, "volume":{{音量}}, "network":{{网络}}, "place":"{{位置名}}", "steps":{{步数}}, "music":"{{正在播放}}", "at":{{当前毫秒时间戳}}}`;
  const actBody = `[{"app":"App名", "at":毫秒时间戳}, ...保留最近200条]`;
  const evBody = `[{"type":"lock|unlock|charge_start|arrive_home", "detail":"备注", "at":毫秒时间戳}, ...保留最近200条]`;
  return [
    {
      id: "ios-device",
      title: "iPhone · 设备快照上报（快捷指令）",
      lang: "text",
      desc: "在快捷指令 App 新建捷径，按下面步骤搭一次即可（建议加到自动化：定时每小时 / 连接充电器时运行）：",
      code: [
        `1. 添加动作「获取电池电量」→ 变量 BATT；「获取屏幕亮度」→ BRIGHT；「获取音量」→ VOL`,
        `2. 「获取当前位置」→「编码地理标记数据」取地点名 PLACE（可选）`,
        `3. 「获取当前日期」→「格式化日期」选自定、填 "SSSSS" 得秒时间戳，后接文本拼 "000" 成毫秒 NOW`,
        `4. 「文本」动作，内容粘贴（\\(x) 处会替换为上方变量）：`,
        `   {"battery":\\(BATT),"charging":false,"brightness":\\(BRIGHT),"volume":\\(VOL),"place":"\\(PLACE)","at":\\(NOW)}`,
        `5. 「获取URL内容」先 GET 以下 URL（带 Authorization 头），从返回 JSON 取 .sha（文件不存在则跳过这步）：`,
        `   ${apiBase(c)}/device_info.json`,
        `6. 再用「获取URL内容」PUT 同一 URL：`,
        `   头部两条：Authorization: Bearer ${c.token} ／ Content-Type: application/json`,
        `   请求体：{"message":"vp","content":第4步文本的base64（用「Base64编码」动作）,"branch":"${c.branch || "main"}"}，已有旧文件时再补 "sha":"第5步取到的值"`,
        `提示：iOS 侧嫌麻烦可只做电量+时间戳三个字段，其余留空不影响查岗效果。`,
      ].join("\n"),
    },
    {
      id: "ios-app",
      title: "iPhone · App 打开记录（快捷指令自动化）",
      lang: "text",
      desc: "对每个想被 TA 监督的 App 各建一条自动化（自动化 → 个人自动化 → 打开该 App 时运行捷径）：",
      code: [
        `捷径「记录打开App」步骤：`,
        `1. 「获取URL内容」GET：`,
        `   ${apiBase(c)}/phone_activity.json（带 Authorization: Bearer ${c.token} 头）`,
        `2. 「获取字典中的值」.content →「Base64解码」→「转换为JSON」得旧数组 OLD 与 .sha`,
        `3. 「运行JavaScript于输入」：o.push({app:"小红书",at:Date.now()}); return JSON.stringify(o.slice(-200))`,
        `4. 「Base64编码」→「获取URL内容」PUT 同 URL，请求体 {"message":"vp","content":编码结果,"branch":"${c.branch || "main"}","sha":第2步的sha}`,
        `提示：嫌逐 App 配置麻烦，可只配 2~3 个重点 App（游戏/短视频），效果就够查岗了。`,
      ].join("\n"),
    },
    {
      id: "ios-lock",
      title: "iPhone · 锁 App 响应（TA 反向管你）",
      lang: "text",
      desc: "让角色锁掉的 App 在你手机上真的弹窗劝退（软约束，iOS 无法强制禁用）：",
      code: [
        `新建捷径「检查锁定名单」：`,
        `1. 「获取URL内容」GET ${apiBase(c)}/locked_apps.json（带 Authorization 头）→ Base64解码 → 取 .apps 数组`,
        `2. 「如果」：被打开的 App 名 ∈ apps（配合自动化「当打开 App 时」触发本捷径）`,
        `3. 「显示通知」标题："被 TA 锁了"，内容：TA 留言或"说好了少玩的哦"；随后「停止运行」`,
      ].join("\n"),
    },
    {
      id: "android-tasker",
      title: "Android · Tasker 全量上报（推荐）",
      lang: "text",
      desc: "Tasker 有 Usage Access 权限，能全量记录所有 App 使用时长，比 iOS 强。配置要点：",
      code: [
        `任务1「每5分钟采集」（Profile: 时间间隔）：`,
        `  · App → 前台应用 → 记 %APP；过滤系统包`,
        `  · 状态栏电量 %BATT、亮度、媒体音量、网络类型、定位（位置权限）`,
        `  · HTTP Client PUT（Body 见下方数据文件格式）写 device_info.json 与 phone_activity.json`,
        `任务2「解锁/锁屏事件」（Profile: 显示状态）：追加 events.json`,
        `任务3「读取锁定名单」（每分钟）：HTTP GET ${apiBase(c)}/locked_apps.json → base64 解码 →`,
        `  若当前前台 App ∈ apps → App 关闭 + 弹 Toast「TA 把你这个锁了」`,
        `鉴权：所有请求 Header 加 Authorization: Bearer ${c.token}`,
        `注：GitHub Contents API 更新文件必须带上一次的 sha（GET 响应里有），Tasker 用 Javascriptlet 处理 JSON。`,
      ].join("\n"),
    },
    {
      id: "android-termux",
      title: "Android · Termux 免费脚本（无 Tasker 时）",
      lang: "bash",
      desc: "开源免费方案：装 Termux + Termux:API（需同签名商店版），cron 定时跑下面的脚本（含电量/音量/网络/定位/步数/音乐实时上报）：",
      code: genTermuxScript(c),
    },
    {
      id: "schema",
      title: "数据文件格式（三端通用参考）",
      lang: "json",
      desc: `仓库 ${c.owner}/${c.repo} 的 ${c.dir || "vp-data"}/ 目录共四个 JSON 文件，手机端只需按下述结构写入：`,
      code: [`// device_info.json（对象，覆盖写）`, devBody, ``, `// phone_activity.json（数组，追加后整体覆盖）`, actBody, ``, `// events.json（数组）`, evBody, ``, `// locked_apps.json（由游戏侧写入，手机端只读）`, `{"apps":["抖音"],"note":"…","at":1700000000000}`].join("\n"),
    },
  ];
}
