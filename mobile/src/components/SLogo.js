import React from "react";
import { View, Text, StyleSheet } from "react-native";

// The one app logo: red serif S on a dark rounded badge. Used everywhere
// (header, profile picker, login) so it looks identical on every screen.
// The badge colour is solid (not see-through), so it stays dark even when it
// sits on top of a picture or a lighter background.
const SIZES = {
  sm: { width: 36, height: 42, radius: 11, font: 30, line: 36 },
  md: { width: 56, height: 64, radius: 16, font: 44, line: 52 },
  lg: { width: 62, height: 72, radius: 18, font: 52, line: 60 },
};

export default function SLogo({ size = "sm", style }) {
  const s = SIZES[size] || SIZES.sm;
  return (
    <View
      style={[
        styles.badge,
        { width: s.width, height: s.height, borderRadius: s.radius },
        style,
      ]}
    >
      <Text style={[styles.letter, { fontSize: s.font, lineHeight: s.line }]}>S</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: "#101119",
    alignItems: "center",
    justifyContent: "center",
  },
  letter: {
    color: "#e50914",
    fontWeight: "900",
    fontFamily: "serif",
  },
});
