import React, { useEffect, useRef, useState } from "react";
import { View, Text, Animated, Easing, StyleSheet, Platform } from "react-native";

// Full-screen "your story is getting ready" overlay, shared by the Library,
// category and Create screens so every wait looks and feels the same.
//
// - Only appears if loading takes longer than SHOW_DELAY_MS, so stories whose
//   audio is already saved (~0.1s) open instantly with no flash.
// - Rotates short, calming messages every ROTATE_MS while the story prepares.
// - After SLOW_AFTER_MS it reassures the user that it's still working.
//
// Props:
//   visible      - true while a story is being prepared
//   mode         - "library" | "narrator" | "clone"
//   storyTitle   - (library) title of the story being opened
//   voiceName    - (narrator/clone) narrator's or parent's-voice name

const SHOW_DELAY_MS = 700;
const ROTATE_MS = 4500;
const SLOW_AFTER_MS = 25000;
const USE_NATIVE = Platform.OS !== "web";

const CALM_MESSAGES = [
  "Take a slow, deep breath together 🌙",
  "Did you know? A calm, regular bedtime routine helps children fall asleep faster.",
  "Snuggle up - your story is almost ready ✨",
  "Reading together every night builds vocabulary and a special bond.",
  "Dimming the lights a little before bed helps little bodies get ready for sleep.",
  "Close your eyes for a moment and picture a cozy, starry sky ⭐",
  "Slow, gentle breaths help the whole body relax.",
  "Soft music and a quiet room make bedtime stories even dreamier 💤",
];

function headlineFor(mode, storyTitle, voiceName) {
  if (mode === "clone") return `Warming up ${voiceName || "your parent's"} voice...`;
  if (mode === "narrator") return voiceName ? `${voiceName} is getting ready to read...` : "Weaving your bedtime story...";
  return storyTitle ? `Getting "${storyTitle}" ready...` : "Getting your story ready...";
}

export default function StoryLoadingOverlay({ visible, mode = "library", storyTitle, voiceName }) {
  const [show, setShow] = useState(false);
  const [msgIndex, setMsgIndex] = useState(0);
  const [slow, setSlow] = useState(false);

  const fade = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  // Delay showing, so instant (cached) opens never flash the overlay.
  useEffect(() => {
    if (!visible) {
      setShow(false);
      setSlow(false);
      return undefined;
    }
    setMsgIndex(Math.floor(Math.random() * CALM_MESSAGES.length));
    const showTimer = setTimeout(() => setShow(true), SHOW_DELAY_MS);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(slowTimer);
    };
  }, [visible]);

  // Rotate messages with a soft cross-fade.
  useEffect(() => {
    if (!show) return undefined;
    const timer = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: 350, useNativeDriver: USE_NATIVE }).start(() => {
        setMsgIndex((i) => (i + 1) % CALM_MESSAGES.length);
        Animated.timing(fade, { toValue: 1, duration: 350, useNativeDriver: USE_NATIVE }).start();
      });
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [show, fade]);

  // Gentle breathing pulse on the moon.
  useEffect(() => {
    if (!show) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: USE_NATIVE }),
        Animated.timing(pulse, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: USE_NATIVE }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [show, pulse]);

  if (!visible || !show) return null;

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const message = slow
    ? "Still working on it - great stories are worth the wait ✨"
    : CALM_MESSAGES[msgIndex];

  return (
    <View style={styles.overlay}>
      <Animated.Text style={[styles.moon, { transform: [{ scale }] }]}>🌙</Animated.Text>
      <Text style={styles.headline}>{headlineFor(mode, storyTitle, voiceName)}</Text>
      <Animated.Text style={[styles.message, { opacity: fade }]}>{message}</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
    elevation: 999,
    backgroundColor: "rgba(8, 10, 30, 0.96)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  moon: {
    fontSize: 72,
    marginBottom: 28,
  },
  headline: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 18,
  },
  message: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
    minHeight: 72,
  },
});
