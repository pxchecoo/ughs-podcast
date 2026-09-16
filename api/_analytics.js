import { BetaAnalyticsDataClient } from "@google-analytics/data";

let analyticsClient;

function requireServerEnvironment() {
  const propertyId = process.env.GA_PROPERTY_ID;
  const clientEmail = process.env.GA_CLIENT_EMAIL;
  const privateKey = process.env.GA_PRIVATE_KEY;

  if (!propertyId || !clientEmail || !privateKey) {
    const error = new Error("Analytics server configuration is incomplete.");
    error.code = "ANALYTICS_CONFIG_ERROR";
    throw error;
  }

  const normalizedPropertyId = propertyId.replace(/^properties\//, "");

  if (!/^\d+$/.test(normalizedPropertyId)) {
    const error = new Error("Analytics server configuration is invalid.");
    error.code = "ANALYTICS_CONFIG_ERROR";
    throw error;
  }

  return {
    property: `properties/${normalizedPropertyId}`,
    credentials: {
      client_email: clientEmail,
      private_key: normalizePrivateKey(privateKey),
    },
  };
}
export function normalizePrivateKey(privateKey) {
  return privateKey.replace(/\\n/g, "\n");
}

function getAnalyticsClient(credentials) {
  if (!analyticsClient) {
    analyticsClient = new BetaAnalyticsDataClient({ credentials });
  }

  return analyticsClient;
}

function numberValue(row, index) {
  const value = Number(row?.metricValues?.[index]?.value ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function dimensionValue(row, index) {
  return row?.dimensionValues?.[index]?.value ?? "";
}

function summaryFrom(report) {
  const row = report?.rows?.[0];

  return {
    activeUsers: numberValue(row, 0),
    views: numberValue(row, 1),
    sessions: numberValue(row, 2),
  };
}

function isoDate(value) {
  if (!/^\d{8}$/.test(value)) return value;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function historicalRequests() {
  const summaryMetrics = [
    { name: "activeUsers" },
    { name: "screenPageViews" },
    { name: "sessions" },
  ];
  const last30Days = [{ startDate: "29daysAgo", endDate: "today" }];

  return {
    firstBatch: [
      {
        dateRanges: [{ startDate: "today", endDate: "today" }],
        metrics: summaryMetrics,
      },
      {
        dateRanges: [{ startDate: "6daysAgo", endDate: "today" }],
        metrics: summaryMetrics,
      },
      {
        dateRanges: last30Days,
        metrics: summaryMetrics,
      },
      {
        dateRanges: last30Days,
        dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
        metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 10,
      },
      {
        dateRanges: last30Days,
        dimensions: [{ name: "deviceCategory" }],
        metrics: [
          { name: "activeUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
        ],
        orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      },
    ],
    secondBatch: [
      {
        dateRanges: last30Days,
        dimensions: [{ name: "country" }],
        metrics: [
          { name: "activeUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
        ],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 20,
      },
      {
        dateRanges: last30Days,
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "activeUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
        ],
        orderBys: [{ dimension: { dimensionName: "date" } }],
        keepEmptyRows: true,
      },
    ],
  };
}

export async function getAnalyticsDashboardData() {
  const { property, credentials } = requireServerEnvironment();
  const client = getAnalyticsClient(credentials);
  const { firstBatch, secondBatch } = historicalRequests();

  const [[realtime], [firstBatchResponse], [secondBatchResponse]] =
    await Promise.all([
      client.runRealtimeReport({
        property,
        metrics: [{ name: "activeUsers" }],
        minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
      }),
      client.batchRunReports({ property, requests: firstBatch }),
      client.batchRunReports({ property, requests: secondBatch }),
    ]);

  const [today, last7Days, last30Days, pages, devices] =
    firstBatchResponse.reports ?? [];
  const [countries, daily] = secondBatchResponse.reports ?? [];

  return {
    generatedAt: new Date().toISOString(),
    realtime: {
      activeUsers: numberValue(realtime?.rows?.[0], 0),
      windowMinutes: 30,
    },
    today: summaryFrom(today),
    last7Days: summaryFrom(last7Days),
    last30Days: summaryFrom(last30Days),
    topPages: (pages?.rows ?? []).map((row) => ({
      path: dimensionValue(row, 0),
      title: dimensionValue(row, 1),
      views: numberValue(row, 0),
      activeUsers: numberValue(row, 1),
    })),
    devices: (devices?.rows ?? []).map((row) => ({
      device: dimensionValue(row, 0),
      activeUsers: numberValue(row, 0),
      sessions: numberValue(row, 1),
      views: numberValue(row, 2),
    })),
    countries: (countries?.rows ?? []).map((row) => ({
      country: dimensionValue(row, 0),
      activeUsers: numberValue(row, 0),
      sessions: numberValue(row, 1),
      views: numberValue(row, 2),
    })),
    daily: (daily?.rows ?? []).map((row) => ({
      date: isoDate(dimensionValue(row, 0)),
      activeUsers: numberValue(row, 0),
      sessions: numberValue(row, 1),
      views: numberValue(row, 2),
    })),
  };
}
