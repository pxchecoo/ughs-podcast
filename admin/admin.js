const loginView = document.getElementById("login-view");
const dashboardView = document.getElementById("dashboard-view");
const loginForm = document.getElementById("login-form");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("login-button");
const loginStatus = document.getElementById("login-status");
const dashboardMessage = document.getElementById("dashboard-message");
const refreshButton = document.getElementById("refresh-button");
const logoutButton = document.getElementById("logout-button");
const comingSoonToggle = document.getElementById("coming-soon-toggle");
const comingSoonLabel = document.getElementById("coming-soon-label");
const siteVisibility = document.getElementById("site-visibility");
const siteStatusMessage = document.getElementById("site-status-message");
const numberFormatter = new Intl.NumberFormat("es-PR");

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return { response, body };
}

function showLogin(message = "") {
  dashboardView.hidden = true;
  loginView.hidden = false;
  comingSoonToggle.disabled = true;
  loginStatus.textContent = message;
  passwordInput.focus();
}

function showDashboard() {
  loginView.hidden = true;
  dashboardView.hidden = false;
  dashboardMessage.textContent = "";
}

function metric(id, value) {
  document.getElementById(id).textContent = numberFormatter.format(value ?? 0);
}

function renderSiteStatus(comingSoon) {
  comingSoonToggle.checked = comingSoon;
  comingSoonLabel.textContent = comingSoon ? "ON" : "OFF";
  siteVisibility.textContent = comingSoon
    ? "🟡 Coming Soon activo"
    : "🟢 Sitio público";
}

async function loadSiteStatus() {
  comingSoonToggle.disabled = true;
  siteStatusMessage.classList.remove("error");
  siteStatusMessage.textContent = "";

  try {
    const { response, body } = await apiRequest("/api/site-status");
    if (!response.ok || typeof body?.comingSoon !== "boolean") {
      throw new Error("site-status-unavailable");
    }

    renderSiteStatus(body.comingSoon);
    if (!dashboardView.hidden) comingSoonToggle.disabled = false;
    return true;
  } catch {
    siteVisibility.textContent = "Estado no disponible";
    siteStatusMessage.classList.add("error");
    siteStatusMessage.textContent = "No fue posible consultar el estado del sitio.";
    return false;
  }
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function renderChart(rows) {
  const svg = document.getElementById("traffic-chart");
  const empty = document.getElementById("chart-empty");
  svg.replaceChildren();

  if (!Array.isArray(rows) || rows.length === 0) {
    svg.hidden = true;
    empty.hidden = false;
    return;
  }

  svg.hidden = false;
  empty.hidden = true;

  const width = 860;
  const height = 280;
  const padding = { top: 20, right: 22, bottom: 37, left: 47 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = rows.map((row) => Number(row.sessions) || 0);
  const maximum = Math.max(...values, 1);
  const pointFor = (value, index) => ({
    x: padding.left + (index / Math.max(rows.length - 1, 1)) * plotWidth,
    y: padding.top + plotHeight - (value / maximum) * plotHeight,
  });

  const definitions = svgElement("defs");
  const gradient = svgElement("linearGradient", {
    id: "traffic-gradient",
    x1: "0",
    x2: "0",
    y1: "0",
    y2: "1",
  });
  gradient.append(
    svgElement("stop", { offset: "0%", "stop-color": "#d97984", "stop-opacity": "0.28" }),
    svgElement("stop", { offset: "100%", "stop-color": "#d97984", "stop-opacity": "0" }),
  );
  definitions.append(gradient);
  svg.append(definitions);

  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + (plotHeight / 4) * index;
    svg.append(svgElement("line", {
      x1: padding.left,
      x2: width - padding.right,
      y1: y,
      y2: y,
      class: "chart-grid",
    }));

    const label = svgElement("text", {
      x: padding.left - 10,
      y: y + 4,
      "text-anchor": "end",
      class: "chart-label",
    });
    label.textContent = numberFormatter.format(Math.round(maximum * (1 - index / 4)));
    svg.append(label);
  }

  const points = values.map(pointFor);
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L${points.at(-1).x},${padding.top + plotHeight} L${points[0].x},${padding.top + plotHeight} Z`;

  svg.append(svgElement("path", { d: areaPath, class: "chart-area" }));
  svg.append(svgElement("path", { d: linePath, class: "chart-line" }));

  points.forEach((point, index) => {
    const circle = svgElement("circle", {
      cx: point.x,
      cy: point.y,
      r: index === points.length - 1 ? 5 : 3,
      class: "chart-dot",
    });
    const title = svgElement("title");
    title.textContent = `${rows[index].date}: ${numberFormatter.format(values[index])} sesiones`;
    circle.append(title);
    svg.append(circle);
  });

  const dateIndexes = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])];
  dateIndexes.forEach((index) => {
    const point = points[index];
    const label = svgElement("text", {
      x: point.x,
      y: height - 9,
      "text-anchor": index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle",
      class: "chart-label",
    });
    label.textContent = new Intl.DateTimeFormat("es-PR", {
      month: "short",
      day: "numeric",
    }).format(new Date(`${rows[index].date}T12:00:00`));
    svg.append(label);
  });
}

function renderPages(rows) {
  const body = document.getElementById("pages-table");
  body.replaceChildren();

  for (const page of rows ?? []) {
    const row = document.createElement("tr");
    const pageCell = document.createElement("td");
    pageCell.className = "page-cell";
    const title = document.createElement("strong");
    title.textContent = page.title || page.path || "Página sin título";
    const path = document.createElement("span");
    path.textContent = page.path || "/";
    pageCell.append(title, path);

    const views = document.createElement("td");
    views.textContent = numberFormatter.format(page.views ?? 0);
    row.append(pageCell, views);
    body.append(row);
  }
}

function renderDevices(rows) {
  const list = document.getElementById("device-list");
  list.replaceChildren();
  const total = Math.max(
    (rows ?? []).reduce((sum, row) => sum + (Number(row.activeUsers) || 0), 0),
    1,
  );

  for (const device of rows ?? []) {
    const users = Number(device.activeUsers) || 0;
    const percentage = Math.round((users / total) * 100);
    const wrapper = document.createElement("div");
    wrapper.className = "device-row";
    const copy = document.createElement("div");
    copy.className = "device-copy";
    const name = document.createElement("span");
    name.textContent = device.device || "Desconocido";
    const value = document.createElement("span");
    value.textContent = `${numberFormatter.format(users)} · ${percentage}%`;
    copy.append(name, value);
    const track = document.createElement("progress");
    track.className = "device-track";
    track.max = 100;
    track.value = percentage;
    track.setAttribute("aria-label", `${name.textContent}: ${percentage}%`);
    wrapper.append(copy, track);
    list.append(wrapper);
  }
}

function renderCountries(rows) {
  const body = document.getElementById("countries-table");
  body.replaceChildren();

  for (const country of (rows ?? []).slice(0, 12)) {
    const row = document.createElement("tr");
    for (const value of [
      country.country || "Desconocido",
      numberFormatter.format(country.sessions ?? 0),
      numberFormatter.format(country.activeUsers ?? 0),
      numberFormatter.format(country.views ?? 0),
    ]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
}

function renderDashboard(data) {
  metric("active-now", data.realtime?.activeUsers);
  metric("users-today", data.today?.activeUsers);
  metric("views-today", data.today?.views);
  metric("users-7", data.last7Days?.activeUsers);
  metric("views-7", data.last7Days?.views);
  metric("users-30", data.last30Days?.activeUsers);
  metric("views-30", data.last30Days?.views);
  renderChart(data.daily);
  renderPages(data.topPages);
  renderDevices(data.devices);
  renderCountries(data.countries);

  document.getElementById("updated-at").textContent = `Actualizado ${new Intl.DateTimeFormat("es-PR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(data.generatedAt))}`;
}

async function loadAnalytics({ showUnauthorizedMessage = false } = {}) {
  refreshButton.disabled = true;
  dashboardMessage.textContent = "";

  try {
    const { response, body } = await apiRequest("/api/analytics");

    if (response.status === 401 || response.status === 403) {
      showLogin(showUnauthorizedMessage ? "Tu sesión terminó. Inicia sesión nuevamente." : "");
      return false;
    }

    if (!response.ok || !body) {
      throw new Error("analytics-unavailable");
    }

    showDashboard();
    renderDashboard(body);
    return true;
  } catch {
    if (dashboardView.hidden) {
      showLogin("No fue posible conectar con el servicio de Analytics.");
    } else {
      dashboardMessage.textContent = "No fue posible actualizar los datos. Intenta nuevamente.";
    }
    return false;
  } finally {
    refreshButton.disabled = false;
  }
}

async function loadDashboard({ showUnauthorizedMessage = false } = {}) {
  try {
    const { response, body } = await apiRequest("/api/session");

    if (response.status === 401 || response.status === 403) {
      showLogin(showUnauthorizedMessage ? "Tu sesión terminó. Inicia sesión nuevamente." : "");
      return false;
    }

    if (!response.ok || body?.authenticated !== true) {
      throw new Error("session-unavailable");
    }

    showDashboard();
    await Promise.all([loadAnalytics({ showUnauthorizedMessage: true }), loadSiteStatus()]);
    return true;
  } catch {
    showLogin("No fue posible comprobar la sesión de administrador.");
    return false;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = passwordInput.value;

  if (!password) {
    loginStatus.textContent = "Escribe la contraseña de administrador.";
    return;
  }

  loginButton.disabled = true;
  loginButton.textContent = "Verificando…";
  loginStatus.textContent = "";

  try {
    const { response } = await apiRequest("/api/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    passwordInput.value = "";

    if (response.ok) {
      await loadDashboard({ showUnauthorizedMessage: true });
    } else if (response.status === 429) {
      loginStatus.textContent = "Demasiados intentos. Espera antes de intentarlo nuevamente.";
    } else if (response.status === 401) {
      loginStatus.textContent = "Credenciales inválidas.";
    } else {
      loginStatus.textContent = "La autenticación no está disponible en este momento.";
    }
  } catch {
    passwordInput.value = "";
    loginStatus.textContent = "No fue posible conectar con el servidor.";
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "Entrar al panel";
  }
});

document.getElementById("toggle-password").addEventListener("click", () => {
  const showing = passwordInput.type === "text";
  passwordInput.type = showing ? "password" : "text";
  document.getElementById("toggle-password").setAttribute(
    "aria-label",
    showing ? "Mostrar contraseña" : "Ocultar contraseña",
  );
});

refreshButton.addEventListener("click", () => {
  loadAnalytics({ showUnauthorizedMessage: true });
  loadSiteStatus();
});

comingSoonToggle.addEventListener("change", async () => {
  const previousValue = !comingSoonToggle.checked;
  const requestedValue = comingSoonToggle.checked;
  renderSiteStatus(previousValue);
  comingSoonToggle.disabled = true;
  siteStatusMessage.classList.remove("error");
  siteStatusMessage.textContent = "Guardando…";

  try {
    const { response, body } = await apiRequest("/api/site-status", {
      method: "POST",
      body: JSON.stringify({ comingSoon: requestedValue }),
    });

    if (response.status === 401 || response.status === 403) {
      showLogin("Tu sesión terminó. Inicia sesión nuevamente.");
      return;
    }

    if (!response.ok || typeof body?.comingSoon !== "boolean") {
      throw new Error("site-status-update-failed");
    }

    renderSiteStatus(body.comingSoon);
    siteStatusMessage.textContent = body.comingSoon
      ? "Modo Coming Soon activado"
      : "Modo Coming Soon desactivado";
  } catch {
    renderSiteStatus(previousValue);
    siteStatusMessage.classList.add("error");
    siteStatusMessage.textContent = "No fue posible cambiar el modo Coming Soon.";
  } finally {
    if (!dashboardView.hidden) comingSoonToggle.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await apiRequest("/api/logout", { method: "POST" });
  } finally {
    logoutButton.disabled = false;
    showLogin("Sesión cerrada correctamente.");
  }
});

loadDashboard();
