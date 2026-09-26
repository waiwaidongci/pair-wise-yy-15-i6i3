// 档案存储：本地持久化、种子档案、补登/换卡时的履历归档

import {
  verifyFlight,
  formatClock,
  formatGap,
  formatSpeed,
  type Flight,
  type Revision,
} from "./verification";

const STORAGE_KEY = "hxyfront-62014-flights";

export function loadFlights(): Flight[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Flight[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // 本地数据损坏时回退到种子档案
  }
  return seedFlights();
}

export function saveFlights(flights: Flight[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(flights));
}

/** 把当前状态快照进履历，返回追加了原记录的新履历 */
function archiveCurrent(flight: Flight, action: string): Revision[] {
  const v = verifyFlight(flight);
  const revision: Revision = {
    revisedAt: new Date().toISOString(),
    action,
    detail: `卡号 ${flight.cardNo} · 到达 ${formatClock(flight.arrivalTime)} · 原判 ${v.status} · 分速 ${formatSpeed(v.speedMpm)} · 最长断档 ${formatGap(v.maxGapMinutes)}`,
    status: v.status,
    speedMpm: v.speedMpm,
    maxGapMinutes: v.maxGapMinutes,
  };
  return [...flight.history, revision];
}

/** 补登中间心跳：原记录先入履历，再写入心跳等待重算 */
export function supplementHeartbeat(flight: Flight, time: string): Flight {
  return {
    ...flight,
    heartbeats: [...flight.heartbeats, { time, cardNo: flight.cardNo }],
    history: archiveCurrent(flight, "补登心跳"),
  };
}

/** 换卡：原记录先入履历，绑定新卡号，并以换卡时刻在新卡上补一条心跳 */
export function changeCard(
  flight: Flight,
  nextCardNo: string,
  effectiveAt: string
): Flight {
  return {
    ...flight,
    cardNo: nextCardNo,
    heartbeats: [
      ...flight.heartbeats,
      { time: effectiveAt, cardNo: nextCardNo },
    ],
    history: archiveCurrent(flight, `换卡重算（${flight.cardNo} → ${nextCardNo}）`),
  };
}

function seedFlights(): Flight[] {
  const day = "2026-09-26";
  const at = (hm: string) => `${day}T${hm}:00`;
  const beats = (cardNo: string, times: string[]) =>
    times.map((t) => ({ time: at(t), cardNo }));

  return [
    {
      id: "f-001839",
      ringNo: "CHN-24-001839",
      bloodline: "詹森系",
      releasePlace: "保定东",
      distanceKm: 80,
      releaseTime: at("07:00"),
      arrivalTime: at("08:07"),
      cardNo: "ICCID-898600A1",
      heartbeats: beats("ICCID-898600A1", [
        "07:10",
        "07:20",
        "07:30",
        "07:40",
        "07:50",
        "08:00",
      ]),
      history: [],
    },
    {
      id: "f-002114",
      ringNo: "CHN-24-002114",
      bloodline: "凡龙系",
      releasePlace: "石家庄",
      distanceKm: 120,
      releaseTime: at("07:00"),
      arrivalTime: at("09:10"),
      cardNo: "ICCID-898600B7",
      heartbeats: [
        ...beats("ICCID-898600B7", ["07:12", "07:24", "07:36"]),
        // 流量卡到期，07:36–08:30 无上报
        ...beats("ICCID-898600B7", ["08:30", "08:42", "08:54"]),
      ],
      history: [],
    },
    {
      id: "f-008771",
      ringNo: "CHN-23-008771",
      bloodline: "詹森系",
      releasePlace: "衡水",
      distanceKm: 150,
      releaseTime: at("07:00"),
      arrivalTime: null,
      cardNo: "ICCID-898600C3",
      heartbeats: beats("ICCID-898600C3", ["07:15", "07:30"]),
      history: [],
    },
    {
      id: "f-000456",
      ringNo: "CHN-25-000456",
      bloodline: "凡龙系",
      releasePlace: "保定东",
      distanceKm: 80,
      releaseTime: at("07:00"),
      arrivalTime: at("08:12"),
      cardNo: "ICCID-898600D9",
      heartbeats: [
        ...beats("ICCID-898600D2", ["07:12", "07:24"]),
        ...beats("ICCID-898600D9", ["07:36", "07:48", "08:00"]),
      ],
      history: [
        {
          revisedAt: at("08:20"),
          action: "换卡重算（ICCID-898600D2 → ICCID-898600D9）",
          detail: "卡号 ICCID-898600D2 · 到达 08:12 · 原判 待补 · 分速 1111 m/min · 最长断档 24 分钟",
          status: "待补",
          speedMpm: 1111.1,
          maxGapMinutes: 24,
        },
      ],
    },
    {
      id: "f-009900",
      ringNo: "CHN-23-009900",
      bloodline: "幕利门系",
      releasePlace: "石家庄",
      distanceKm: 120,
      releaseTime: at("07:00"),
      arrivalTime: at("09:20"),
      cardNo: "ICCID-898600E5",
      heartbeats: [
        ...beats("ICCID-898600E5", ["07:10", "07:20"]),
        // 信号断档，07:20–08:05 无上报
        ...beats("ICCID-898600E5", ["08:05", "08:15", "08:25", "08:35"]),
      ],
      history: [],
    },
  ];
}
