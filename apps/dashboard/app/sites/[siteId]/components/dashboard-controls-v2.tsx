"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import styles from "./analytics-v2.module.css";

type Range = {
  preset: string;
  fromInput: string;
  toInput: string;
  label: string;
};
type Filters = {
  source: string;
  landing: string;
  exit: string;
  keyEvent: string;
};
type FilterOptions = {
  sources: Array<{
    value: string;
    count: number;
    source: string;
    medium: string;
    detail: string | null;
  }>;
  landings: Array<{ value: string; count: number }>;
  exits: Array<{ value: string; count: number }>;
  keyEvents: string[];
};

const PRESETS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["mtd", "Month to date"],
  ["90d", "Last 90 days"],
  ["custom", "Custom range"],
] as const;

function sourceLabel(value: string) {
  const [source, detail] = value.split("|", 2);
  return detail ? `${source} · ${detail}` : source;
}

export function DashboardControlsV2({
  range,
  filters,
  options,
}: {
  range: Range;
  filters: Filters;
  options: FilterOptions;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [customFrom, setCustomFrom] = useState(range.fromInput);
  const [customTo, setCustomTo] = useState(range.toInput);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCustomFrom(range.fromInput);
    setCustomTo(range.toInput);
  }, [range.fromInput, range.toInput]);

  const params = useMemo(
    () => new URLSearchParams(searchParams.toString()),
    [searchParams],
  );

  function navigate(update: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(update)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (resetPage) next.delete("page");
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function setPreset(value: string) {
    if (value === "custom") {
      navigate({ range: "custom", from: customFrom, to: customTo });
      return;
    }
    navigate({ range: value, from: null, to: null });
  }

  function applyCustom() {
    if (!customFrom || !customTo || customFrom > customTo) return;
    navigate({ range: "custom", from: customFrom, to: customTo });
  }

  function clearFilters() {
    navigate({ source: null, landing: null, exit: null, keyEvent: null });
  }

  async function copyView() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const activeFilters = [
    filters.source
      ? { key: "source", label: `Source: ${sourceLabel(filters.source)}` }
      : null,
    filters.landing
      ? { key: "landing", label: `Landing: ${filters.landing}` }
      : null,
    filters.exit ? { key: "exit", label: `Exit: ${filters.exit}` } : null,
    filters.keyEvent
      ? {
          key: "keyEvent",
          label:
            filters.keyEvent === "yes"
              ? "Has key event"
              : filters.keyEvent === "no"
                ? "No key event"
                : `Key event: ${filters.keyEvent.replace(/^event:/, "")}`,
        }
      : null,
  ].filter((value): value is { key: string; label: string } => Boolean(value));

  return (
    <section className={styles.controlDeck} aria-label="Analytics controls">
      <div className={styles.controlTop}>
        <div className={styles.rangeGroup}>
          <label>
            <span>Period</span>
            <select
              value={range.preset}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setPreset(event.target.value)
              }
              aria-label="Date range"
            >
              {PRESETS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          {range.preset === "custom" ? (
            <div className={styles.customDates}>
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setCustomFrom(event.target.value)
                }
                aria-label="From date"
              />
              <span>→</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setCustomTo(event.target.value)
                }
                aria-label="To date"
              />
              <button type="button" onClick={applyCustom}>
                Apply
              </button>
            </div>
          ) : null}
        </div>

        <button type="button" className={styles.copyButton} onClick={copyView}>
          {copied ? "Copied" : "Copy view"}
        </button>
      </div>

      <div className={styles.filterGrid}>
        <label>
          <span>Source</span>
          <select
            value={filters.source}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              navigate({ source: event.target.value || null })
            }
          >
            <option value="">All sources</option>
            {options.sources.map((option) => (
              <option key={option.value} value={option.value}>
                {option.source}
                {option.detail ? ` · ${option.detail}` : ""}
                {option.medium && option.medium !== option.source
                  ? ` / ${option.medium}`
                  : ""}{" "}
                ({option.count})
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Landing page</span>
          <select
            value={filters.landing}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              navigate({ landing: event.target.value || null })
            }
          >
            <option value="">All landing pages</option>
            {options.landings.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value} ({option.count})
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Exit page</span>
          <select
            value={filters.exit}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              navigate({ exit: event.target.value || null })
            }
          >
            <option value="">All exit pages</option>
            {options.exits.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value} ({option.count})
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Key event</span>
          <select
            value={filters.keyEvent}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              navigate({ keyEvent: event.target.value || null })
            }
          >
            <option value="">Any session</option>
            <option value="yes">Has a key event</option>
            <option value="no">No key event</option>
            {options.keyEvents.map((eventName) => (
              <option key={eventName} value={`event:${eventName}`}>
                Specific · {eventName}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.controlFoot}>
        <span>{range.label}</span>
        {activeFilters.length ? (
          <div className={styles.activeFilters} aria-label="Active filters">
            {activeFilters.map((filter) => (
              <button
                type="button"
                key={filter.key}
                title={`Remove ${filter.label}`}
                onClick={() => navigate({ [filter.key]: null })}
              >
                <span>{filter.label}</span> ×
              </button>
            ))}
            <button type="button" className={styles.clearButton} onClick={clearFilters}>
              Clear all
            </button>
          </div>
        ) : (
          <span className={styles.unfiltered}>All sessions</span>
        )}
      </div>
    </section>
  );
}
