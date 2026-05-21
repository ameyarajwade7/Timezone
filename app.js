const STORAGE_KEY = "overlap-timezones-v1";

const citySearch = document.getElementById("citySearch");
const addButton = document.getElementById("addButton");
const suggestions = document.getElementById("suggestions");
const cards = document.getElementById("cards");
const emptyState = document.getElementById("emptyState");
const cardTemplate = document.getElementById("cardTemplate");
const countBadge = document.getElementById("countBadge");
const bgOverlapGraph = document.getElementById("bgOverlapGraph");
const resetTimeButton = document.getElementById("resetTimeButton");
const graphHint = document.getElementById("graphHint");

const DEFAULT_ZONES = [
  "America/New_York",
  "Europe/London",
  "Asia/Tokyo"
];

const allZones = getAllTimeZones();
const searchIndex = buildSearchIndex();
const selectedPlaces = loadSavedPlaces();
let refreshTimer = null;
let searchDebounceTimer = null;
let searchRequestId = 0;
let compareUtcMs = null;
const zonedPartsFormatters = new Map();

if (!selectedPlaces.length) {
  DEFAULT_ZONES.forEach((zone) => {
    selectedPlaces.push({
      id: createPlaceId(getCityName(zone), zone),
      name: getCityName(zone),
      zone
    });
  });
}

renderCards();
startClockUpdates();
window.addEventListener("resize", drawBackgroundOverlap);

citySearch.addEventListener("input", () => {
  scheduleSuggestionsRender();
});

citySearch.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addFromInput();
  }
});

addButton.addEventListener("click", addFromInput);
resetTimeButton.addEventListener("click", () => {
  compareUtcMs = null;
  updateAllCardTimes();
});

document.addEventListener("click", (event) => {
  if (!suggestions.contains(event.target) && event.target !== citySearch) {
    clearSuggestions();
  }
});

function getAllTimeZones() {
  if (typeof Intl.supportedValuesOf === "function") {
    return Intl.supportedValuesOf("timeZone");
  }

  return [
    "UTC",
    "America/New_York",
    "America/Los_Angeles",
    "America/Sao_Paulo",
    "Europe/London",
    "Europe/Paris",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Asia/Tokyo",
    "Australia/Sydney"
  ];
}

function loadSavedPlaces() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    if (!parsed.length) {
      return [];
    }

    if (typeof parsed[0] === "string") {
      return parsed
        .map((zone) => normalizeTimeZone(zone))
        .filter(Boolean)
        .map((zone) => ({
          id: createPlaceId(getCityName(zone), zone),
          name: getCityName(zone),
          zone
        }));
    }

    return parsed
      .filter((item) => item && typeof item.zone === "string")
      .map((item) => {
        const zone = normalizeTimeZone(item.zone);
        if (!zone) {
          return null;
        }

        const safeName = typeof item.name === "string" && item.name.trim() ? item.name.trim() : getCityName(zone);
        return {
          id: createPlaceId(safeName, zone),
          name: safeName,
          zone
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function savePlaces() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedPlaces));
}

async function addFromInput() {
  const query = citySearch.value.trim();
  if (!query) {
    return;
  }

  let matches = await findMatches(query, 1, { includeRemote: false });
  if (!matches.length) {
    matches = await findMatches(query, 1, { includeRemote: true });
  }
  const close = matches.length ? matches[0] : null;

  if (!close) {
    citySearch.setCustomValidity("No matching city/place found");
    citySearch.reportValidity();
    setTimeout(() => citySearch.setCustomValidity(""), 1000);
    return;
  }

  addPlace({
    name: close.displayName || getCityName(close.zone),
    zone: close.zone
  });
  citySearch.value = "";
  clearSuggestions();
  renderCards();
}

function findBestMatch(query) {
  const matches = findMatches(query, 1);
  return matches.length ? matches[0].zone : null;
}

function renderSuggestions(query) {
  return renderSuggestionsAsync(query);
}

async function renderSuggestionsAsync(query) {
  if (!query) {
    clearSuggestions();
    return;
  }

  const results = await findMatches(query, 8, { includeRemote: true });

  suggestions.innerHTML = "";

  if (!results.length) {
    clearSuggestions();
    return;
  }

  results.forEach((entry) => {
    const li = document.createElement("li");
    li.textContent = entry.label;
    li.dataset.zone = entry.zone;
    li.addEventListener("click", () => {
      addPlace({
        name: entry.displayName || getCityName(entry.zone),
        zone: entry.zone
      });
      citySearch.value = "";
      clearSuggestions();
      renderCards();
    });
    suggestions.appendChild(li);
  });

  suggestions.classList.add("show");
}

function scheduleSuggestionsRender() {
  const query = citySearch.value.trim();
  const requestId = ++searchRequestId;

  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }

  searchDebounceTimer = setTimeout(async () => {
    const latestQuery = citySearch.value.trim();
    if (requestId !== searchRequestId) {
      return;
    }

    await renderSuggestionsAsync(latestQuery);
  }, 220);
}

function clearSuggestions() {
  suggestions.classList.remove("show");
  suggestions.innerHTML = "";
}

function renderCards() {
  cards.innerHTML = "";

  const places = selectedPlaces.slice();

  places.forEach((place) => {
    const node = cardTemplate.content.firstElementChild.cloneNode(true);
    const rgb = getPlaceColorRgb(place.id);
    node.style.setProperty("--place-rgb", rgb);
    node.querySelector(".city").textContent = place.name;
    node.querySelector(".zone").textContent = place.zone;
    const scrubber = node.querySelector(".time-scrubber");

    scrubber.addEventListener("input", () => {
      const minutes = Number(scrubber.value);
      applySliderTime(place.zone, minutes);
      updateAllCardTimes();
    });

    node.querySelector(".remove-btn").addEventListener("click", () => {
      removePlace(place.id);
      renderCards();
    });

    updateCardTime(node, place.zone, getActiveDate());
    cards.appendChild(node);
  });

  countBadge.textContent = String(places.length);
  emptyState.classList.toggle("hide", places.length > 0);
  drawBackgroundOverlap();
}

function updateAllCardTimes() {
  const nodes = cards.querySelectorAll(".time-card");
  const places = selectedPlaces.slice();
  const activeDate = getActiveDate();

  nodes.forEach((node, i) => {
    const place = places[i];
    if (place) {
      updateCardTime(node, place.zone, activeDate);
    }
  });

  drawBackgroundOverlap();
}

function startClockUpdates() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(updateAllCardTimes, 1000);
}

function updateCardTime(cardNode, zone, sourceDate) {
  const activeDate = sourceDate || new Date();
  const time = activeDate.toLocaleTimeString([], {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const date = activeDate.toLocaleDateString([], {
    timeZone: zone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });

  const localParts = getZonedParts(activeDate, zone);
  const minutes = localParts.hour * 60 + localParts.minute;

  cardNode.querySelector(".time").textContent = time;
  cardNode.querySelector(".date").textContent = date;
  cardNode.querySelector(".offset").textContent = getUtcOffset(zone, activeDate);
  cardNode.querySelector(".scrub-readout").textContent = formatMinutes(minutes);

  const scrubber = cardNode.querySelector(".time-scrubber");
  if (scrubber) {
    scrubber.value = String(minutes);
  }
}

function getUtcOffset(zone, date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "shortOffset"
  });

  const parts = formatter.formatToParts(date);
  const offset = parts.find((part) => part.type === "timeZoneName")?.value || "UTC";
  return offset.replace("GMT", "UTC");
}

function getCityName(zone) {
  const parts = zone.split("/");
  return parts[parts.length - 1].replace(/_/g, " ");
}

function formatZoneLabel(zone) {
  const parts = zone.split("/");
  const city = parts[parts.length - 1].replace(/_/g, " ");
  const region = parts.slice(0, -1).join(" / ").replace(/_/g, " ");
  return `${city} (${region || "Global"})`;
}

function normalizeText(text) {
  return text.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9/_-]/g, "");
}

function normalizeZone(zone) {
  return zone.toLowerCase().replace(/_/g, "").replace(/\//g, "");
}

function buildSearchIndex() {
  const index = [];

  allZones.forEach((zone) => {
    const normalizedZone = normalizeTimeZone(zone);
    if (!normalizedZone) {
      return;
    }

    const parts = normalizedZone.split("/");
    const city = parts[parts.length - 1].replace(/_/g, " ");
    const region = parts.slice(0, -1).join(" ").replace(/_/g, " ");
    const label = formatZoneLabel(normalizedZone);

    index.push({
      zone: normalizedZone,
      label,
      displayName: city,
      token: normalizeText(`${city} ${region} ${normalizedZone}`),
      priority: 2
    });
  });

  return index;
}

async function findMatches(query, limit, options = { includeRemote: false }) {
  const token = normalizeText(query);
  if (!token) {
    return [];
  }

  const localRanked = searchIndex
    .filter((entry) => entry.token.includes(token))
    .map((entry) => {
      const startBoost = entry.token.startsWith(token) ? -1 : 0;
      const proximityBoost = entry.token.indexOf(token) / 100;

      return {
        ...entry,
        score: entry.priority + startBoost + proximityBoost
      };
    })
    .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label));

  let ranked = [...localRanked];

  if (options.includeRemote) {
    const remote = await fetchCityTimeZones(query, limit);
    const remoteRanked = remote.map((entry, idx) => ({
      ...entry,
      score: -3 + idx / 100
    }));
    ranked = [...remoteRanked, ...localRanked];
  }

  const unique = [];
  const seen = new Set();

  ranked.forEach((entry) => {
    const key = `${entry.zone}::${(entry.displayName || "").toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    unique.push(entry);
  });

  return unique.slice(0, limit);
}

async function fetchCityTimeZones(query, limit) {
  if (query.length < 2) {
    return [];
  }

  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=${Math.max(limit, 6)}&language=en&format=json`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const results = Array.isArray(data.results) ? data.results : [];

    return results
      .filter((item) => typeof item.timezone === "string" && item.timezone.length > 0)
      .map((item) => {
        const zone = normalizeTimeZone(item.timezone);
        if (!zone) {
          return null;
        }

        const admin = item.admin1 ? `, ${item.admin1}` : "";
        const country = item.country ? `, ${item.country}` : "";
        return {
          zone,
          label: `${item.name}${admin}${country} (${zone})`,
          displayName: item.name,
          token: normalizeText(`${item.name} ${item.admin1 || ""} ${item.country || ""} ${zone}`),
          priority: 0
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function addPlace(place) {
  const normalizedName = (place.name || "").trim();
  const normalizedZone = normalizeTimeZone(place.zone);
  if (!normalizedName || !normalizedZone) {
    return;
  }

  const id = createPlaceId(normalizedName, normalizedZone);
  const exists = selectedPlaces.some((item) => item.id === id);
  if (exists) {
    return;
  }

  selectedPlaces.push({
    id,
    name: normalizedName,
    zone: normalizedZone
  });
  savePlaces();
}

function removePlace(id) {
  const index = selectedPlaces.findIndex((item) => item.id === id);
  if (index === -1) {
    return;
  }

  selectedPlaces.splice(index, 1);
  savePlaces();
}

function createPlaceId(name, zone) {
  return `${normalizeText(name)}::${zone}`;
}

function normalizeTimeZone(zone) {
  if (typeof zone !== "string" || !zone.trim()) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function getActiveDate() {
  return compareUtcMs === null ? new Date() : new Date(compareUtcMs);
}

function applySliderTime(zone, minutesOfDay) {
  const baseDate = getActiveDate();
  const parts = getZonedParts(baseDate, zone);
  const targetHour = Math.floor(minutesOfDay / 60);
  const targetMinute = minutesOfDay % 60;

  compareUtcMs = zonedDateTimeToUtcMs(
    zone,
    parts.year,
    parts.month,
    parts.day,
    targetHour,
    targetMinute
  );
}

function getZonedParts(date, zone) {
  let formatter = zonedPartsFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    zonedPartsFormatters.set(zone, formatter);
  }

  const parts = formatter.formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value || 0),
    month: Number(parts.find((part) => part.type === "month")?.value || 1),
    day: Number(parts.find((part) => part.type === "day")?.value || 1),
    hour: Number(parts.find((part) => part.type === "hour")?.value || 0),
    minute: Number(parts.find((part) => part.type === "minute")?.value || 0),
    second: Number(parts.find((part) => part.type === "second")?.value || 0)
  };
}

function zonedDateTimeToUtcMs(zone, year, month, day, hour, minute) {
  let utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);

  for (let i = 0; i < 4; i += 1) {
    const guessParts = getZonedParts(new Date(utcGuess), zone);
    const representedUtc = Date.UTC(
      guessParts.year,
      guessParts.month - 1,
      guessParts.day,
      guessParts.hour,
      guessParts.minute,
      0
    );

    const wantedUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    const diff = wantedUtc - representedUtc;
    utcGuess += diff;

    if (Math.abs(diff) < 1000) {
      break;
    }
  }

  return utcGuess;
}

function formatMinutes(totalMinutes) {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function drawBackgroundOverlap() {
  if (!bgOverlapGraph) {
    return;
  }

  const ctx = bgOverlapGraph.getContext("2d");
  if (!ctx) {
    return;
  }

  const width = window.innerWidth || 1280;
  const height = window.innerHeight || 720;
  const dpr = window.devicePixelRatio || 1;

  bgOverlapGraph.width = Math.floor(width * dpr);
  bgOverlapGraph.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const places = selectedPlaces.slice();
  drawBackgroundGrid(ctx, width, height);
  drawCurrentCursor(ctx, width, height);
  syncGraphHint();

  if (!places.length) {
    return;
  }

  const centerY = height * 0.56;
  const bandMaxAmplitude = Math.max(44, Math.min(118, height * 0.2));
  const animationPhase = (Date.now() % 160000) / 160000;

  places.forEach((place, idx) => {
    const rgb = getPlaceColorRgb(place.id);
    drawPlaceCoverageBand(ctx, width, centerY, bandMaxAmplitude, place.zone, rgb, idx, places.length, animationPhase);
  });
}

function drawBackgroundGrid(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;

  for (let hour = 0; hour <= 24; hour += 2) {
    const x = ((width - 1) * hour) / 24;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  ctx.restore();
}

function drawPlaceCoverageBand(ctx, width, centerY, bandMaxAmplitude, zone, rgb, index, total, animationPhase) {
  const [r, g, b] = rgb.split(" ").map((v) => Number(v));
  const amplitude = bandMaxAmplitude * (0.62 + ((index % 5) * 0.07));
  const baseThickness = 11 + (index % 4) * 1.5;
  const laneOffset = (index - (total - 1) / 2) * 1.5;
  const baseDate = getActiveDate();
  const points = [];
  const drift = animationPhase * Math.PI * 2;

  for (let hour = 0; hour <= 24; hour += 0.5) {
    const x = (width * hour) / 24;
    const utcSample = baseDate.getTime() + (hour - 12) * 3600000;
    const local = getZonedParts(new Date(utcSample), zone);
    const intensity = local.hour >= 8 && local.hour < 20 ? 1 : 0.3;
    const phase = (index * Math.PI) / 7 + drift;
    const primary = Math.sin((hour / 24) * Math.PI * 2 + phase);
    const secondary = Math.sin((hour / 24) * Math.PI * 4 + phase * 0.7 + drift * 0.6) * 0.5;
    const tertiary = Math.sin((hour / 24) * Math.PI * 8 + phase * 1.4 + drift * 1.2) * 0.18;
    const wave = (primary + secondary + tertiary) * amplitude * (0.34 + intensity * 0.66);
    const topY = centerY + laneOffset - baseThickness - wave;
    const bottomY = centerY + laneOffset + baseThickness + wave;
    points.push({ x, topY, bottomY, intensity });
  }

  const grad = ctx.createLinearGradient(0, centerY - bandMaxAmplitude, 0, centerY + bandMaxAmplitude);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.12)`);
  grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.36)`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.12)`);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.shadowBlur = 10;
  ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.16)`;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].bottomY);
  points.forEach((point) => ctx.lineTo(point.x, point.topY));
  for (let i = points.length - 1; i >= 0; i -= 1) {
    ctx.lineTo(points[i].x, points[i].bottomY);
  }
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  const glowGrad = ctx.createLinearGradient(0, centerY - bandMaxAmplitude * 1.1, 0, centerY + bandMaxAmplitude * 1.1);
  glowGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.04)`);
  glowGrad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.18)`);
  glowGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.04)`);
  ctx.fillStyle = glowGrad;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, idx) => {
    if (idx === 0) {
      ctx.moveTo(point.x, point.topY);
      return;
    }
    ctx.lineTo(point.x, point.topY);
  });
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.78)`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

function drawCurrentCursor(ctx, width, height) {
  if (compareUtcMs === null) {
    return;
  }

  const x = width / 2;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.strokeStyle = "rgba(255, 206, 94, 0.65)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 8]);
  ctx.stroke();
  ctx.restore();
}

function syncGraphHint() {
  if (!graphHint) {
    return;
  }

  if (compareUtcMs === null) {
    graphHint.textContent = "Live mode";
    return;
  }

  const d = new Date(compareUtcMs);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  graphHint.textContent = `Compare mode ${hh}:${mm} UTC`;
}

function getPlaceColorRgb(seedText) {
  const hash = hashString(seedText);
  const hue = Math.abs(hash) % 360;
  return hslToRgbString(hue, 82, 64);
}

function hashString(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function hslToRgbString(h, s, l) {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;

  if (hp >= 0 && hp < 1) {
    r = c;
    g = x;
  } else if (hp < 2) {
    r = x;
    g = c;
  } else if (hp < 3) {
    g = c;
    b = x;
  } else if (hp < 4) {
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const m = light - c / 2;
  const red = Math.round((r + m) * 255);
  const green = Math.round((g + m) * 255);
  const blue = Math.round((b + m) * 255);
  return `${red} ${green} ${blue}`;
}

