// https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite on web ships SQLite as a wasm file.
config.resolver.assetExts.push('wasm');

// SQLite's web worker needs SharedArrayBuffer, which browsers only enable on
// cross-origin isolated pages. "credentialless" still lets the ExerciseDB GIFs load.
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  middleware(req, res, next);
};

module.exports = config;
