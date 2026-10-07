import { Platform } from "react-native";

// Automatically detected local LAN IP for physical device / Expo Go access
const LAN_IP = "192.168.1.8";

const getBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.hostname) {
    const host = window.location.hostname;
    return `http://${host}:8000`;
  }
  return Platform.OS === "web" ? "http://localhost:8000" : `http://${LAN_IP}:8000`;
};

export const API_BASE_URL = getBaseUrl();

// Public website (privacy policy, terms, delete-account pages). On the web build it is
// the site itself; in the phone app set EXPO_PUBLIC_SITE_URL to the live site address.
export const SITE_URL = (
  process.env.EXPO_PUBLIC_SITE_URL ||
  (Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : "")
).replace(/\/$/, "");
