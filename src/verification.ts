// 核验规则：心跳连续性、断档判定、速度重算

export const GAP_LIMIT_MINUTES = 15;

export interface Heartbeat {
  time: string; // ISO 时刻
  cardNo: string; // 上报所用流量卡号
}

export type FlightStatus = "有效" | "待补" | "未归巢";

export interface Revision {
  revisedAt: string; // 归档时刻
  action: string; // 触发动作：补登心跳 / 换卡重算
  detail: string; // 原记录摘要
  status: FlightStatus;
  speedMpm: number | null;
  maxGapMinutes: number;
}

export interface Flight {
  id: string;
  ringNo: string; // 足环号
  bloodline: string; // 血统
  releasePlace: string; // 训放地点
  distanceKm: number; // 放飞距离
  releaseTime: string; // 放飞时刻
  arrivalTime: string | null; // 到达时刻，null 表示未归巢
  cardNo: string; // 当前绑定流量卡号
  heartbeats: Heartbeat[]; // 心跳上报
  history: Revision[]; // 履历：历次重算前的原记录
}

export interface Verification {
  status: FlightStatus;
  maxGapMinutes: number; // 最长断档（分钟）
  gapStart: string | null; // 最长断档起点
  gapEnd: string | null; // 最长断档终点
  durationMinutes: number | null; // 归巢用时
  speedMpm: number | null; // 分速（米/分钟）
}

const toMs = (iso: string) => new Date(iso).getTime();

/** 核验一羽赛鸽：放飞时刻 + 全部心跳 + 到达时刻连成上报链，相邻间隔超过 15 分钟即判断档待补 */
export function verifyFlight(flight: Flight): Verification {
  if (!flight.arrivalTime) {
    return {
      status: "未归巢",
      maxGapMinutes: 0,
      gapStart: null,
      gapEnd: null,
      durationMinutes: null,
      speedMpm: null,
    };
  }

  const points = [
    flight.releaseTime,
    ...flight.heartbeats.map((h) => h.time),
    flight.arrivalTime,
  ]
    .map((t) => ({ t, ms: toMs(t) }))
    .sort((a, b) => a.ms - b.ms);

  let maxGapMinutes = 0;
  let gapStart: string | null = null;
  let gapEnd: string | null = null;
  for (let i = 1; i < points.length; i += 1) {
    const gap = (points[i].ms - points[i - 1].ms) / 60000;
    if (gap > maxGapMinutes) {
      maxGapMinutes = gap;
      gapStart = points[i - 1].t;
      gapEnd = points[i].t;
    }
  }

  const durationMinutes =
    (toMs(flight.arrivalTime) - toMs(flight.releaseTime)) / 60000;
  const speedMpm =
    durationMinutes > 0 ? (flight.distanceKm * 1000) / durationMinutes : null;

  return {
    status: maxGapMinutes > GAP_LIMIT_MINUTES ? "待补" : "有效",
    maxGapMinutes,
    gapStart,
    gapEnd,
    durationMinutes,
    speedMpm,
  };
}

export function formatClock(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatGap(minutes: number): string {
  return `${Math.round(minutes * 10) / 10} 分钟`;
}

export function formatSpeed(speedMpm: number | null): string {
  return speedMpm === null ? "—" : `${Math.round(speedMpm)} m/min`;
}
