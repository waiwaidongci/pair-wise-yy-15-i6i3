// 业务文件一：上报连续性核验规则
// 规则：放飞时刻 → 各次心跳时刻 → 到达时刻构成完整时间链，
// 相邻两点间隔超过 GAP_LIMIT_MIN 分钟即视为信号断档；
// 已归巢但存在断档的记录列入“待补”，不进入速度榜；
// 补回中间心跳或换卡后对同一记录重新核验，结论实时派生。

export const GAP_LIMIT_MIN = 15;

export interface Heartbeat {
  time: string; // 心跳时刻，datetime-local 格式（YYYY-MM-DDTHH:mm）
  card: string; // 本次心跳上报所用卡号
}

export type FlightStatus = "valid" | "pending" | "out";

export interface LogEntry {
  time: string;
  action: string;
  detail: string;
  before?: FlightStatus;
  after?: FlightStatus;
}

export interface Flight {
  id: string;
  site: string; // 训放地点
  distance: number; // 放飞距离 km
  weather: string; // 天气
  releaseTime: string; // 放飞时刻
  arrivalTime?: string; // 到达时刻，未填表示尚未归巢
  heartbeats: Heartbeat[];
  logs: LogEntry[]; // 该条上报的核验履历（原记录永不覆盖）
}

export interface Pigeon {
  ring: string; // 足环号（唯一）
  bloodline: string; // 血统
  health: string; // 健康状态
  card: string; // 当前绑定卡号
  cardLogs: LogEntry[]; // 绑卡/换卡履历
  flights: Flight[];
}

export interface GapInfo {
  from: string;
  to: string;
  minutes: number;
}

export interface FlightResult {
  status: FlightStatus;
  elapsedMin?: number; // 归巢用时（放飞→到达，绝不按最后心跳推算）
  speed?: number; // m/min，仅连续有效时给出
  gaps: GapInfo[];
  maxGapMin: number;
  heartbeatCount: number;
}

export function diffMin(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

export function formatTime(s?: string): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatElapsed(min?: number): string {
  if (min === undefined || min < 0) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}小时${m}分` : `${m}分`;
}

export const STATUS_LABEL: Record<FlightStatus, string> = {
  valid: "连续有效",
  pending: "待补核验",
  out: "尚未归巢",
};

/** 对单条上报记录执行连续性核验，结论每次实时计算、不持久化 */
export function verifyFlight(flight: Flight): FlightResult {
  const chain = flight.heartbeats
    .filter((h) => h.time >= flight.releaseTime && (!flight.arrivalTime || h.time <= flight.arrivalTime))
    .map((h) => h.time)
    .sort((a, b) => (a < b ? -1 : 1));

  if (!flight.arrivalTime) {
    return { status: "out", gaps: [], maxGapMin: 0, heartbeatCount: chain.length };
  }

  const points = [flight.releaseTime, ...chain, flight.arrivalTime];
  const gaps: GapInfo[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const minutes = diffMin(points[i - 1], points[i]);
    if (minutes > GAP_LIMIT_MIN) {
      gaps.push({ from: points[i - 1], to: points[i], minutes });
    }
  }

  const elapsedMin = diffMin(flight.releaseTime, flight.arrivalTime);
  const maxGapMin = gaps.reduce((max, g) => Math.max(max, g.minutes), 0);

  if (gaps.length > 0) {
    return { status: "pending", elapsedMin, gaps, maxGapMin, heartbeatCount: chain.length };
  }

  const speed = elapsedMin > 0 ? (flight.distance * 1000) / elapsedMin : undefined;
  return { status: "valid", elapsedMin, speed, gaps, maxGapMin, heartbeatCount: chain.length };
}

export function latestFlight(pigeon: Pigeon): Flight | undefined {
  return pigeon.flights[pigeon.flights.length - 1];
}

export interface LoftSummary {
  total: number;
  arrived: number;
  validCount: number;
  pendingCount: number;
  outCount: number;
  returnRate: number; // 归巢率（含待补，归巢事实不受断档影响）
  avgSpeed?: number; // 仅统计连续有效记录
  bloodlineCount: number;
}

/** 鸽棚总览：始终以每羽最新一条上报的当前核验结论为准 */
export function summarize(pigeons: Pigeon[]): LoftSummary {
  let validCount = 0;
  let pendingCount = 0;
  let outCount = 0;
  let speedSum = 0;

  for (const pigeon of pigeons) {
    const flight = latestFlight(pigeon);
    if (!flight) continue;
    const result = verifyFlight(flight);
    if (result.status === "valid") {
      validCount += 1;
      speedSum += result.speed ?? 0;
    } else if (result.status === "pending") {
      pendingCount += 1;
    } else {
      outCount += 1;
    }
  }

  const total = validCount + pendingCount + outCount;
  const bloodlineCount = new Set(pigeons.map((p) => p.bloodline)).size;

  return {
    total,
    arrived: validCount + pendingCount,
    validCount,
    pendingCount,
    outCount,
    returnRate: total > 0 ? Math.round(((validCount + pendingCount) / total) * 100) : 0,
    avgSpeed: validCount > 0 ? Math.round(speedSum / validCount) : undefined,
    bloodlineCount,
  };
}
