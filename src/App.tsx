// 界面：核验台各面板，全部数据来自 verification 规则 + storage 档案

import { useMemo, useState } from "react";
import "./styles.css";
import {
  GAP_LIMIT_MINUTES,
  verifyFlight,
  formatClock,
  formatGap,
  formatSpeed,
  type Flight,
} from "./verification";
import {
  loadFlights,
  saveFlights,
  supplementHeartbeat,
  changeCard,
} from "./storage";

const STATUS_CLASS: Record<string, string> = {
  有效: "ok",
  待补: "pending",
  未归巢: "missing",
};

function toLocalInput(iso: string): string {
  return iso.slice(0, 16);
}

function App() {
  const [flights, setFlights] = useState<Flight[]>(loadFlights);
  const [bloodline, setBloodline] = useState("全部");
  const [beatDrafts, setBeatDrafts] = useState<Record<string, string>>({});
  const [cardDrafts, setCardDrafts] = useState<Record<string, string>>({});
  const [cardTimeDrafts, setCardTimeDrafts] = useState<Record<string, string>>(
    {}
  );

  const update = (next: Flight[]) => {
    setFlights(next);
    saveFlights(next);
  };

  const patch = (id: string, fn: (f: Flight) => Flight) =>
    update(flights.map((f) => (f.id === id ? fn(f) : f)));

  const verified = useMemo(
    () => flights.map((flight) => ({ flight, v: verifyFlight(flight) })),
    [flights]
  );

  const bloodlines = useMemo(
    () => ["全部", ...new Set(flights.map((f) => f.bloodline))],
    [flights]
  );

  const filtered = verified.filter(
    (x) => bloodline === "全部" || x.flight.bloodline === bloodline
  );
  const ranked = filtered
    .filter((x) => x.v.status === "有效")
    .sort((a, b) => (b.v.speedMpm ?? 0) - (a.v.speedMpm ?? 0));
  const pending = filtered.filter((x) => x.v.status === "待补");
  const missing = filtered.filter((x) => x.v.status === "未归巢");

  const arrived = filtered.filter((x) => x.flight.arrivalTime).length;
  const homeRate = filtered.length
    ? Math.round((arrived / filtered.length) * 100)
    : 0;
  const avgSpeed = ranked.length
    ? ranked.reduce((sum, x) => sum + (x.v.speedMpm ?? 0), 0) / ranked.length
    : null;

  const submitHeartbeat = (flight: Flight) => {
    const time = beatDrafts[flight.id];
    if (!time) return;
    if (time <= flight.releaseTime || (flight.arrivalTime && time >= flight.arrivalTime)) {
      window.alert("补登心跳须落在放飞与到达时刻之间");
      return;
    }
    patch(flight.id, (f) => supplementHeartbeat(f, time));
    setBeatDrafts((d) => ({ ...d, [flight.id]: "" }));
  };

  const submitCard = (flight: Flight) => {
    const nextCard = (cardDrafts[flight.id] ?? "").trim();
    const effectiveAt = cardTimeDrafts[flight.id];
    if (!nextCard || !effectiveAt) return;
    if (nextCard === flight.cardNo) {
      window.alert("新卡号与当前卡号相同，无需换卡");
      return;
    }
    patch(flight.id, (f) => changeCard(f, nextCard, effectiveAt));
    setCardDrafts((d) => ({ ...d, [flight.id]: "" }));
  };

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62014 · 上报连续性核验台 · 断档阈值 {GAP_LIMIT_MINUTES} 分钟</p>
        <h1>鸽钟流量卡核验台</h1>
        <span>
          每羽赛鸽绑定流量卡号，放飞时刻、心跳上报与到达时刻连成上报链；相邻上报断档超过
          {GAP_LIMIT_MINUTES} 分钟的成绩先列入待补、不占速度榜，补回中间心跳或换卡后自动重算，
          原记录保留在履历中。鸽棚总览、未归巢提醒与血统筛选均跟随当前核验结果，数据本地保存。
        </span>
      </section>

      <section className="metrics">
        <article>
          <small>归巢率（{bloodline}）</small>
          <strong>{homeRate}%</strong>
        </article>
        <article>
          <small>有效平均速度</small>
          <strong>{avgSpeed === null ? "—" : `${Math.round(avgSpeed)}`}</strong>
        </article>
        <article>
          <small>待补核验</small>
          <strong>{pending.length}</strong>
        </article>
        <article>
          <small>未归巢</small>
          <strong>{missing.length}</strong>
        </article>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>血统筛选</p>
            <h2>按血统查看当前核验结果</h2>
          </div>
        </div>
        <div className="chips">
          {bloodlines.map((b) => (
            <button
              key={b}
              className={b === bloodline ? "chip-active" : ""}
              onClick={() => setBloodline(b)}
            >
              {b}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>速度榜</p>
            <h2>有效成绩排名（待补不占榜）</h2>
          </div>
        </div>
        {ranked.length === 0 && <p className="empty">当前筛选下暂无有效成绩。</p>}
        <div className="records">
          {ranked.map((x, i) => (
            <article key={x.flight.id}>
              <b>{String(i + 1).padStart(2, "0")}</b>
              <div>
                <h3>
                  {x.flight.ringNo}
                  <span className="tag">{x.flight.bloodline}</span>
                </h3>
                <p>
                  {x.flight.releasePlace} · {x.flight.distanceKm}km · 到达{" "}
                  {formatClock(x.flight.arrivalTime)} · 分速{" "}
                  {formatSpeed(x.v.speedMpm)} · 卡号 {x.flight.cardNo}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>待补核验</p>
            <h2>断档超过 {GAP_LIMIT_MINUTES} 分钟，暂不占榜</h2>
          </div>
        </div>
        {pending.length === 0 && <p className="empty">当前筛选下没有待补记录。</p>}
        <div className="records">
          {pending.map((x) => (
            <article key={x.flight.id} className="pending-card">
              <b>补</b>
              <div>
                <h3>
                  {x.flight.ringNo}
                  <span className="tag">{x.flight.bloodline}</span>
                  <span className={`badge ${STATUS_CLASS[x.v.status]}`}>
                    {x.v.status}
                  </span>
                </h3>
                <p>
                  卡号 {x.flight.cardNo} · 到达 {formatClock(x.flight.arrivalTime)} ·
                  最长断档 {formatGap(x.v.maxGapMinutes)}（
                  {formatClock(x.v.gapStart)} – {formatClock(x.v.gapEnd)}）· 若有效分速{" "}
                  {formatSpeed(x.v.speedMpm)}
                </p>
                <div className="fix-row">
                  <label>
                    <span>补登心跳时刻</span>
                    <input
                      type="datetime-local"
                      value={
                        beatDrafts[x.flight.id] ??
                        (x.v.gapStart ? toLocalInput(x.v.gapStart) : "")
                      }
                      onChange={(e) =>
                        setBeatDrafts((d) => ({
                          ...d,
                          [x.flight.id]: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <button
                    className="primary"
                    onClick={() => submitHeartbeat(x.flight)}
                  >
                    补登并重算
                  </button>
                </div>
                <div className="fix-row">
                  <label>
                    <span>新卡号</span>
                    <input
                      placeholder="填写新流量卡号"
                      value={cardDrafts[x.flight.id] ?? ""}
                      onChange={(e) =>
                        setCardDrafts((d) => ({
                          ...d,
                          [x.flight.id]: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>换卡生效时刻</span>
                    <input
                      type="datetime-local"
                      value={
                        cardTimeDrafts[x.flight.id] ??
                        (x.v.gapEnd ? toLocalInput(x.v.gapEnd) : "")
                      }
                      onChange={(e) =>
                        setCardTimeDrafts((d) => ({
                          ...d,
                          [x.flight.id]: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <button onClick={() => submitCard(x.flight)}>换卡重算</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>未归巢提醒</p>
            <h2>尚未收到到达上报</h2>
          </div>
        </div>
        {missing.length === 0 && <p className="empty">当前筛选下全部归巢。</p>}
        <div className="records">
          {missing.map((x) => (
            <article key={x.flight.id}>
              <b>未</b>
              <div>
                <h3>
                  {x.flight.ringNo}
                  <span className="tag">{x.flight.bloodline}</span>
                  <span className={`badge ${STATUS_CLASS[x.v.status]}`}>
                    {x.v.status}
                  </span>
                </h3>
                <p>
                  {x.flight.releasePlace} · {x.flight.distanceKm}km · 放飞{" "}
                  {formatClock(x.flight.releaseTime)} · 最后心跳{" "}
                  {formatClock(
                    x.flight.heartbeats.length
                      ? x.flight.heartbeats[x.flight.heartbeats.length - 1].time
                      : null
                  )}{" "}
                  · 卡号 {x.flight.cardNo}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>鸽棚总览</p>
            <h2>全棚核验状态与履历</h2>
          </div>
        </div>
        <div className="records">
          {filtered.map((x) => (
            <article key={x.flight.id}>
              <b>{x.flight.ringNo.slice(-2)}</b>
              <div>
                <h3>
                  {x.flight.ringNo}
                  <span className="tag">{x.flight.bloodline}</span>
                  <span className={`badge ${STATUS_CLASS[x.v.status]}`}>
                    {x.v.status}
                  </span>
                </h3>
                <p>
                  卡号 {x.flight.cardNo} · 心跳 {x.flight.heartbeats.length} 条 ·
                  到达 {formatClock(x.flight.arrivalTime)} · 最长断档{" "}
                  {formatGap(x.v.maxGapMinutes)} · 分速 {formatSpeed(x.v.speedMpm)}
                </p>
                {x.flight.history.length > 0 && (
                  <ul className="history">
                    {x.flight.history.map((h, i) => (
                      <li key={`${h.revisedAt}-${i}`}>
                        <em>{h.action}</em> · {h.detail}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
