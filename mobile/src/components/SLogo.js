import React from "react";
import { Image, StyleSheet } from "react-native";

// The one app logo (cream crescent + red S + gold stars). Used everywhere
// (header, profile picker, login) so it looks identical on every screen.
const SIZES = {
  sm: { size: 40, radius: 11 },
  md: { size: 64, radius: 16 },
  lg: { size: 96, radius: 22 },
};

export default function SLogo({ size = "sm", style }) {
  const s = SIZES[size] || SIZES.sm;
  return (
    <Image
      source={require("../../assets/logo_badge.png")}
      style={[{ width: s.size, height: s.size, borderRadius: s.radius }, styles.img, style]}
      resizeMode="cover"
    />
  );
}

const styles = StyleSheet.create({
  img: {
    backgroundColor: "#000",
  },
});
