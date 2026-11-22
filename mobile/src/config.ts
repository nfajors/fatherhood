import Constants from "expo-constants";

/** The website the app talks to. Set EXPO_PUBLIC_API_URL for a local server (e.g. http://192.168.1.20:3000). */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://fatherhood.school").replace(/\/$/, "");

export const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";
