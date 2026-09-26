// 业务文件二：鸽棚档案存储
// 职责：在鸽档案、上报名单与履历的本地读写（localStorage），
// 以及补心跳、换卡、补登到达等变更操作。核验结论不入库，永远由规则实时重算；
// 每次变更都只追加履历条目，原始上报记录保留在 flight.logs / pigeon.cardLogs 中。

import type { Flight, FlightStatus, Heartbeat, LogEntry, Pigeon } from "./verification";
import { verifyFlight } from "./verification";

const STORAGE_KEY = "pigeon-clock-archive:v1";

export interface Archive {
  pigeons: Pigeon[];
  savedAt?: string;
}

export function uid(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function loadArchive(): Archive {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Archive;
      if (parsed && Array.isArray(parsed.pigeons)) return parsed;
    }
  } catch {
    // 存储不可读时回落到示例档案
  }
  const seed = seedArchive();
  saveArchive(seed);
  return seed;
}

export function saveArchive(archive: Archive): Archive {
  const next = { ...archive, savedAt: nowStamp() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式等场景下仅保留内存态
  }
  return next;
}

export function resetArchive(): Archive {
  const seed = seedArchive();
  return saveArchive(seed);
}

// ---------- 不可变更新辅助 ----------

function updatePigeon(archive: Archive, ring: string, fn: (p: Pigeon) => Pigeon): Archive {
  return {
    ...archive,
    pigeons: archive.pigeons.map((p) => (p.ring === ring ? fn(p) : p)),
  };
}

function updateFlight(
  archive: Archive,
  ring: string,
  flightId: string,
  fn: (f: Flight) => Flight,
): Archive {
  return updatePigeon(archive, ring, (p) => ({
    ...p,
    flights: p.flights.map((f) => (f.id === flightId ? fn(f) : f)),
  }));
}

// ---------- 新增上报 ----------

export interface NewFlightInput {
  ring: string;
  bloodline: string;
  health: string;
  card: string;
  site: string;
  distance: number;
  weather: string;
  releaseTime: string;
  arrivalTime?: string;
  heartbeats: Heartbeat[];
}

/** 新增一条上报；足环号已存在则并入该鸽档案，不存在则建档 */
export function addFlight(archive: Archive, input: NewFlightInput, time = nowStamp()): Archive {
  const ring = input.ring.trim();
  const existing = archive.pigeons.find((p) => p.ring === ring);
  const flight: Flight = {
    id: uid("fly"),
    site: input.site.trim(),
    distance: input.distance,
    weather: input.weather.trim() || "未记录",
    releaseTime: input.releaseTime,
    arrivalTime: input.arrivalTime || undefined,
    heartbeats: [...input.heartbeats].sort((a, b) => (a.time < b.time ? -1 : 1)),
    logs: [],
  };
  flight.logs.push({
    time,
    action: "新建上报",
    detail: `${input.site.trim()} · ${input.distance}km · ${input.weather.trim() || "未记录"} · 心跳${input.heartbeats.length}次`,
  });

  if (!existing) {
    const pigeon: Pigeon = {
      ring,
      bloodline: input.bloodline.trim() || "未登记血统",
      health: input.health.trim() || "正常",
      card: input.card.trim(),
      cardLogs: [{ time, action: "首次绑卡", detail: `绑定鸽钟卡号 ${input.card.trim()}` }],
      flights: [flight],
    };
    return { ...archive, pigeons: [...archive.pigeons, pigeon] };
  }

  return updatePigeon(archive, ring, (p) => ({ ...p, flights: [...p.flights, flight] }));
}

// ---------- 补回中间心跳 ----------

/** 向断档区间补录一次心跳并对该记录重新核验；原结论以履历形式保留 */
export function addHeartbeat(
  archive: Archive,
  ring: string,
  flightId: string,
  heartbeat: Heartbeat,
  time = nowStamp(),
): Archive {
  let result: Archive = archive;
  let before: FlightStatus | undefined;

  result = updateFlight(result, ring, flightId, (f) => {
    before = verifyFlight(f).status;
    if (f.heartbeats.some((h) => h.time === heartbeat.time && h.card === heartbeat.card)) return f;
    return { ...f, heartbeats: [...f.heartbeats, heartbeat] };
  });

  result = updateFlight(result, ring, flightId, (f) => {
    const sorted = [...f.heartbeats].sort((a, b) => (a.time < b.time ? -1 : 1));
    const after = verifyFlight({ ...f, heartbeats: sorted }).status;
    return {
      ...f,
      heartbeats: sorted,
      logs: [
        ...f.logs,
        {
          time,
          action: "补回中间心跳",
          detail: `补录 ${heartbeat.card} 在 ${heartbeat.time.replace("T", " ")} 的心跳，重新核验`,
          before,
          after,
        },
      ],
    };
  });

  return result;
}

// ---------- 换卡 ----------

/** 换卡：更新绑定卡号（不改变心跳链，若断档仍在则结论不变，记录照常留在履历） */
export function changeCard(
  archive: Archive,
  ring: string,
  flightId: string,
  newCard: string,
  time = nowStamp(),
): Archive {
  const card = newCard.trim();
  if (!card) return archive;

  return updatePigeon(archive, ring, (p) => {
    const flights = p.flights.map((f) => {
      if (f.id !== flightId) return f;
      const before = verifyFlight(f).status;
      // 换卡只更新绑定关系，不改动心跳链；断档仍在则结论不变
      const after = before;
      return {
        ...f,
        logs: [
          ...f.logs,
          {
            time,
            action: "鸽钟换卡",
            detail: `上报卡号由 ${p.card} 变更为 ${card}，按既有心跳链重新核验`,
            before,
            after,
          },
        ],
      };
    });
    return {
      ...p,
      card,
      cardLogs: [...p.cardLogs, { time, action: "换卡", detail: `卡号 ${p.card} → ${card}` }],
      flights,
    };
  });
}

// ---------- 未归巢补登到达 ----------

/** 给尚未归巢的记录补登到达时刻并重新核验 */
export function registerArrival(
  archive: Archive,
  ring: string,
  flightId: string,
  arrivalTime: string,
  time = nowStamp(),
): Archive {
  let result: Archive = archive;
  let before: FlightStatus | undefined;

  result = updateFlight(result, ring, flightId, (f) => {
    before = verifyFlight(f).status;
    return { ...f, arrivalTime };
  });

  result = updateFlight(result, ring, flightId, (f) => {
    const after = verifyFlight(f).status;
    return {
      ...f,
      logs: [
        ...f.logs,
        {
          time,
          action: "补登到达时刻",
          detail: `到达时刻补登为 ${arrivalTime.replace("T", " ")}，重新核验`,
          before,
          after,
        },
      ],
    };
  });

  return result;
}

export function updateHealth(archive: Archive, ring: string, health: string): Archive {
  return updatePigeon(archive, ring, (p) => ({ ...p, health: health.trim() || p.health }));
}

// ---------- 示例档案 ----------

function localAt(base: string, hh: number, mm = 0): string {
  const date = base.slice(0, 10);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date}T${p(hh)}:${p(mm)}`;
}

/** 首次打开时的演示数据：有效、断档待补、未归巢、补回后转有效 四种情形各一 */
export function seedArchive(): Archive {
  const base = nowStamp();
  let archive: Archive = { pigeons: [] };
  const t = (hh: number, mm = 0) => localAt(base, hh, mm);

  // 1) 心跳连续，正常上榜
  archive = addFlight(
    archive,
    {
      ring: "CHN-24-001839",
      bloodline: "詹森系",
      health: "健康正常",
      card: "GK-1001839",
      site: "新乡放飞点",
      distance: 80,
      weather: "晴 · 顺风",
      releaseTime: t(8, 0),
      arrivalTime: t(9, 5),
      heartbeats: [
        { time: t(8, 12), card: "GK-1001839" },
        { time: t(8, 24), card: "GK-1001839" },
        { time: t(8, 37), card: "GK-1001839" },
        { time: t(8, 50), card: "GK-1001839" },
      ],
    },
    t(10, 12),
  );

  // 2) 流量卡到期，断档 45 分钟 → 待补，不占速度榜
  archive = addFlight(
    archive,
    {
      ring: "CHN-24-002114",
      bloodline: "凡龙系",
      health: "健康正常",
      card: "GK-1002114",
      site: "郑州放飞点",
      distance: 120,
      weather: "多云 · 侧风",
      releaseTime: t(8, 0),
      arrivalTime: t(9, 42),
      heartbeats: [{ time: t(8, 10), card: "GK-1002114" }, { time: t(9, 5), card: "GK-1002114" }],
    },
    t(10, 12),
  );

  // 3) 尚未归巢
  archive = addFlight(
    archive,
    {
      ring: "CHN-23-008771",
      bloodline: "胡本系",
      health: "状态良好",
      card: "GK-1008771",
      site: "邯郸放飞点",
      distance: 90,
      weather: "阴",
      releaseTime: t(8, 0),
      heartbeats: [
        { time: t(8, 14), card: "GK-1008771" },
        { time: t(8, 29), card: "GK-1008771" },
      ],
    },
    t(10, 12),
  );

  // 4) 先断档待补 → 换卡 + 补回中间心跳 → 连续有效，原结论留在履历
  archive = addFlight(
    archive,
    {
      ring: "CHN-24-003002",
      bloodline: "詹森系",
      health: "健康正常",
      card: "GK-1003002",
      site: "开封放飞点",
      distance: 100,
      weather: "晴 · 逆风",
      releaseTime: t(8, 0),
      arrivalTime: t(9, 25),
      heartbeats: [
        { time: t(8, 12), card: "GK-1003002" },
        { time: t(8, 50), card: "GK-1003002" }, // 与前点间隔 38 分钟，先判待补
      ],
    },
    t(10, 12),
  );
  const fly4 = archive.pigeons.find((p) => p.ring === "CHN-24-003002")!.flights[0].id;
  // 换卡与补录都发生在原始上报之后，履历时间按操作先后排列
  archive = changeCard(archive, "CHN-24-003002", fly4, "GK-2003002", t(10, 20));
  archive = addHeartbeat(archive, "CHN-24-003002", fly4, { time: t(8, 27), card: "GK-1003002" }, t(10, 35));
  archive = addHeartbeat(archive, "CHN-24-003002", fly4, { time: t(8, 42), card: "GK-2003002" }, t(10, 48));
  archive = addHeartbeat(archive, "CHN-24-003002", fly4, { time: t(9, 5), card: "GK-2003002" }, t(10, 55));
  archive = addHeartbeat(archive, "CHN-24-003002", fly4, { time: t(9, 15), card: "GK-2003002" }, t(11, 2));

  return { pigeons: archive.pigeons, savedAt: base };
}
