/** The website's colors (src/app/globals.css). */
import { Platform } from "react-native";

export const colors = {
  navy950: "#070f1f",
  navy900: "#0c1a33",
  navy800: "#132546",
  navy700: "#1d3561",
  navy100: "#e3e8f2",
  gold600: "#a8741f",
  gold500: "#c48b2c",
  gold400: "#d9a446",
  gold100: "#f8edd8",
  paper: "#fbfaf7",
  ink: "#121826",
  muted: "#5b6475",
  line: "#e6e2d9",
  white: "#ffffff",
  danger: "#9b2c2c",
};

export const serif = Platform.select({ ios: "Georgia", android: "serif", default: "Georgia, 'Times New Roman', serif" });
export const space = (n: number) => n * 4;
