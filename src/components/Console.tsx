import { useEffect, useMemo, useState } from "react";
import type { Flight, Heartbeat, Pigeon } from "../lib/verification";
import {
  GAP_LIMIT_MIN,
  STATUS_LABEL,
  formatElapsed,
  formatTime,
  latestFlight,
  summarize,
  verifyFlight,
} from "../lib/verification";
import {
  addFlight,
  addHeartbeat,
  changeCard,
  loadArchive,
  registerArrival,
  resetArchive,
  saveArchive,
  updateHealth,
  type Archive,
} from "../lib/storage";

const ALL_BLOODLINES = "全部血统";

function parseHeartbeats(lines: string, releaseTime: string, defaultCard: string): Heartbeat[] {
  return lines
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [timePart, cardPart] = line.split(/\s+/);
      const time = timePart.length <= 5 ? `${releaseTime.slice(0, 10)}T${timePart}` : timePart;
      return { time, card: cardPart || defaultCard };
    });
}

function statusClass(status: string): string {
  return `badge badge-${status}`;
}

// ---------- 单条记录操作区：补心跳 / 换卡 / 补登到达，操作后立即重算 ----------

function FlightActions({
  archive,
  pigeon,
  flight,
  commit,
}: {
  archive: Archive;
  pigeon: Pigeon;
  flight: Flight;
  commit: (next: Archive) => void;
}) {
  const result = verifyFlight(flight);
  const [hbTime, setHbTime] = useState("");
  const [hbCard, setHbCard] = useState(pigeon.card);
  const [newCard, setNewCard] = useState("");
  const [arrival, setArrival] = useState("");

  return (
    <div className="actions">
      {result.status !== "valid" && (
        <div className="action-row">
          <label>
            <span>补回中间心跳时刻</span>
            <input type="datetime-local" value={hbTime} onChange={(e) => setHbTime(e.target.value)} />
          </label>
          <label className="grow">
            <span>心跳卡号（默认当前绑定卡）</span>
            <input value={hbCard} onChange={(e) => setHbCard(e.target.value)} placeholder={pigeon.card} />
          </label>
          <button
            className="primary"
            disabled={!hbTime}
            onClick={() => {
              if (!hbTime) return;
              commit(addHeartbeat(archive, pigeon.ring, flight.id, { time: hbTime, card: hbCard.trim() || pigeon.card }));
              setHbTime("");
            }}
          >
            补心跳并重算
          </button>
        </div>
      )}

      {result.status === "pending" && (
        <div className="action-row">
          <label className="grow">
            <span>换卡（流量卡到期 / 信号断档）</span>
            <input value={newCard} onChange={(e) => setNewCard(e.target.value)} placeholder="输入新鸽钟卡号" />
          </label>
          <button
            disabled={!newCard.trim()}
            onClick={() => {
              if (!newCard.trim()) return;
              commit(changeCard(archive, pigeon.ring, flight.id, newCard));
              setNewCard("");
            }}
          >
            确认换卡并重算
          </button>
        </div>
      )}

      {result.status === "out" && (
        <div className="action-row">
          <label>
            <span>补登到达时刻</span>
            <input type="datetime-local" value={arrival} onChange={(e) => setArrival(e.target.value)} />
          </label>
          <button
            className="primary"
            disabled={!arrival}
            onClick={() => {
              if (!arrival) return;
              commit(registerArrival(archive, pigeon.ring, flight.id, arrival));
              setArrival("");
            }}
          >
            确认归巢并重算
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- 一条上报记录卡（时间链 + 断档 + 履历） ----------

function FlightCard({
  archive,
  pigeon,
  flight,
  commit,
  compact,
}: {
  archive: Archive;
  pigeon: Pigeon;
  flight: Flight;
  commit: (next: Archive) => void;
  compact?: boolean;
}) {
  const result = verifyFlight(flight);
  const chain = [
    { label: "放飞", time: flight.releaseTime, card: "" },
    ...[...flight.heartbeats]
      .sort((a, b) => (a.time < b.time ? -1 : 1))
      .map((h) => ({ label: "心跳", time: h.time, card: h.card })),
    ...(flight.arrivalTime ? [{ label: "到达", time: flight.arrivalTime, card: "" }] : []),
  ];

  return (
    <article className={`flight-card status-${result.status}`}>
      <header className="flight-head">
        <div>
          <strong>
            {flight.site} · {flight.distance}km · {flight.weather}
          </strong>
          <span className={statusClass(result.status)}>{STATUS_LABEL[result.status]}</span>
        </div>
        <div className="flight-stats">
          <span>
            上报卡 <b>{pigeon.card}</b>
          </span>
          <span>
            心跳 <b>{result.heartbeatCount}</b> 次
          </span>
          <span>
            归巢用时 <b>{flight.arrivalTime ? formatElapsed(result.elapsedMin) : "未归巢"}</b>
          </span>
          <span>
            速度 <b>{result.speed ? `${Math.round(result.speed)} m/min` : "不计榜"}</b>
          </span>
        </div>
      </header>

      <ol className="chain">
        {chain.map((point, i) => {
          const next = chain[i + 1];
          const gapMin = next ? Math.round((new Date(next.time).getTime() - new Date(point.time).getTime()) / 60000) : 0;
          const broken = next !== undefined && gapMin > GAP_LIMIT_MIN;
          return (
            <li key={`${point.label}-${point.time}-${i}`} className={broken ? "chain-gap" : ""}>
              <span className="chain-dot" />
              <div>
                <strong>
                  {point.label} · {formatTime(point.time)}
                  {point.card && <em> {point.card}</em>}
                </strong>
                {next && (
                  <small className={broken ? "gap-text" : ""}>
                    {broken ? `断档 ${gapMin} 分钟（超 ${GAP_LIMIT_MIN} 分钟上限，列入待补）` : `间隔 ${gapMin} 分钟`}
                  </small>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <FlightActions archive={archive} pigeon={pigeon} flight={flight} commit={commit} />

      {!compact && flight.logs.length > 0 && (
        <details className="logs">
          <summary>核验履历（{flight.logs.length} 条，原记录保留）</summary>
          <ul>
            {flight.logs.map((log, i) => (
              <li key={`${log.time}-${log.action}-${i}`}>
                <time>{formatTime(log.time)}</time>
                <b>{log.action}</b>
                <span>{log.detail}</span>
                {log.before && log.after && (
                  <em className={log.before === log.after ? "" : "status-changed"}>
                    {STATUS_LABEL[log.before]} → {STATUS_LABEL[log.after]}
                  </em>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

// ---------- 新增上报表单 ----------

function FlightForm({ archive, commit }: { archive: Archive; commit: (next: Archive) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    ring: "",
    bloodline: "",
    health: "健康正常",
    card: "",
    site: "",
    distance: "80",
    weather: "晴",
    releaseTime: `${today}T08:00`,
    arrivalTime: "",
    heartbeatLines: "",
  });
  const [error, setError] = useState("");
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    const distance = Number(form.distance);
    if (!form.ring.trim() || !form.card.trim() || !form.site.trim() || !form.releaseTime) {
      setError("足环号、卡号、训放地点和放飞时刻为必填");
      return;
    }
    if (!Number.isFinite(distance) || distance <= 0) {
      setError("放飞距离需为正数");
      return;
    }
    const heartbeats = parseHeartbeats(form.heartbeatLines, form.releaseTime, form.card.trim());
    commit(
      addFlight(
        archive,
        {
          ring: form.ring,
          bloodline: form.bloodline,
          health: form.health,
          card: form.card,
          site: form.site,
          distance,
          weather: form.weather,
          releaseTime: form.releaseTime,
          arrivalTime: form.arrivalTime || undefined,
          heartbeats,
        },
      ),
    );
    setError("");
    setForm((f) => ({
      ...f,
      ring: "",
      bloodline: "",
      card: "",
      site: "",
      distance: "80",
      arrivalTime: "",
      heartbeatLines: "",
    }));
  };

  return (
    <section className="panel form-panel">
      <div className="heading">
        <div>
          <p>鸽钟上报</p>
          <h2>新增上报记录</h2>
        </div>
        <button className="primary" onClick={submit}>
          保存并核验
        </button>
      </div>
      <div className="field-grid">
        <label>
          <span>足环号 *</span>
          <input value={form.ring} onChange={(e) => set("ring", e.target.value)} placeholder="CHN-24-xxxxxx" />
        </label>
        <label>
          <span>绑定卡号 *</span>
          <input value={form.card} onChange={(e) => set("card", e.target.value)} placeholder="GK-xxxxxxx" />
        </label>
        <label>
          <span>血统</span>
          <input value={form.bloodline} onChange={(e) => set("bloodline", e.target.value)} placeholder="如 詹森系" />
        </label>
        <label>
          <span>健康状态</span>
          <input value={form.health} onChange={(e) => set("health", e.target.value)} />
        </label>
        <label>
          <span>训放地点 *</span>
          <input value={form.site} onChange={(e) => set("site", e.target.value)} placeholder="如 新乡放飞点" />
        </label>
        <label>
          <span>放飞距离 km *</span>
          <input type="number" min="1" value={form.distance} onChange={(e) => set("distance", e.target.value)} />
        </label>
        <label>
          <span>天气</span>
          <input value={form.weather} onChange={(e) => set("weather", e.target.value)} />
        </label>
        <label>
          <span>放飞时刻 *</span>
          <input type="datetime-local" value={form.releaseTime} onChange={(e) => set("releaseTime", e.target.value)} />
        </label>
        <label>
          <span>到达时刻（未归巢留空）</span>
          <input type="datetime-local" value={form.arrivalTime} onChange={(e) => set("arrivalTime", e.target.value)} />
        </label>
        <label className="span-2">
          <span>心跳时刻，每行一次；可只填 08:12，或 08:12 GK-卡号 标注换卡后的心跳</span>
          <textarea
            rows={3}
            value={form.heartbeatLines}
            onChange={(e) => set("heartbeatLines", e.target.value)}
            placeholder={"08:12\n08:27 GK-2003002"}
          />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// ---------- 主控制台 ----------

export default function Console() {
  const [archive, setArchive] = useState<Archive>(() => loadArchive());
  const [bloodline, setBloodline] = useState<string>(ALL_BLOODLINES);

  // 本地保存：任何变更后写入 localStorage，重开页面仍能看到
  useEffect(() => {
    saveArchive(archive);
  }, [archive]);

  const commit = (next: Archive) => setArchive(next);

  const bloodlines = useMemo(
    () => Array.from(new Set(archive.pigeons.map((p) => p.bloodline))),
    [archive.pigeons],
  );

  const summary = useMemo(() => summarize(archive.pigeons), [archive.pigeons]);

  // 各面板统一跟随当前核验结果
  const ranked = useMemo(() => {
    return archive.pigeons
      .map((p) => ({ pigeon: p, flight: latestFlight(p) }))
      .filter((x): x is { pigeon: Pigeon; flight: Flight } => Boolean(x.flight))
      .filter((x) => verifyFlight(x.flight).status === "valid")
      .filter((x) => bloodline === ALL_BLOODLINES || x.pigeon.bloodline === bloodline)
      .sort((a, b) => (verifyFlight(b.flight).speed ?? 0) - (verifyFlight(a.flight).speed ?? 0));
  }, [archive.pigeons, bloodline]);

  const pending = useMemo(() => {
    const rows: { pigeon: Pigeon; flight: Flight }[] = [];
    for (const pigeon of archive.pigeons) {
      for (const flight of pigeon.flights) {
        if (verifyFlight(flight).status === "pending") rows.push({ pigeon, flight });
      }
    }
    return rows.filter((x) => bloodline === ALL_BLOODLINES || x.pigeon.bloodline === bloodline);
  }, [archive.pigeons, bloodline]);

  const outList = useMemo(() => {
    return archive.pigeons
      .map((p) => ({ pigeon: p, flight: latestFlight(p) }))
      .filter((x): x is { pigeon: Pigeon; flight: Flight } => Boolean(x.flight))
      .filter((x) => verifyFlight(x.flight).status === "out")
      .filter((x) => bloodline === ALL_BLOODLINES || x.pigeon.bloodline === bloodline)
      .sort((a, b) => (a.flight.releaseTime < b.flight.releaseTime ? 1 : -1));
  }, [archive.pigeons, bloodline]);

  const visiblePigeons = useMemo(
    () => archive.pigeons.filter((p) => bloodline === ALL_BLOODLINES || p.bloodline === bloodline),
    [archive.pigeons, bloodline],
  );

  return (
    <main className="app">
      <section className="hero">
        <p>鸽钟流量卡 · 上报连续性核验台</p>
        <h1>赛鸽归巢核验</h1>
        <span>
          每羽绑定鸽钟卡号、心跳时刻与到达时刻；放飞至到达之间任一心跳间隔超过
          {GAP_LIMIT_MIN} 分钟即判定信号断档，记录列入待补、不占速度榜。补回中间心跳或换卡后自动重算，
          原结论完整保留在核验履历中。所有档案保存在本机浏览器，重开页面仍可查看。
        </span>
        <small className="saved-at">
          最近本地保存：{archive.savedAt ? formatTime(archive.savedAt) : "尚未保存"}
          <button onClick={() => commit(resetArchive())}>恢复示例档案</button>
        </small>
      </section>

      <section className="metrics">
        <article>
          <small>归巢率（含待补）</small>
          <strong>{summary.returnRate}%</strong>
          <small>
            已归巢 {summary.arrived} / 在棚 {summary.total}
          </small>
        </article>
        <article>
          <small>平均速度（仅连续有效）</small>
          <strong>{summary.avgSpeed ? `${summary.avgSpeed}` : "—"}</strong>
          <small>m/min · {summary.validCount} 羽有效</small>
        </article>
        <article className="metric-pending">
          <small>待补核验（不占榜）</small>
          <strong>{summary.pendingCount}</strong>
          <small>断档超 {GAP_LIMIT_MIN} 分钟</small>
        </article>
        <article className="metric-out">
          <small>尚未归巢提醒</small>
          <strong>{summary.outCount}</strong>
          <small>血统档案 {summary.bloodlineCount} 系</small>
        </article>
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>血统筛选</h2>
          <p className="hint">总览、榜单、待补与未归巢提醒均跟随当前筛选与核验结果</p>
          <div className="chips">
            {[ALL_BLOODLINES, ...bloodlines].map((name) => (
              <button
                key={name}
                className={bloodline === name ? "chip-on" : ""}
                onClick={() => setBloodline(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </aside>

        <FlightForm archive={archive} commit={commit} />
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>速度榜</p>
            <h2>连续有效成绩排行</h2>
          </div>
          <span className="hint">待补记录不出现，补回后按重算速度自动上榜</span>
        </div>
        <div className="rank-list">
          {ranked.length === 0 && <p className="empty">当前筛选下没有连续有效的上榜记录</p>}
          {ranked.map(({ pigeon, flight }, index) => {
            const result = verifyFlight(flight);
            return (
              <article key={flight.id} className="rank-row">
                <b>{String(index + 1).padStart(2, "0")}</b>
                <div>
                  <h3>
                    {pigeon.ring} · {pigeon.bloodline}
                  </h3>
                  <p>
                    {flight.site} {flight.distance}km · 用时 {formatElapsed(result.elapsedMin)} ·{" "}
                    {result.speed ? Math.round(result.speed) : 0} m/min · 卡 {pigeon.card}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel panel-pending">
        <div className="heading">
          <div>
            <p>断档待补</p>
            <h2>待补核验队列（{pending.length}）</h2>
          </div>
          <span className="hint">补心跳或换卡后在此直接重算，原记录进入履历</span>
        </div>
        <div className="flight-stack">
          {pending.length === 0 && <p className="empty">没有待补记录，所有已归巢上报心跳连续</p>}
          {pending.map(({ pigeon, flight }) => (
            <FlightCard
              key={flight.id}
              archive={archive}
              pigeon={pigeon}
              flight={flight}
              commit={commit}
            />
          ))}
        </div>
      </section>

      <section className="panel panel-out">
        <div className="heading">
          <div>
            <p>未归巢提醒</p>
            <h2>等待归巢（{outList.length}）</h2>
          </div>
          <span className="hint">补登到达时刻后立即核验，存在断档则转入待补</span>
        </div>
        <div className="flight-stack">
          {outList.length === 0 && <p className="empty">当前筛选下鸽子均已归巢</p>}
          {outList.map(({ pigeon, flight }) => (
            <FlightCard
              key={flight.id}
              archive={archive}
              pigeon={pigeon}
              flight={flight}
              commit={commit}
              compact
            />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>单羽档案</p>
            <h2>赛鸽档案与全部上报履历（{visiblePigeons.length}）</h2>
          </div>
        </div>
        <div className="archive-list">
          {visiblePigeons.length === 0 && <p className="empty">当前筛选下无档案</p>}
          {visiblePigeons.map((pigeon) => {
            const current = latestFlight(pigeon);
            const currentStatus = current ? verifyFlight(current).status : "out";
            return (
              <article key={pigeon.ring} className="pigeon-card">
                <header>
                  <div>
                    <h3>{pigeon.ring}</h3>
                    <p>
                      {pigeon.bloodline} · 卡 {pigeon.card} ·{" "}
                      <span className={statusClass(currentStatus)}>{current ? STATUS_LABEL[currentStatus] : "无记录"}</span>
                    </p>
                  </div>
                  <div className="health-edit">
                    <input
                      value={pigeon.health}
                      onChange={(e) => commit(updateHealth(archive, pigeon.ring, e.target.value))}
                      aria-label="健康状态"
                    />
                  </div>
                </header>
                <details className="card-logs">
                  <summary>绑卡履历（{pigeon.cardLogs.length}）</summary>
                  <ul>
                    {pigeon.cardLogs.map((log, i) => (
                      <li key={`${log.time}-${i}`}>
                        <time>{formatTime(log.time)}</time>
                        <b>{log.action}</b>
                        <span>{log.detail}</span>
                      </li>
                    ))}
                  </ul>
                </details>
                <div className="flight-stack">
                  {[...pigeon.flights].reverse().map((flight) => (
                    <FlightCard
                      key={flight.id}
                      archive={archive}
                      pigeon={pigeon}
                      flight={flight}
                      commit={commit}
                    />
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
