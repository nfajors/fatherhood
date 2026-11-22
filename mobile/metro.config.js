// The app shares two small pure modules with the website (coach reply formatting
// and site-path-to-screen mapping), so Metro also watches those folders.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../src/lib/coach"), path.resolve(__dirname, "../src/lib/mobile")];
module.exports = config;
