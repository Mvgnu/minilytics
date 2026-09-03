"use client";

import { useMemo, useState } from "react";

type Point = { point: string; label: string; visitors: number; sessions: number };

export function TrafficChart({ data }: { data: Point[] }) {
  const [showVisitors, setShowVisitors] = useState(true);
  const [showSessions, setShowSessions] = useState(true);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const width = 1000;
  const height = 280;
  const left = 42;
  const right = 18;
  const top = 20;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  const max = useMemo(() => {
    const values = data.flatMap((point) => [showVisitors ? point.visitors : 0, showSessions ? point.sessions : 0]);
    return Math.max(1, ...values);
  }, [data, showVisitors, showSessions]);

  const coords = useMemo(() => data.map((point, index) => {
    const x = data.length <= 1 ? left + plotWidth / 2 : left + (index / (data.length - 1)) * plotWidth;
    const visitorY = top + plotHeight - (point.visitors / max) * plotHeight;
    const sessionY = top + plotHeight - (point.sessions / max) * plotHeight;
    return { x, visitorY, sessionY };
  }), [data, max, plotHeight, plotWidth]);

  function pathFor(key: "visitorY" | "sessionY") {
    return coords.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point[key].toFixed(2)}`).join(" ");
  }

  function toggle(which: "visitors" | "sessions") {
    if (which === "visitors") {
      if (showVisitors && !showSessions) return;
      setShowVisitors((value) => !value);
    } else {
      if (showSessions && !showVisitors) return;
      setShowSessions((value) => !value);
    }
  }

  const active = activeIndex === null ? null : data[activeIndex];
  const activeCoord = activeIndex === null ? null : coords[activeIndex];

  return (
    <div className="trafficChartWrap">
      <div className="seriesChips" role="group" aria-label="Traffic series">
        <button type="button" className={`seriesChip visitors ${showVisitors ? "active" : ""}`} aria-pressed={showVisitors} onClick={() => toggle("visitors")}>
          <span /> Visitors
        </button>
        <button type="button" className={`seriesChip sessions ${showSessions ? "active" : ""}`} aria-pressed={showSessions} onClick={() => toggle("sessions")}>
          <span /> Sessions
        </button>
      </div>

      <div className="lineChart" onMouseLeave={() => setActiveIndex(null)}>
        {active && activeCoord ? (
          <div className="chartTooltip" style={{ left: `${(activeCoord.x / width) * 100}%` }}>
            <strong>{active.label}</strong>
            <span>Visitors <b>{active.visitors}</b></span>
            <span>Sessions <b>{active.sessions}</b></span>
          </div>
        ) : null}
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Visitors and sessions over time" preserveAspectRatio="none">
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = top + ratio * plotHeight;
            return <line key={ratio} x1={left} x2={width - right} y1={y} y2={y} className="chartGridLine" />;
          })}
          {showVisitors ? <path d={pathFor("visitorY")} className="chartLine visitorLine" /> : null}
          {showSessions ? <path d={pathFor("sessionY")} className="chartLine sessionLine" /> : null}
          {activeCoord ? <line x1={activeCoord.x} x2={activeCoord.x} y1={top} y2={height - bottom} className="chartCrosshair" /> : null}
          {coords.map((point, index) => (
            <g key={data[index]?.point ?? index}>
              <circle
                cx={point.x}
                cy={showVisitors ? point.visitorY : point.sessionY}
                r="18"
                className="chartHitTarget"
                onPointerEnter={() => setActiveIndex(index)}
                onPointerDown={() => setActiveIndex(index)}
                onClick={() => setActiveIndex(index)}
              />
              {showVisitors ? <circle cx={point.x} cy={point.visitorY} r={activeIndex === index ? 5 : 3.2} className="chartDot visitorDot" /> : null}
              {showSessions ? <circle cx={point.x} cy={point.sessionY} r={activeIndex === index ? 5 : 3.2} className="chartDot sessionDot" /> : null}
            </g>
          ))}
          <text x={left} y={height - 8} className="chartAxisLabel">{data[0]?.label ?? ""}</text>
          <text x={width - right} y={height - 8} textAnchor="end" className="chartAxisLabel">{data.at(-1)?.label ?? ""}</text>
        </svg>
      </div>
    </div>
  );
}
