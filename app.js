let reports = [];
let routes = [];
let timeline = [];

const categoryMeta = {
  confirmed: { label: "Confirmed", color: "#41d9ff" },
  suspected: { label: "Suspected", color: "#f6b749" },
  death: { label: "Deaths", color: "#ff5c6c" },
  exposure: { label: "Exposure Sites", color: "#a78bfa" },
  monitoring: { label: "Monitoring", color: "#54d990" }
};

const summaryGrid = document.querySelector("#summaryGrid");
const filterGrid = document.querySelector("#filterGrid");
const resetFiltersButton = document.querySelector("#resetFilters");
const searchInput = document.querySelector("#caseSearch");
const searchResult = document.querySelector("#searchResult");
const detailPanel = document.querySelector("#detailPanel");
const dateRange = document.querySelector("#dateRange");
const dateOutput = document.querySelector("#dateOutput");
const statusPill = document.querySelector("#statusPill");
const datasetStatusValue = document.querySelector("#datasetStatusValue");
const datasetStatusText = document.querySelector("#datasetStatusText");
const datasetMetaLine = document.querySelector("#datasetMetaLine");
const checkFeedButton = document.querySelector("#checkFeed");
const datasetSourceLink = document.querySelector("#datasetSourceLink");
const timelineTrack = document.querySelector("#timelineTrack");
const globeStatus = document.querySelector("#globeStatus");
const homeGlobeButton = document.querySelector("#homeGlobe");
const focusLatestButton = document.querySelector("#focusLatest");
const globeFallback = document.querySelector("#globeFallback");
const markerTooltip = document.querySelector("#markerTooltip");
const viewport = document.querySelector("#globeViewport");

let dateOptions = [];
let dataMeta = {
  label: "Local fallback data",
  statusText: "Using bundled records until the official feed loads.",
  refreshMinutes: 5,
  summary: null
};
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric"
});
const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric"
});
const statusTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

const homeCamera = {
  position: {
    x: -52,
    y: 12,
    z: 28500000,
    spatialReference: { wkid: 4326 }
  },
  heading: 0,
  tilt: 0
};

const state = {
  selectedId: null,
  hoverId: null,
  search: "",
  activeCategories: new Set(Object.keys(categoryMeta)),
  dateIndex: 0,
  mapReady: false,
  map: null,
  view: null,
  caseLayer: null,
  routeLayer: null,
  routePulseLayer: null,
  Graphic: null,
  Point: null,
  Polyline: null,
  hoverRequest: 0,
  routePulseData: [],
  routeAnimationFrame: null
};

function syncDateOptions(selectLatest = false) {
  const currentViewDate = getIsoDate(dataMeta.lastFetched || dataMeta.lastChecked || new Date().toISOString());
  const reportDates = [...new Set(reports.map((report) => report.date).filter(Boolean))].sort();
  const startDate = reportDates[0] || currentViewDate;
  const endCandidates = [reportDates[reportDates.length - 1], currentViewDate].filter(Boolean).sort();
  const endDate = endCandidates[endCandidates.length - 1];
  dateOptions = getDailyDateRange(startDate, endDate);
  if (!dateOptions.length) {
    const today = new Date().toISOString().slice(0, 10);
    dateOptions = [today];
  }

  if (selectLatest) {
    state.dateIndex = dateOptions.length - 1;
  } else {
    state.dateIndex = Math.max(0, Math.min(state.dateIndex, dateOptions.length - 1));
  }

  dateRange.max = String(dateOptions.length - 1);
  dateRange.value = String(state.dateIndex);
}

function updateDatasetStatus() {
  const sourceDate = dataMeta.sourceAsOfDate || dataMeta.lastUpdated?.slice(0, 10);
  const sourceAt = sourceDate
    ? `Official source: ${formatDate(sourceDate)}`
    : "";
  const pulledAt = dataMeta.lastFetched
    ? `Feed updated: ${statusTimeFormatter.format(new Date(dataMeta.lastFetched))}`
    : "";
  const checkedAt = dataMeta.lastChecked
    ? `Page refreshed: ${statusTimeFormatter.format(new Date(dataMeta.lastChecked))}`
    : "";
  const cadence = dataMeta.updateCadence ? `Schedule: ${dataMeta.updateCadence}` : "";

  if (statusPill) {
    statusPill.innerHTML = `<span class="status-dot"></span>${dataMeta.label || "Source feed"}`;
  }

  if (datasetStatusValue) {
    datasetStatusValue.textContent = dataMeta.label || "Source feed";
  }

  if (datasetStatusText) {
    datasetStatusText.textContent = dataMeta.statusText || "";
  }

  if (datasetMetaLine) {
    datasetMetaLine.textContent = [sourceAt, pulledAt, checkedAt, cadence].filter(Boolean).join(" | ");
  }

  if (datasetSourceLink) {
    datasetSourceLink.href = dataMeta.primarySourceUrl || "#";
    datasetSourceLink.textContent = dataMeta.primarySource ? "Open source" : "Source pending";
    datasetSourceLink.toggleAttribute("aria-disabled", !dataMeta.primarySourceUrl);
  }
}

function applyFeed(feed) {
  if (!feed?.reports?.length) {
    syncDateOptions();
    updateDatasetStatus();
    return false;
  }

  reports = feed.reports;
  routes = feed.routes || [];
  timeline = feed.timeline || timeline;
  dataMeta = {
    ...dataMeta,
    ...(feed.meta || {}),
    version: feed.version,
    lastChecked: new Date().toISOString()
  };

  syncDateOptions(true);
  renderTimeline();
  updateDatasetStatus();
  return true;
}

function formatDate(date) {
  return dateFormatter.format(new Date(`${date}T12:00:00`));
}

function getDailyDateRange(startDate, endDate) {
  if (!startDate || !endDate) return [];
  const dates = [];
  const cursor = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function formatShortDate(date) {
  return shortDateFormatter.format(new Date(`${date}T12:00:00`));
}

function getOrdinalSuffix(day) {
  if (day > 3 && day < 21) return "th";
  if (day % 10 === 1) return "st";
  if (day % 10 === 2) return "nd";
  if (day % 10 === 3) return "rd";
  return "th";
}

function formatFriendlyDate(date) {
  const parsed = new Date(`${date}T12:00:00`);
  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(parsed);
  const day = parsed.getDate();
  return `${month} ${day}${getOrdinalSuffix(day)}`;
}

function getIsoDate(value) {
  return value ? String(value).slice(0, 10) : "";
}

function getReportColor(report) {
  return categoryMeta[report.category]?.color || "#ffffff";
}

function hexToRgba(hex, alpha = 1) {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, alpha];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSearchQuery() {
  return normalizeSearchText(state.search);
}

function textMatchesPlaceQuery(value, query) {
  const text = normalizeSearchText(value);
  if (!text || query.length < 2) return false;

  if (text === query || text.startsWith(query)) return true;
  if (text.includes(` ${query}`)) return true;

  return text.split(/[\s/.-]+/).some((word) => word.startsWith(query));
}

function reportMatchesSearch(report) {
  if (!state.search.trim()) return true;

  const query = getSearchQuery();
  if (!query || query.length < 2) return false;

  return [report.country, report.location, ...(report.aliases || [])].some((value) =>
    textMatchesPlaceQuery(value, query)
  );
}

function reportIsVisible(report) {
  return (
    report.date <= dateOptions[state.dateIndex] &&
    state.activeCategories.has(report.category) &&
    reportMatchesSearch(report)
  );
}

function getVisibleReports() {
  return reports.filter(reportIsVisible);
}

function getSearchResultReports() {
  if (!state.search) return [];
  return getVisibleReports();
}

function getVisibleRoutes() {
  const visibleLocations = new Set(getVisibleReports().map((report) => report.location));
  return routes.filter(
    (route) =>
      route.date <= dateOptions[state.dateIndex] &&
      visibleLocations.has(route.from) &&
      visibleLocations.has(route.to)
  );
}

function summarizeReports(reportSet) {
  return reportSet.reduce(
    (acc, report) => {
      acc.confirmed += report.confirmed;
      acc.suspected += report.suspected;
      acc.inconclusive += report.inconclusive || 0;
      acc.deaths += report.deaths;
      acc.countries.add(report.country);
      return acc;
    },
    { confirmed: 0, suspected: 0, inconclusive: 0, deaths: 0, countries: new Set() }
  );
}

function reportIsAggregate(report) {
  return (
    report.isAggregate ||
    report.id === "WHO-DON600-MV-HONDIUS" ||
    /official who snapshot/i.test(report.notes || "")
  );
}

function allCategoryFiltersActive() {
  return Object.keys(categoryMeta).every((category) => state.activeCategories.has(category));
}

function getSummaryReports(visible, useOfficialSummary) {
  if (useOfficialSummary || state.search.trim()) return visible;

  const granularReports = visible.filter((report) => !reportIsAggregate(report));
  return granularReports.length ? granularReports : visible;
}

function renderSummary() {
  const visible = getVisibleReports();
  const selectedDate = dateOptions[state.dateIndex];
  const officialDate = dataMeta.sourceAsOfDate || dataMeta.lastUpdated?.slice(0, 10);
  const official = dataMeta.summary;
  const useOfficialSummary =
    Boolean(official) &&
    Boolean(officialDate) &&
    selectedDate >= officialDate &&
    !state.search.trim() &&
    allCategoryFiltersActive();
  const officialTotal = official
    ? official.totalCases ?? official.confirmedCases + official.probableCases + (official.inconclusiveCases || 0)
    : 0;
  const summaryReports = getSummaryReports(visible, useOfficialSummary);
  const totals = summarizeReports(summaryReports);

  const cards = useOfficialSummary
    ? [
        [
          "Total",
          officialTotal,
          `Official through ${formatFriendlyDate(officialDate)}`
        ],
        ["Confirmed", official.confirmedCases, "WHO lab-confirmed"],
        ["Probable", official.probableCases, "WHO case definition"],
        ["Inconclusive", official.inconclusiveCases || 0, "Retesting status"],
        ["Deaths", official.deaths, "WHO reported"],
        ["Risk", official.globalRisk, "WHO global risk"]
      ]
    : [
        ["Total", totals.confirmed + totals.suspected + totals.inconclusive, `Through ${formatFriendlyDate(selectedDate)}`],
        ["Confirmed", totals.confirmed, "Visible records"],
        ["Probable", totals.suspected, "Visible records"],
        ["Inconclusive", totals.inconclusive, "Visible records"],
        ["Deaths", totals.deaths, "Visible records"],
        ["Signals", summaryReports.length, "Visible source records"]
      ];

  summaryGrid.innerHTML = cards
    .map(
      ([label, value, helper]) => `
        <article class="summary-card">
          <span>${label}</span>
          <strong>${value}</strong>
          <small>${helper}</small>
        </article>
      `
    )
    .join("");

  const visibleSignalLabel = visible.length === 1 ? "signal" : "signals";

  if (state.search) {
    const query = getSearchQuery();
    if (!query || query.length < 2) {
      globeStatus.textContent = `Type at least 2 letters to search locations through ${formatFriendlyDate(dateOptions[state.dateIndex])}`;
      return;
    }

    const filteredCases = totals.confirmed + totals.suspected + totals.inconclusive;
    const filteredCaseLabel = filteredCases === 1 ? "case" : "cases";
    globeStatus.textContent = `${visible.length} visible ${visibleSignalLabel} | ${filteredCases} ${filteredCaseLabel} matching "${state.search}" through ${formatFriendlyDate(dateOptions[state.dateIndex])}`;
    return;
  }

  globeStatus.textContent = useOfficialSummary
    ? `${visible.length} visible ${visibleSignalLabel} | ${officialTotal} total cases, official through ${formatFriendlyDate(officialDate)}`
    : `${summaryReports.length} summarized ${summaryReports.length === 1 ? "signal" : "signals"} | ${totals.confirmed + totals.suspected + totals.inconclusive} cases through ${formatFriendlyDate(dateOptions[state.dateIndex])}`;
}

function renderFilters() {
  filterGrid.innerHTML = Object.entries(categoryMeta)
    .map(([key, meta]) => {
      const active = state.activeCategories.has(key);
      return `
        <button
          class="filter-button"
          type="button"
          data-category="${key}"
          aria-pressed="${active}"
          style="--filter-color: ${meta.color}"
        >
          ${meta.label}
        </button>
      `;
    })
    .join("");
}

function renderDateOutput() {
  const reportDate = dateOptions[state.dateIndex];
  dateOutput.textContent = formatFriendlyDate(reportDate);
}

function renderSearchResult() {
  if (!searchResult) return;

  const displayQuery = state.search.trim();
  const query = getSearchQuery();
  const safeDisplayQuery = escapeHtml(displayQuery);

  if (!displayQuery) {
    searchResult.className = "search-result is-empty";
    searchResult.textContent = "Search a country to see matching case counts.";
    return;
  }

  if (!query || query.length < 2) {
    searchResult.className = "search-result is-zero";
    searchResult.innerHTML = `<strong>0</strong><span>Type at least 2 letters to search.</span>`;
    return;
  }

  const matched = getSearchResultReports();
  const totals = matched.reduce(
    (acc, report) => {
      acc.confirmed += report.confirmed;
      acc.probable += report.suspected;
      acc.inconclusive += report.inconclusive || 0;
      acc.cases += report.confirmed + report.suspected + (report.inconclusive || 0);
      acc.deaths += report.deaths;
      acc.signals += 1;
      return acc;
    },
    { cases: 0, confirmed: 0, probable: 0, inconclusive: 0, deaths: 0, signals: 0 }
  );

  if (!matched.length || totals.cases + totals.deaths === 0) {
    searchResult.className = "search-result is-zero";
    searchResult.innerHTML = `<strong>0</strong><span>No cases found for "${safeDisplayQuery}"</span>`;
    return;
  }

  const caseLabel = totals.cases === 1 ? "case" : "cases";
  const breakdown = [
    totals.confirmed ? `${totals.confirmed} confirmed` : "",
    totals.probable ? `${totals.probable} probable` : "",
    totals.inconclusive ? `${totals.inconclusive} inconclusive` : "",
    totals.deaths ? `${totals.deaths} death${totals.deaths === 1 ? "" : "s"}` : ""
  ].filter(Boolean);
  const breakdownText = breakdown.length ? ` (${breakdown.join(", ")})` : "";
  const signalText = totals.signals === 1 ? "1 source signal" : `${totals.signals} source signals`;
  searchResult.className = "search-result has-result";
  searchResult.innerHTML = `<strong>${totals.cases}</strong><span>${caseLabel} found for "${safeDisplayQuery}"${breakdownText}. ${signalText} visible.</span>`;
}

function renderTimeline() {
  timelineTrack.innerHTML = timeline
    .map((event) => {
      const color = categoryMeta[event.category]?.color || "#41d9ff";
      return `
        <article class="timeline-card" style="--case-color: ${color}">
          <time datetime="${event.date}">${formatDate(event.date)}</time>
          <h3>${event.title}</h3>
          <p>${event.description}</p>
        </article>
      `;
    })
    .join("");
}

function renderDetail() {
  const report = reports.find((item) => item.id === state.selectedId);
  detailPanel.classList.toggle("is-empty", !report);
  detailPanel.classList.toggle("has-report", Boolean(report));

  if (!report) {
    detailPanel.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon"></span>
        <h2>Report details</h2>
        <p>Select a marker to review source, dates, confidence, and notes.</p>
      </div>
    `;
    return;
  }

  const color = getReportColor(report);
  const inconclusive = report.inconclusive || 0;
  detailPanel.innerHTML = `
    <article class="case-detail" style="--case-color: ${color}">
      <div class="detail-topline">
        <span class="detail-badge">${report.type}</span>
        <button class="close-detail" type="button" id="closeDetail" aria-label="Close details">x</button>
      </div>

      <div>
        <h2>${report.location}</h2>
        <p class="subtle">${report.id}</p>
      </div>

      <div class="metric-row" aria-label="Case metrics">
        <div class="mini-metric">
          <span>Confirmed</span>
          <strong>${report.confirmed}</strong>
        </div>
        <div class="mini-metric">
          <span>Probable</span>
          <strong>${report.suspected}</strong>
        </div>
        <div class="mini-metric">
          <span>Inconclusive</span>
          <strong>${inconclusive}</strong>
        </div>
        <div class="mini-metric">
          <span>Deaths</span>
          <strong>${report.deaths}</strong>
        </div>
      </div>

      <dl class="detail-list">
        <div>
          <dt>Reported</dt>
          <dd>${formatDate(report.date)}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>${report.confidence} (${report.confidenceScore}/100)</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>${report.sourceName}</dd>
        </div>
        <div>
          <dt>Coordinates</dt>
          <dd>${report.lat.toFixed(4)}, ${report.lng.toFixed(4)}</dd>
        </div>
      </dl>

      <div class="confidence-meter" aria-label="Confidence score">
        <div>
          <span>Source confidence</span>
          <strong>${report.confidenceScore}/100</strong>
        </div>
        <i style="width: ${report.confidenceScore}%"></i>
      </div>

      <p class="subtle">${report.notes}</p>

      <a class="source-button" href="${report.sourceUrl}" target="_blank" rel="noreferrer">
        View source
        <span aria-hidden="true">-></span>
      </a>
    </article>
  `;

  document.querySelector("#closeDetail")?.addEventListener("click", () => {
    state.selectedId = null;
    renderDetail();
    renderMapLayers();
  });
}

function syncSelectedVisibility() {
  const selected = reports.find((report) => report.id === state.selectedId);
  if (selected && !reportIsVisible(selected)) {
    state.selectedId = null;
  }
}

function showFallback(message) {
  globeFallback.textContent = message;
  globeFallback.classList.add("is-visible");
}

function hideFallback() {
  globeFallback.classList.remove("is-visible");
}

function toCartesian(lat, lng) {
  const latitude = (lat * Math.PI) / 180;
  const longitude = (lng * Math.PI) / 180;
  const cosLat = Math.cos(latitude);
  return {
    x: cosLat * Math.cos(longitude),
    y: cosLat * Math.sin(longitude),
    z: Math.sin(latitude)
  };
}

function toLatLng(point) {
  const hyp = Math.sqrt(point.x * point.x + point.y * point.y);
  return [(Math.atan2(point.z, hyp) * 180) / Math.PI, (Math.atan2(point.y, point.x) * 180) / Math.PI];
}

function getGreatCirclePath(start, end, steps = 96, elevated = false) {
  const a = toCartesian(start[0], start[1]);
  const b = toCartesian(end[0], end[1]);
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);

  if (sinOmega < 0.00001) {
    return [
      elevated ? [start[1], start[0], 90000] : [start[1], start[0]],
      elevated ? [end[1], end[0], 90000] : [end[1], end[0]]
    ];
  }

  const peakAltitude = Math.min(2300000, Math.max(520000, omega * 1200000));
  const path = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const startWeight = Math.sin((1 - t) * omega) / sinOmega;
    const endWeight = Math.sin(t * omega) / sinOmega;
    const point = {
      x: a.x * startWeight + b.x * endWeight,
      y: a.y * startWeight + b.y * endWeight,
      z: a.z * startWeight + b.z * endWeight
    };
    const [lat, lng] = toLatLng(point);
    if (elevated) {
      const altitude = 90000 + Math.sin(Math.PI * t) * peakAltitude;
      path.push([lng, lat, altitude]);
    } else {
      path.push([lng, lat]);
    }
  }
  return path;
}

function makePointSymbol(report) {
  const selected = report.id === state.selectedId;
  const hovered = report.id === state.hoverId;
  const color = hexToRgba(getReportColor(report), selected ? 0.98 : 0.9);
  const haloColor = hexToRgba(getReportColor(report), selected ? 0.2 : hovered ? 0.16 : 0.1);
  const primitiveByCategory = {
    confirmed: "circle",
    suspected: "triangle",
    death: "x",
    exposure: "square",
    monitoring: "circle"
  };
  const baseSize = report.category === "death" ? 8.5 : report.category === "monitoring" ? 5.5 : 6.75;
  const size = selected ? baseSize + 2.4 : hovered ? baseSize + 1.2 : baseSize;
  const symbol = {
    type: "point-3d",
    symbolLayers: [
      {
        type: "icon",
        resource: { primitive: "circle" },
        size: size + (selected ? 7 : 4),
        material: { color: haloColor },
        outline: {
          color: hexToRgba(getReportColor(report), selected ? 0.34 : 0.2),
          size: selected ? 0.55 : 0.35
        }
      },
      {
        type: "icon",
        resource: { primitive: primitiveByCategory[report.category] || "circle" },
        size,
        material: { color },
        outline: {
          color: [255, 255, 255, selected ? 0.95 : 0.5],
          size: selected ? 0.75 : 0.3
        }
      }
    ]
  };

  if (selected) {
    symbol.verticalOffset = {
      screenLength: 7,
      maxWorldLength: 140000,
      minWorldLength: 7000
    };
    symbol.callout = {
      type: "line",
      color: [255, 255, 255, 0.24],
      size: 0.55
    };
  }

  return symbol;
}

function makeRouteSymbol(kind = "core") {
  const isHalo = kind === "halo";
  return {
    type: "line-3d",
    symbolLayers: [
      {
        type: "line",
        size: isHalo ? 2.4 : 0.78,
        material: {
          color: isHalo ? [65, 217, 255, 0.11] : [185, 244, 230, 0.72]
        }
      }
    ]
  };
}

function makeRoutePulseSymbol(index) {
  return {
    type: "point-3d",
    symbolLayers: [
      {
        type: "icon",
        resource: { primitive: "circle" },
        size: 3.8,
        material: { color: [210, 255, 238, 0.9] },
        outline: {
          color: [65, 217, 255, 0.38],
          size: 0.4
        }
      }
    ]
  };
}

function getPathPoint(path, progress) {
  const scaled = progress * (path.length - 1);
  const index = Math.floor(scaled);
  const nextIndex = Math.min(path.length - 1, index + 1);
  const localT = scaled - index;
  const current = path[index];
  const next = path[nextIndex];
  let lngDelta = next[0] - current[0];

  if (lngDelta > 180) lngDelta -= 360;
  if (lngDelta < -180) lngDelta += 360;

  let lng = current[0] + lngDelta * localT;
  if (lng > 180) lng -= 360;
  if (lng < -180) lng += 360;

  return [
    lng,
    current[1] + (next[1] - current[1]) * localT,
    current[2] + (next[2] - current[2]) * localT
  ];
}

function updateRoutePulses(time) {
  state.routePulseData.forEach((pulse) => {
    const progress = (time * 0.000095 + pulse.offset) % 1;
    const [longitude, latitude, z] = getPathPoint(pulse.path, progress);
    pulse.graphic.geometry = new state.Point({
      longitude,
      latitude,
      z,
      spatialReference: { wkid: 4326 }
    });
  });
}

function startRouteAnimation() {
  if (state.routeAnimationFrame) return;

  const tick = (time) => {
    updateRoutePulses(time);
    state.routeAnimationFrame = requestAnimationFrame(tick);
  };

  state.routeAnimationFrame = requestAnimationFrame(tick);
}

function renderMapLayers() {
  if (!state.mapReady || !state.caseLayer || !state.routeLayer || !state.routePulseLayer) return;

  state.caseLayer.removeAll();
  state.routeLayer.removeAll();
  state.routePulseLayer.removeAll();
  state.routePulseData = [];

  getVisibleRoutes().forEach((route, routeIndex) => {
    const arcPath = getGreatCirclePath(route.start, route.end, 112, true);
    state.routeLayer.add(
      new state.Graphic({
        geometry: new state.Polyline({
          hasZ: true,
          paths: [arcPath],
          spatialReference: { wkid: 4326 }
        }),
        symbol: makeRouteSymbol("halo"),
        attributes: { routeId: `${route.id}-halo` }
      })
    );
    state.routeLayer.add(
      new state.Graphic({
        geometry: new state.Polyline({
          hasZ: true,
          paths: [arcPath],
          spatialReference: { wkid: 4326 }
        }),
        symbol: makeRouteSymbol("core"),
        attributes: { routeId: `${route.id}-core` }
      })
    );

    [0].forEach((offset, pulseIndex) => {
      const [longitude, latitude, z] = getPathPoint(arcPath, offset);
      const pulseGraphic = new state.Graphic({
        geometry: new state.Point({
          longitude,
          latitude,
          z,
          spatialReference: { wkid: 4326 }
        }),
        symbol: makeRoutePulseSymbol(pulseIndex),
        attributes: { routeId: `${route.id}-pulse-${pulseIndex}` }
      });
      state.routePulseLayer.add(pulseGraphic);
      state.routePulseData.push({
        graphic: pulseGraphic,
        path: arcPath,
        offset: (offset + routeIndex * 0.11) % 1
      });
    });
  });

  getVisibleReports().forEach((report) => {
    state.caseLayer.add(
      new state.Graphic({
        geometry: new state.Point({
          longitude: report.lng,
          latitude: report.lat,
          spatialReference: { wkid: 4326 }
        }),
        symbol: makePointSymbol(report),
        attributes: { reportId: report.id }
      })
    );
  });

  startRouteAnimation();
}

function showTooltip(report, event) {
  markerTooltip.innerHTML = `
    <strong>${report.location}</strong>
    <small>${report.type} | ${formatDate(report.date)}</small>
  `;
  markerTooltip.style.display = "block";
  markerTooltip.style.left = `${event.x + 18}px`;
  markerTooltip.style.top = `${event.y + 18}px`;
}

function hideTooltip() {
  markerTooltip.style.display = "none";
}

function focusReport(report) {
  state.selectedId = report.id;
  state.hoverId = null;
  hideTooltip();
  renderDetail();
  renderMapLayers();

  state.view
    ?.goTo(
      {
        center: [report.lng, report.lat],
        zoom: report.category === "exposure" ? 4.2 : 4.8,
        tilt: 0
      },
      { duration: 900, easing: "ease-in-out" }
    )
    .catch(() => {});
}

function findReportFromHit(response) {
  const result = response.results.find((item) => item.graphic?.attributes?.reportId);
  if (!result) return null;
  return reports.find((report) => report.id === result.graphic.attributes.reportId) || null;
}

function bindMapInteractions() {
  state.view.on("pointer-move", (event) => {
    const requestId = (state.hoverRequest += 1);
    state.view.hitTest(event).then((response) => {
      if (requestId !== state.hoverRequest) return;
      const report = findReportFromHit(response);
      const nextHoverId = report?.id || null;

      if (nextHoverId !== state.hoverId) {
        state.hoverId = nextHoverId;
        renderMapLayers();
      }

      if (report) {
        showTooltip(report, event);
        viewport.classList.add("is-pointing");
      } else {
        hideTooltip();
        viewport.classList.remove("is-pointing");
      }
    });
  });

  state.view.on("click", (event) => {
    state.view.hitTest(event).then((response) => {
      const report = findReportFromHit(response);
      if (report) focusReport(report);
    });
  });

  state.view.on("pointer-leave", () => {
    state.hoverId = null;
    hideTooltip();
    renderMapLayers();
  });
}

function initArcGIS(WebScene, SceneView, GraphicsLayer, Graphic, Point, Polyline) {
  state.Graphic = Graphic;
  state.Point = Point;
  state.Polyline = Polyline;
  state.routeLayer = new GraphicsLayer({
    title: "Travel links",
    elevationInfo: { mode: "absolute-height" }
  });
  state.routePulseLayer = new GraphicsLayer({
    title: "Route pulse animation",
    elevationInfo: { mode: "absolute-height" }
  });
  state.caseLayer = new GraphicsLayer({
    title: "Outbreak reports",
    elevationInfo: { mode: "relative-to-ground", offset: 12000 }
  });

  state.map = new WebScene({
    portalItem: {
      id: "6682f70b89c4483f88e8df839a011c1e"
    }
  });
  state.map.addMany([state.routeLayer, state.routePulseLayer, state.caseLayer]);

  state.view = new SceneView({
    container: viewport,
    map: state.map,
    viewingMode: "global",
    camera: homeCamera,
    qualityProfile: "high",
    environment: {
      background: { type: "color", color: [0, 0, 0, 1] },
      starsEnabled: true,
      atmosphereEnabled: true
    },
    constraints: {
      altitude: {
        min: 900000,
        max: 50000000
      }
    },
    highlightOptions: {
      color: [65, 217, 255, 1],
      haloOpacity: 0.45,
      fillOpacity: 0.05
    },
    popup: {
      autoOpenEnabled: false
    }
  });

  state.view.ui.components = ["attribution"];

  state.view
    .when(() => {
      state.mapReady = true;
      hideFallback();
      bindMapInteractions();
      renderMapLayers();
    })
    .catch(() => {
      showFallback("ArcGIS satellite globe failed to load. Check internet access, then refresh.");
    });
}

function loadArcGIS() {
  if (typeof window.require !== "function") {
    showFallback("ArcGIS satellite globe failed to load. Check internet access, then refresh.");
    return;
  }

  window.require(
    [
      "esri/WebScene",
      "esri/views/SceneView",
      "esri/layers/GraphicsLayer",
      "esri/Graphic",
      "esri/geometry/Point",
      "esri/geometry/Polyline"
    ],
    initArcGIS,
    () => {
      showFallback("ArcGIS satellite globe failed to load. Check internet access, then refresh.");
    }
  );
}

function refreshFeed() {
  return new Promise((resolve) => {
    if (checkFeedButton) {
      checkFeedButton.disabled = true;
      checkFeedButton.textContent = "Checking...";
    }

    const script = document.createElement("script");
    script.src = `./data/outbreak-feed.js?v=${Date.now()}`;
    script.async = true;
    script.onload = () => {
      const changed = applyFeed(window.HANTATRACK_FEED);
      if (changed) updateAll();
      if (checkFeedButton) {
        checkFeedButton.disabled = false;
        checkFeedButton.textContent = "Reload feed";
      }
      resolve(changed);
    };
    script.onerror = () => {
      dataMeta = {
        ...dataMeta,
        lastChecked: new Date().toISOString(),
        statusText: `${dataMeta.statusText || "Source feed"} Feed refresh failed; using the last loaded snapshot.`
      };
      updateDatasetStatus();
      if (checkFeedButton) {
        checkFeedButton.disabled = false;
        checkFeedButton.textContent = "Reload feed";
      }
      resolve(false);
    };
    document.head.appendChild(script);
  });
}

function startFeedRefresh() {
  const minutes = Number(dataMeta.refreshMinutes) || 5;
  window.setInterval(refreshFeed, minutes * 60 * 1000);
}

function updateAll() {
  syncSelectedVisibility();
  renderSummary();
  renderSearchResult();
  renderFilters();
  renderDateOutput();
  renderDetail();
  renderMapLayers();
}

filterGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  const category = button.dataset.category;
  if (state.activeCategories.has(category)) {
    state.activeCategories.delete(category);
  } else {
    state.activeCategories.add(category);
  }
  updateAll();
});

resetFiltersButton.addEventListener("click", () => {
  state.activeCategories = new Set(Object.keys(categoryMeta));
  state.search = "";
  searchInput.value = "";
  updateAll();
});

searchInput.addEventListener("input", (event) => {
  state.search = event.target.value.trim();
  updateAll();
});

dateRange.addEventListener("input", (event) => {
  state.dateIndex = Number(event.target.value);
  updateAll();
});

homeGlobeButton.addEventListener("click", () => {
  state.selectedId = null;
  state.hoverId = null;
  hideTooltip();
  renderDetail();
  renderMapLayers();
  state.view?.goTo(homeCamera, { duration: 850, easing: "ease-in-out" }).catch(() => {});
});

focusLatestButton.addEventListener("click", () => {
  const latest = [...getVisibleReports()].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (latest) focusReport(latest);
});

checkFeedButton?.addEventListener("click", () => {
  refreshFeed();
});

applyFeed(window.HANTATRACK_FEED);
updateAll();
startFeedRefresh();
loadArcGIS();
