import fs from "node:fs/promises";
import vm from "node:vm";

const feedPath = new URL("../data/outbreak-feed.js", import.meta.url);

const sources = [
  {
    kind: "who-don-601",
    label: "WHO Disease Outbreak News DON601",
    url: "https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON601"
  },
  {
    kind: "who-briefing",
    label: "WHO Director-General media briefing",
    url: "https://www.who.int/news-room/speeches/item/who-director-general-s-opening-remarks-at-the-media-briefing-on-hantavirus---12-may-2026"
  },
  {
    kind: "who-don",
    label: "WHO Disease Outbreak News DON600",
    url: "https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON600"
  }
];

const numberWords = new Map([
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12]
]);

function toNumber(value) {
  const normalized = value.toLowerCase();
  return numberWords.get(normalized) ?? Number.parseInt(normalized, 10);
}

function compactHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadFeed(source) {
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.HANTATRACK_FEED;
}

function parseWhoBriefing(text) {
  const totalMatch = text.match(/So far,\s+([a-z0-9]+)\s+cases have been reported,\s+including\s+([a-z0-9]+)\s+deaths/i);
  const confirmedMatch = text.match(/([a-z0-9]+)\s+of the\s+([a-z0-9]+)\s+have been confirmed as Andes virus,\s+and the other\s+([a-z0-9]+)\s+are probable/i);

  if (!totalMatch || !confirmedMatch) return null;

  return {
    sourceLabel: "WHO Director-General media briefing",
    sourceUrl: sources[0].url,
    asOfDate: "2026-05-12",
    totalCases: toNumber(totalMatch[1]),
    confirmedCases: toNumber(confirmedMatch[1]),
    probableCases: toNumber(confirmedMatch[3]),
    inconclusiveCases: 0,
    deaths: toNumber(totalMatch[2]),
    globalRisk: /risk to health globally is low/i.test(text) ? "Low" : "Unknown"
  };
}

function parseWhoDon601(text) {
  const totals = text.match(
    /As of\s+13 May,\s+a total of\s+([a-z0-9]+)\s+cases,\s+including\s+([a-z0-9]+)\s+deaths/i
  );
  const caseBreakdown = text.match(
    /([a-z0-9]+)\s+cases were laboratory-confirmed.*?,\s+([a-z0-9]+)\s+are probable,\s+and\s+([a-z0-9]+)\s+case remains inconclusive/i
  );

  if (!totals || !caseBreakdown) return null;

  return {
    sourceLabel: "WHO Disease Outbreak News DON601",
    sourceUrl: sources[0].url,
    asOfDate: "2026-05-13",
    totalCases: toNumber(totals[1]),
    confirmedCases: toNumber(caseBreakdown[1]),
    probableCases: toNumber(caseBreakdown[2]),
    inconclusiveCases: toNumber(caseBreakdown[3]),
    deaths: toNumber(totals[2]),
    globalRisk: /global population as low/i.test(text) ? "Low" : "Unknown"
  };
}

function parseWhoDon(text) {
  const totals = text.match(
    /As of\s+([0-9]{1,2}\s+[A-Za-z]+).*?total of\s+([a-z0-9]+)\s+cases.*?including\s+([a-z0-9]+)\s+deaths/i
  );
  const caseBreakdown = text.match(/total of\s+[a-z0-9]+\s+cases\s+\(([a-z0-9]+)\s+confirmed and\s+([a-z0-9]+)\s+probable/i);

  if (!totals || !caseBreakdown) return null;

  return {
    sourceLabel: "WHO Disease Outbreak News DON600",
    sourceUrl: sources[1].url,
    asOfDate: "2026-05-08",
    totalCases: toNumber(totals[2]),
    confirmedCases: toNumber(caseBreakdown[1]),
    probableCases: toNumber(caseBreakdown[2]),
    inconclusiveCases: 0,
    deaths: toNumber(totals[3]),
    globalRisk: /risk.*global.*low/i.test(text) ? "Low" : "Unknown"
  };
}

function applyParsedFeed(feed, parsed) {
  const fetchedAt = new Date().toISOString();

  feed.version = `official-${parsed.asOfDate}-${Date.now()}`;
  feed.meta.label = "Official source feed";
  feed.meta.lastUpdated = `${parsed.asOfDate}T17:00:00Z`;
  feed.meta.lastFetched = fetchedAt;
  feed.meta.sourceAsOfDate = parsed.asOfDate;
  feed.meta.primarySource = parsed.sourceLabel;
  feed.meta.primarySourceUrl = parsed.sourceUrl;
  feed.meta.sources = [
    { name: parsed.sourceLabel, url: parsed.sourceUrl },
    ...(feed.meta.sources || []).filter((source) => source.url !== parsed.sourceUrl)
  ];
  feed.meta.statusText = `${parsed.sourceLabel}: ${parsed.totalCases} total cases, ${parsed.confirmedCases} confirmed, ${parsed.probableCases} probable, ${parsed.inconclusiveCases} inconclusive, ${parsed.deaths} deaths.`;
  feed.meta.updateCadence = "Daily at 8:00 AM local; page refreshes the local feed every 5 minutes.";
  feed.meta.summary = {
    totalCases: parsed.totalCases,
    confirmedCases: parsed.confirmedCases,
    probableCases: parsed.probableCases,
    inconclusiveCases: parsed.inconclusiveCases,
    deaths: parsed.deaths,
    globalRisk: parsed.globalRisk
  };

  const cluster = feed.reports.find((report) => report.id === "WHO-DON600-MV-HONDIUS");
  if (cluster) {
    cluster.confirmed = parsed.confirmedCases;
    cluster.suspected = parsed.probableCases;
    cluster.inconclusive = parsed.inconclusiveCases;
    cluster.deaths = parsed.deaths;
    cluster.date = parsed.asOfDate;
    cluster.sourceName = parsed.sourceLabel;
    cluster.sourceUrl = parsed.sourceUrl;
    cluster.notes = `Official WHO snapshot for the cruise-linked Andes hantavirus event: ${parsed.totalCases} total cases, including ${parsed.confirmedCases} confirmed, ${parsed.probableCases} probable, ${parsed.inconclusiveCases} inconclusive, and ${parsed.deaths} deaths. WHO assessed global public-health risk as ${parsed.globalRisk.toLowerCase()}.`;
  }

  const latestTimeline = feed.timeline.find((event) => event.title === "WHO official snapshot");
  if (latestTimeline) {
    latestTimeline.date = parsed.asOfDate;
    latestTimeline.description = `WHO reports ${parsed.totalCases} total cases: ${parsed.confirmedCases} confirmed, ${parsed.probableCases} probable, ${parsed.inconclusiveCases} inconclusive, and ${parsed.deaths} deaths, with ${parsed.globalRisk.toLowerCase()} global public-health risk.`;
  }
}

const feedSource = await fs.readFile(feedPath, "utf8");
const feed = loadFeed(feedSource);
let parsed = null;

for (const source of sources) {
  const response = await fetch(source.url, {
    headers: { "user-agent": "HantaTracker26 feed updater" }
  });

  if (!response.ok) continue;

  const text = compactHtml(await response.text());
  if (source.kind === "who-don-601") parsed = parseWhoDon601(text);
  if (source.kind === "who-briefing") parsed = parseWhoBriefing(text);
  if (source.kind === "who-don") parsed = parseWhoDon(text);
  if (parsed) break;
}

if (!parsed) {
  throw new Error("Could not parse current WHO case counts from official sources.");
}

applyParsedFeed(feed, parsed);
await fs.writeFile(feedPath, `window.HANTATRACK_FEED = ${JSON.stringify(feed, null, 2)};\n`);

console.log(
  `Updated outbreak feed from ${parsed.sourceLabel}: ${parsed.totalCases} total, ${parsed.confirmedCases} confirmed, ${parsed.probableCases} probable, ${parsed.inconclusiveCases} inconclusive, ${parsed.deaths} deaths as of ${parsed.asOfDate}.`
);
