"use client";

import { createElement, useEffect } from "react";

export type VisitorMode = "session" | "persistent" | "none";

export type MinilyticsOptions = {
  endpoint?: string;
  autoPageviews?: boolean;
  autoClicks?: boolean;
  autoForms?: boolean;
  autoEngagement?: boolean;
  autoWebVitals?: boolean;
  visitorMode?: VisitorMode;
};

export type EventProperties = Record<string, string | number | boolean | null>;

type Attribution = {
  landingPath: string;
  landingReferrer: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
};

type SessionState = {
  id: string;
  lastSeen: number;
  attribution: Attribution;
};

type EventPayload = {
  eventType: string;
  sessionId: string;
  visitorId?: string;
  path: string;
  title?: string;
  occurredAt: string;
  attribution: Attribution;
  targetUrl?: string;
  targetLabel?: string;
  properties?: EventProperties;
};

type EventTarget = Pick<EventPayload, "targetUrl" | "targetLabel">;

type VitalMetric = {
  name: string;
  value: number;
  delta: number;
  id: string;
  rating?: string;
  navigationType?: string;
};

const SESSION_KEY = "minilytics.session.v1";
const VISITOR_KEY = "minilytics.visitor.v1";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const ENGAGEMENT_FLUSH_MS = 15_000;
const MIN_ENGAGEMENT_MS = 100;
const MAX_PROPERTIES_BYTES = 4096;
const DOWNLOAD_EXTENSIONS = /\.(?:7z|avi|csv|docx?|exe|gz|mov|mp3|mp4|pdf|pptx?|rar|tar|wav|xlsx?|zip)$/i;

function randomId() {
  return crypto.randomUUID();
}

function cleanPath(url: URL) {
  return url.pathname || "/";
}

function initialAttribution(): Attribution {
  const url = new URL(window.location.href);
  return {
    landingPath: cleanPath(url),
    landingReferrer: document.referrer || "",
    utmSource: url.searchParams.get("utm_source") || undefined,
    utmMedium: url.searchParams.get("utm_medium") || undefined,
    utmCampaign: url.searchParams.get("utm_campaign") || undefined,
  };
}

function readSession(): SessionState | undefined {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as SessionState;
    if (!parsed.id || !parsed.lastSeen || !parsed.attribution) return undefined;
    if (Date.now() - parsed.lastSeen > SESSION_TIMEOUT_MS) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writeSession(session: SessionState) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage can be unavailable; the in-memory session still works.
  }
}

function getVisitorId(mode: VisitorMode, sessionId: string) {
  if (mode === "none") return undefined;
  if (mode === "session") return sessionId;

  try {
    const existing = localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const id = randomId();
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return sessionId;
  }
}

function safeProperties(properties?: EventProperties) {
  if (!properties) return undefined;
  try {
    const json = JSON.stringify(properties);
    if (new Blob([json]).size <= MAX_PROPERTIES_BYTES) return properties;
  } catch {
    // Ignore unserializable custom properties.
  }
  return undefined;
}

function targetUrl(element: Element) {
  const raw =
    element instanceof HTMLAnchorElement
      ? element.href
      : element instanceof HTMLFormElement
        ? element.action
        : "";
  if (!raw) return undefined;

  try {
    const url = new URL(raw, window.location.href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

function isDownload(element: Element, url?: string) {
  if (!(element instanceof HTMLAnchorElement)) return false;
  if (element.hasAttribute("download")) return true;
  return Boolean(url && DOWNLOAD_EXTENSIONS.test(new URL(url).pathname));
}

export function createTracker(options: MinilyticsOptions = {}) {
  const endpoint = options.endpoint ?? "/api/minilytics";
  const autoPageviews = options.autoPageviews ?? true;
  const autoClicks = options.autoClicks ?? true;
  const autoForms = options.autoForms ?? true;
  const autoEngagement = options.autoEngagement ?? true;
  const autoWebVitals = options.autoWebVitals ?? true;
  const visitorMode = options.visitorMode ?? "session";

  let session =
    readSession() ??
    ({
      id: randomId(),
      lastSeen: Date.now(),
      attribution: initialAttribution(),
    } satisfies SessionState);

  let currentPath = cleanPath(new URL(window.location.href));
  let lastPage = "";
  let activeStarted: number | null = null;
  let pendingEngagementMs = 0;
  let engagementTimer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  function touchSession() {
    if (Date.now() - session.lastSeen > SESSION_TIMEOUT_MS) {
      session = {
        id: randomId(),
        lastSeen: Date.now(),
        attribution: initialAttribution(),
      };
    } else {
      session.lastSeen = Date.now();
    }
    writeSession(session);
  }

  function send(payload: EventPayload) {
    const body = JSON.stringify(payload);

    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon(
        endpoint,
        new Blob([body], { type: "application/json" }),
      );
      if (ok) return;
    }

    void fetch(endpoint, {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  }

  function emit(
    eventType: string,
    properties?: EventProperties,
    extra: EventTarget = {},
    eventPath = currentPath,
  ) {
    if (!/^[a-z0-9_.:-]{1,64}$/i.test(eventType)) return;

    touchSession();

    send({
      eventType,
      sessionId: session.id,
      visitorId: getVisitorId(visitorMode, session.id),
      path: eventPath,
      title: document.title || undefined,
      occurredAt: new Date().toISOString(),
      attribution: session.attribution,
      properties: safeProperties(properties),
      ...extra,
    });
  }

  function track(
    eventType: string,
    properties?: EventProperties,
    extra: EventTarget = {},
  ) {
    emit(eventType, properties, extra);
  }

  function pageview() {
    currentPath = cleanPath(new URL(window.location.href));
    if (currentPath === lastPage) return;
    lastPage = currentPath;
    track("pageview");
  }

  function accrueEngagement() {
    if (activeStarted === null) return;
    const now = performance.now();
    pendingEngagementMs += Math.max(0, now - activeStarted);
    activeStarted = now;
  }

  function flushEngagement() {
    accrueEngagement();
    if (pendingEngagementMs < MIN_ENGAGEMENT_MS) return;

    const engagementMs = Math.round(pendingEngagementMs);
    pendingEngagementMs = 0;
    track("engagement", { engagementMs });
  }

  function pauseEngagement() {
    accrueEngagement();
    activeStarted = null;
    if (pendingEngagementMs >= MIN_ENGAGEMENT_MS) {
      const engagementMs = Math.round(pendingEngagementMs);
      pendingEngagementMs = 0;
      track("engagement", { engagementMs });
    }
  }

  function resumeEngagement() {
    if (document.visibilityState === "visible" && activeStarted === null) {
      activeStarted = performance.now();
    }
  }

  function visibilityHandler() {
    if (document.visibilityState === "hidden") pauseEngagement();
    else resumeEngagement();
  }

  function pagehideHandler() {
    pauseEngagement();
  }

  function clickHandler(event: MouseEvent) {
    const origin = event.target;
    if (!(origin instanceof Element)) return;

    const element = origin.closest("a, button, [data-minilytics]");
    if (!element) return;

    const label = element.getAttribute("data-minilytics") || undefined;
    const url = targetUrl(element);
    let eventType = "click";

    if (isDownload(element, url)) {
      eventType = "download";
    } else if (url) {
      try {
        if (new URL(url).origin !== window.location.origin) {
          eventType = "outbound";
        }
      } catch {
        // Keep the generic click event.
      }
    }

    track(eventType, undefined, { targetUrl: url, targetLabel: label });
  }

  function submitHandler(event: SubmitEvent) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    track("form_submit", undefined, {
      targetUrl: targetUrl(form),
      targetLabel: form.getAttribute("data-minilytics") || undefined,
    });
  }

  async function startWebVitals() {
    const metricPath = currentPath;

    try {
      const { onCLS, onFCP, onINP, onLCP, onTTFB } = await import("web-vitals");
      if (stopped) return;

      const report = (metric: VitalMetric) => {
        if (stopped) return;
        emit(
          "web_vital",
          {
            metric: metric.name,
            value: Number(metric.value.toFixed(metric.name === "CLS" ? 4 : 1)),
            delta: Number(metric.delta.toFixed(metric.name === "CLS" ? 4 : 1)),
            rating: metric.rating ?? null,
            metricId: metric.id,
            navigationType: metric.navigationType ?? null,
            metricPath,
          },
          {},
          metricPath,
        );
      };

      onCLS(report);
      onFCP(report);
      onINP(report);
      onLCP(report);
      onTTFB(report);
    } catch {
      // Performance APIs are best effort and must never affect the host site.
    }
  }

  function start() {
    writeSession(session);

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    const finishNavigation = () => {
      currentPath = cleanPath(new URL(window.location.href));
      if (autoPageviews) queueMicrotask(pageview);
    };

    history.pushState = function (...args) {
      if (autoEngagement) flushEngagement();
      originalPushState.apply(this, args);
      finishNavigation();
    };

    history.replaceState = function (...args) {
      if (autoEngagement) flushEngagement();
      originalReplaceState.apply(this, args);
      finishNavigation();
    };

    const popstateHandler = () => {
      if (autoEngagement) flushEngagement();
      finishNavigation();
    };

    window.addEventListener("popstate", popstateHandler);
    if (autoClicks) document.addEventListener("click", clickHandler, true);
    if (autoForms) document.addEventListener("submit", submitHandler, true);

    if (autoEngagement) {
      resumeEngagement();
      document.addEventListener("visibilitychange", visibilityHandler);
      window.addEventListener("pagehide", pagehideHandler);
      engagementTimer = setInterval(flushEngagement, ENGAGEMENT_FLUSH_MS);
    }

    if (autoPageviews) pageview();
    if (autoWebVitals) void startWebVitals();

    return () => {
      stopped = true;
      if (autoEngagement) pauseEngagement();
      if (engagementTimer) clearInterval(engagementTimer);
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", popstateHandler);
      if (autoClicks) document.removeEventListener("click", clickHandler, true);
      if (autoForms) document.removeEventListener("submit", submitHandler, true);
      if (autoEngagement) {
        document.removeEventListener("visibilitychange", visibilityHandler);
        window.removeEventListener("pagehide", pagehideHandler);
      }
    };
  }

  return { start, track, pageview };
}

export function Analytics(props: MinilyticsOptions = {}) {
  useEffect(() => {
    const tracker = createTracker(props);
    const stop = tracker.start();

    const globalWindow = window as Window & {
      minilytics?: { track: typeof tracker.track; pageview: typeof tracker.pageview };
    };

    globalWindow.minilytics = {
      track: tracker.track,
      pageview: tracker.pageview,
    };

    return () => {
      stop();
      delete globalWindow.minilytics;
    };
  }, [
    props.endpoint,
    props.autoPageviews,
    props.autoClicks,
    props.autoForms,
    props.autoEngagement,
    props.autoWebVitals,
    props.visitorMode,
  ]);

  return createElement("span", {
    "aria-hidden": true,
    style: { display: "none" },
    "data-minilytics": "loaded",
  });
}
