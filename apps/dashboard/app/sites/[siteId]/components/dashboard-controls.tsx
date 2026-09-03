"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";

type Range = {
  preset: string;
  fromInput: string;
  toInput: string;
  label: string;
};
type Filters = { source: string; landing: string; exit: string; keyEvent: string };
type FilterOptions = {
  sources: Array<{ value: string; count: number; source: string; medium: string; detail: string | null }>;
  landings: Array<{ value: string; count: number }>;
  exits: Array<{ value: string; count: number }>;
  keyEvents: string[];
};

export function DashboardControls({
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

  useEffect(() => {
    setCustomFrom(range.fromInput);
    setCustomTo(range.toInput);
  }, [range.fromInput, range.toInput]);

  const activeCount = [filters.source, filters.landing, filters.exit, filters.keyEvent].filter(Boolean).length;
  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);

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
    if (!customFrom || !customTo) return;
    navigate({ range: "custom", from: customFrom, to: customTo });
  }

  function clearFilters() {
    navigate({ source: null, landing: null, exit: null, keyEvent: null });
  }

  return (
    <section className="controlDeck" aria-label="Analytics controls">
      <div className="controlGroup rangeGroup">
        <span className="controlLabel">Period</span>
        <select value={range.preset} onChange={(event: ChangeEvent<HTMLSelectElement>) => setPreset(event.target.value)} aria-label="Date range">
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="custom">Custom range</option>
        </select>
        {range.preset === "custom" ? (
          <div className="customDates">
            <input type="date" value={customFrom} max={customTo} onChange={(event: ChangeEvent<HTMLInputElement>) => setCustomFrom(event.target.value)} aria-label="From date" />
            <span>→</span>
            <input type="date" value={customTo} min={customFrom} onChange={(event: ChangeEvent<HTMLInputElement>) => setCustomTo(event.target.value)} aria-label="To date" />
            <button type="button" className="controlButton" onClick={applyCustom}>Apply</button>
          </div>
        ) : null}
      </div>

      <div className="filterGrid">
        <label>
          <span>Source</span>
          <select value={filters.source} onChange={(event: ChangeEvent<HTMLSelectElement>) => navigate({ source: event.target.value || null })}>
            <option value="">All sources</option>
            {options.sources.map((option) => (
              <option key={option.value} value={option.value}>
                {option.source}{option.detail ? ` · ${option.detail}` : ""}{option.medium && option.medium !== option.source ? ` / ${option.medium}` : ""} ({option.count})
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Landing</span>
          <select value={filters.landing} onChange={(event: ChangeEvent<HTMLSelectElement>) => navigate({ landing: event.target.value || null })}>
            <option value="">All landing pages</option>
            {options.landings.map((option) => <option key={option.value} value={option.value}>{option.value} ({option.count})</option>)}
          </select>
        </label>

        <label>
          <span>Exit</span>
          <select value={filters.exit} onChange={(event: ChangeEvent<HTMLSelectElement>) => navigate({ exit: event.target.value || null })}>
            <option value="">All exit pages</option>
            {options.exits.map((option) => <option key={option.value} value={option.value}>{option.value} ({option.count})</option>)}
          </select>
        </label>

        <label>
          <span>Key event</span>
          <select value={filters.keyEvent} onChange={(event: ChangeEvent<HTMLSelectElement>) => navigate({ keyEvent: event.target.value || null })}>
            <option value="">Any session</option>
            <option value="yes">Has a key event</option>
            <option value="no">No key event</option>
            {options.keyEvents.map((eventName) => <option key={eventName} value={`event:${eventName}`}>Specific · {eventName}</option>)}
          </select>
        </label>
      </div>

      <div className="controlFoot">
        <span>{range.label}{activeCount ? ` · ${activeCount} active filter${activeCount === 1 ? "" : "s"}` : ""}</span>
        {activeCount ? <button type="button" className="textButton" onClick={clearFilters}>Clear filters</button> : null}
      </div>
    </section>
  );
}
