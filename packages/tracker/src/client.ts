"use client";

import { createElement, useEffect } from "react";

export type VisitorMode = "session" | "persistent" | "none";

export type MinilyticsOptions = {
  endpoint?: string;
  autoPageviews?: boolean;
  autoClicks?: boolean;
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

const SESSION_KEY = "minilytics.session.v1";
const VISITOR_KEY = "minilytics.visitor.v1";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_PROPERTIES_BYTES = 4096;

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
  if (!(element instanceof HTMLAnchorElement) || !element.href) return undefined;
  try {
    const url = new URL(element.href, window.location.href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

export function createTracker(options: MinilyticsOptions = {}) {
  const endpoint = options.endpoint ?? "/api/minilytics";
  const autoPageviews = options.autoPageviews ?? true;
  const autoClicks = options.autoClicks ?? true;
  const visitorMode = options.visitorMode ?? "session";

  let session =
    readSession() ??
    ({
      id: randomId(),
      lastSeen: Date.now(),
      attribution: initialAttribution(),
    } satisfies SessionState);

  let lastPage = "";

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

  function track(
    eventType: string,
    properties?: EventProperties,
    extra: Pick<EventPayload, "targetUrl" | "targetLabel"> = {},
  ) {
    if (!/^[a-z0-9_.:-]{1,64}$/i.test(eventType)) return;

    touchSession();

    send({
      eventType,
      sessionId: session.id,
      visitorId: getVisitorId(visitorMode, session.id),
      path: cleanPath(new URL(window.location.href)),
      title: document.title || undefined,
      occurredAt: new Date().toISOString(),
      attribution: session.attribution,
      properties: safeProperties(properties),
      ...extra,
    });
  }

  function pageview() {
    const path = cleanPath(new URL(window.location.href));
    if (path === lastPage) return;
    lastPage = path;
    track("pageview");
  }

  function clickHandler(event: MouseEvent) {
    const origin = event.target;
    if (!(origin instanceof Element)) return;

    const element = origin.closest("a, button, [data-minilytics]");
    if (!element) return;

    const label = element.getAttribute("data-minilytics") || undefined;
    const url = targetUrl(element);
    let eventType = "click";

    if (url) {
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

  function start() {
    writeSession(session);

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    const afterNavigation = () => queueMicrotask(pageview);

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      afterNavigation();
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      afterNavigation();
    };

    window.addEventListener("popstate", afterNavigation);
    if (autoClicks) document.addEventListener("click", clickHandler, true);
    if (autoPageviews) pageview();

    return () => {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", afterNavigation);
      if (autoClicks) document.removeEventListener("click", clickHandler, true);
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
  }, []);

  return createElement("span", {
    "aria-hidden": true,
    style: { display: "none" },
    "data-minilytics": "loaded",
  });
}
