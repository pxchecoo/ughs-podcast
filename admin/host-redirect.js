const PUBLIC_SITE_HOSTS = new Set([
  "universityenvivo.com",
  "www.universityenvivo.com",
]);

// The public website is currently served by GitHub Pages, while the private
// Analytics API runs on Vercel. Keep the admin UI and its HttpOnly session
// cookie on the same Vercel origin until the custom domain is moved to Vercel.
if (PUBLIC_SITE_HOSTS.has(window.location.hostname)) {
  const target = new URL("https://ughs-podcast.vercel.app/admin");
  target.search = window.location.search;
  target.hash = window.location.hash;
  window.location.replace(target.href);
}
