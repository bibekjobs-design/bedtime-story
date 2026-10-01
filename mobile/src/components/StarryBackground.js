import React from "react";
import { View, StyleSheet, ImageBackground, Dimensions, Platform } from "react-native";

export default function StarryBackground({ children }) {
  return (
    <ImageBackground
      source={require("../../assets/images/app_bg_stars.jpg")}
      style={styles.container}
      resizeMode="cover"
    >
      <View style={styles.overlay} pointerEvents="none" />
      <View style={styles.contentContainer}>{children}</View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "#050714", // Fallback color
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5, 7, 20, 0.4)", // Slight dark overlay to ensure text readability
  },
  contentContainer: {
    flex: 1,
    zIndex: 1,
  },
});

