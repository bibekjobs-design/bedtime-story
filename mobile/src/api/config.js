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
