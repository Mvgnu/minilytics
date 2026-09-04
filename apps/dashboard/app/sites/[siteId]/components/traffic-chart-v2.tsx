"use client";

import { useMemo, useState } from "react";
import styles from "./analytics-v2.module.css";

type Point = {
  point: string;
  label: string;
  visitors: number;
  sessions: number;
};

type ChartPointer = {
  clientX: number;
  currentTarget: SVGSVGElement;
};

function change(current: number, previous: number) {
  if (!previous) return current ? "new" : "0%";
  const value = ((current - previous) / previous) * 100;
  const sign = value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("en", {
    maximumFractionDigits: 1,
  }).format(value)}%`;
}

export function TrafficChartV2({
  data,
  comparison,
  comparisonLabel,
}: {
  data: Point[];
  comparison: Point[];
  comparisonLabel: string;
}) {
  const [showVisitors, setShowVisitors] = useState(true);
  const [showSessions, setShowSessions] = useState(true);
  const [showComparison, setShowComparison] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const width = 1000;
  const height = 300;
  const left = 42;
  const right = 18;
  const top = 22;
  const bottom = 36;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  const max = useMemo(() => {
    const values = data.flatMap((point) => [
      showVisitors ? point.visitors : 0,
      showSessions ? point.sessions : 0,
    ]);
    if (showComparison) {
      for (const point of comparison) {
        if (showVisitors) values.push(point.visitors);
        if (showSessions) values.push(point.sessions);
      }
    }
    return Math.max(1, ...values);
  }, [comparison, data, showComparison, showSessions, showVisitors]);

  const coords = useMemo(
    () =>
      data.map((point, index) => {
        const x =
          data.length <= 1
            ? left + plotWidth / 2
            : left + (index / (data.length - 1)) * plotWidth;
        return {
          x,
          visitorY: top + plotHeight - (point.visitors / max) * plotHeight,
          sessionY: top + plotHeight - (point.sessions / max) * plotHeight,
        };
      }),
    [data, max, plotHeight, plotWidth],
  );

  const comparisonCoords = useMemo(
    () =>
      comparison.map((point, index) => {
        const x =
          data.length <= 1
            ? left + plotWidth / 2
            : left + (index / Math.max(1, data.length - 1)) * plotWidth;
        return {
          x,
          visitorY: top + plotHeight - (point.visitors / max) * plotHeight,
          sessionY: top + plotHeight - (point.sessions / max) * plotHeight,
        };
      }),
    [comparison, data.length, max, plotHeight, plotWidth],
  );

  function pathFor(
    points: Array<{ x: number; visitorY: number; sessionY: number }>,
    key: "visitorY" | "sessionY",
  ) {
    return points
      .map(
        (point, index) =>
          `${index ? "L" : "M"}${point.x.toFixed(2)} ${point[key].toFixed(2)}`,
      )
      .join(" ");
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

  function selectNearest(event: ChartPointer) {
    if (!data.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)),
    );
    setActiveIndex(Math.round(ratio * Math.max(0, data.length - 1)));
  }

  const active = activeIndex === null ? null : data[activeIndex];
  const previous = activeIndex === null ? null : comparison[activeIndex];
  const activeCoord = activeIndex === null ? null : coords[activeIndex];

  return (
    <div className={styles.trafficChartWrap}>
      <div className={styles.seriesChips} role="group" aria-label="Traffic series">
        <button
          type="button"
          className={`${styles.seriesChip} ${styles.visitorChip} ${showVisitors ? styles.active : ""}`}
          aria-pressed={showVisitors}
          onClick={() => toggle("visitors")}
        >
          <span /> Visitors
        </button>
        <button
          type="button"
          className={`${styles.seriesChip} ${styles.sessionChip} ${showSessions ? styles.active : ""}`}
          aria-pressed={showSessions}
          onClick={() => toggle("sessions")}
        >
          <span /> Sessions
        </button>
        <button
          type="button"
          className={`${styles.seriesChip} ${styles.compareChip} ${showComparison ? styles.active : ""}`}
          aria-pressed={showComparison}
          onClick={() => setShowComparison((value) => !value)}
        >
          <span /> Compare previous period
        </button>
      </div>

      <div className={styles.lineChart}>
        {active && activeCoord ? (
          <div
            className={styles.chartTooltip}
            style={{ left: `${(activeCoord.x / width) * 100}%` }}
          >
            <strong>{active.label}</strong>
            {showVisitors ? (
              <span>
                Visitors <b>{active.visitors}</b>
                {showComparison && previous ? (
                  <small>
                    {previous.visitors} previous · {change(active.visitors, previous.visitors)}
                  </small>
                ) : null}
              </span>
            ) : null}
            {showSessions ? (
              <span>
                Sessions <b>{active.sessions}</b>
                {showComparison && previous ? (
                  <small>
                    {previous.sessions} previous · {change(active.sessions, previous.sessions)}
                  </small>
                ) : null}
              </span>
            ) : null}
            {showComparison && previous ? (
              <em>
                {comparisonLabel} · {previous.label}
              </em>
            ) : null}
          </div>
        ) : null}

        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Visitors and sessions over time"
          preserveAspectRatio="none"
          onPointerMove={selectNearest}
          onPointerDown={selectNearest}
          onClick={selectNearest}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") setActiveIndex(null);
          }}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = top + ratio * plotHeight;
            return (
              <line
                key={ratio}
                x1={left}
                x2={width - right}
                y1={y}
                y2={y}
                className={styles.chartGridLine}
              />
            );
          })}

          {showComparison && showVisitors ? (
            <path
              d={pathFor(comparisonCoords, "visitorY")}
              className={`${styles.chartLine} ${styles.previousVisitorLine}`}
            />
          ) : null}
          {showComparison && showSessions ? (
            <path
              d={pathFor(comparisonCoords, "sessionY")}
              className={`${styles.chartLine} ${styles.previousSessionLine}`}
            />
          ) : null}
          {showVisitors ? (
            <path
              d={pathFor(coords, "visitorY")}
              className={`${styles.chartLine} ${styles.visitorLine}`}
            />
          ) : null}
          {showSessions ? (
            <path
              d={pathFor(coords, "sessionY")}
              className={`${styles.chartLine} ${styles.sessionLine}`}
            />
          ) : null}

          {activeCoord ? (
            <line
              x1={activeCoord.x}
              x2={activeCoord.x}
              y1={top}
              y2={height - bottom}
              className={styles.chartCrosshair}
            />
          ) : null}

          {coords.map((point, index) => (
            <g key={data[index]?.point ?? index}>
              {showVisitors ? (
                <circle
                  cx={point.x}
                  cy={point.visitorY}
                  r={activeIndex === index ? 5 : 3.2}
                  className={`${styles.chartDot} ${styles.visitorDot}`}
                />
              ) : null}
              {showSessions ? (
                <circle
                  cx={point.x}
                  cy={point.sessionY}
                  r={activeIndex === index ? 5 : 3.2}
                  className={`${styles.chartDot} ${styles.sessionDot}`}
                />
              ) : null}
            </g>
          ))}

          <rect
            x={left}
            y={top}
            width={plotWidth}
            height={plotHeight}
            className={styles.chartHitArea}
          />
          <text x={left} y={height - 8} className={styles.chartAxisLabel}>
            {data[0]?.label ?? ""}
          </text>
          <text
            x={width - right}
            y={height - 8}
            textAnchor="end"
            className={styles.chartAxisLabel}
          >
            {data.at(-1)?.label ?? ""}
          </text>
        </svg>
      </div>
    </div>
  );
}
