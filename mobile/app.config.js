// Wraps app.json. On EAS, a live build must name a real public HTTPS origin, or it fails here, before any bundling.
const PLACEHOLDER = /your-host|example\.(com|org|net|test)|<|>|localhost|127\.0\.0\.1|^https:\/\/\.\.\./i;

function checkLiveOrigin(mode, origin) {
  if (mode !== 'live') return;
  const value = (origin || '').trim();
  let url;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== 'https:' || PLACEHOLDER.test(value) || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      `EXPO_PUBLIC_SEARCH_MODE=live needs EXPO_PUBLIC_API_BASE_URL set to the API's public HTTPS origin ` +
        `(like https://starfish-api.onrender.com), got "${value}". Set it in the EAS environment for this profile.`,
    );
  }
}

module.exports = ({ config }) => {
  // EAS CLI reads this locally before it loads EAS environment variables; the build worker (EAS_BUILD) has them all.
  if (process.env.EAS_BUILD) checkLiveOrigin(process.env.EXPO_PUBLIC_SEARCH_MODE, process.env.EXPO_PUBLIC_API_BASE_URL);
  return config;
};
module.exports.checkLiveOrigin = checkLiveOrigin;
