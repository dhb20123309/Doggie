import type { McpToolMeta } from "./remote-mcp";

// Open-Meteo 免费天气 API 工具预置表（免 Key、浏览器可直连 CORS=*）
// 这些不是标准 MCP 服务，由 remote-mcp.ts 的 open-meteo:// 内置通道直接执行 HTTP GET。
const T = (name: string, description: string, keywords?: string[]): McpToolMeta => ({
  name,
  description,
  risk: "low",
  private: false,
  keywords,
});

export const OPEN_METEO_TOOLS: McpToolMeta[] = [
  T("current_weather", "查询任意城市当前实况天气：气温、体感、湿度、降水、风速、天气码。用户问『现在天气怎么样/多少度/下雨吗/外面冷不冷』时调用；city 传中文城市名即可。", ["天气", "多少度", "下雨", "外面"]),
  T("weather_forecast", "查询未来几天天气预报：每日最高/最低气温、降水量、天气码。用户问『明天/后天/这周末天气』『要不要带伞』时调用；days 传 1-7。", ["预报", "明天", "周末", "带伞"]),
  T("weather_hourly", "查询逐小时天气（默认温度+降水）。用户问『下午几点会下雨/今晚多少度/明早通勤冷不冷』等具体时段问题时调用；hours 传 1-48。", ["几点", "今晚", "明早", "逐小时"]),
  T("search_city", "按城市名查坐标与所属国家/时区（中英文都支持）。当不确定城市经纬度、或同名城市需要消歧时先调用本工具，再调天气工具传 lat/lon。", ["城市", "坐标", "定位"]),
];
