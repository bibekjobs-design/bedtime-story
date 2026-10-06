import React, { useEffect, useRef } from "react";
import { View, Text, Animated, Easing, StyleSheet, Platform, useWindowDimensions } from "react-native";
import { Asset } from "expo-asset";
import SafeAudio from "../utils/safeAudio";

// Iron gate: S lands on the first clang, T O R Y on each following beat (170 ms apart).
const DOOR_SOUND = require("../../assets/sounds/door_lock.mp3");

// Shown right after login, before the profile picker: the letters of
// STORY (red capitals): each letter comes running in from the left or right
// side and joins the word, then the whole word fades into the dark background.
const WORDS = ["STORY"];

export default function StoryLandSplash({ onDone }) {
  const { width } = useWindowDimensions();
  const letters = [];
  WORDS.forEach((w, wi) => w.split("").forEach((ch, ci) => letters.push({ ch, wi, ci })));

  const anims = useRef(letters.map(() => new Animated.Value(0))).current;
  const fade = useRef(new Animated.Value(1)).current;
  const useNative = Platform.OS !== "web";

  useEffect(() => {
    const slideIns = anims.map((a, i) =>
      Animated.timing(a, {
        toValue: 1,
        duration: 220,
        delay: 80 + i * 170,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: useNative,
      })
    );
    const run = Animated.sequence([
      Animated.parallel(slideIns),
      Animated.delay(800),
      Animated.timing(fade, { toValue: 0, duration: 800, easing: Easing.in(Easing.quad), useNativeDriver: useNative }),
    ]);
    let sound = null;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const uri = Asset.fromModule(DOOR_SOUND).uri;
        const res = await SafeAudio.Sound.createAsync(uri, { shouldPlay: true, volume: 0.8 });
        if (cancelled) res.sound.unloadAsync();
        else sound = res.sound;
      } catch (e) {}
    }, 0);
    run.start(({ finished }) => {
      if (finished && onDone) onDone();
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      run.stop();
      if (sound) sound.unloadAsync();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let k = -1;
  return (
    <View style={styles.container}>
      <Animated.View style={[styles.wordsWrap, { opacity: fade }]}>
        {WORDS.map((w, wi) => (
          <View key={w} style={styles.wordRow}>
            {w.split("").map((ch, ci) => {
              k += 1;
              const a = anims[k];
              const fromLeft = k % 2 === 0;
              const tx = a.interpolate({
                inputRange: [0, 1],
                outputRange: [fromLeft ? -width : width, 0],
              });
              return (
                <Animated.Text
                  key={`${wi}-${ci}`}
                  style={[styles.letter, { opacity: a, transform: [{ translateX: tx }] }]}
                >
                  {ch}
                </Animated.Text>
              );
            })}
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#05060c",
    alignItems: "center",
    justifyContent: "center",
  },
  wordsWrap: { alignItems: "center" },
  wordRow: { flexDirection: "row" },
  letter: {
    color: "#e50914",
    fontSize: 56,
    fontWeight: "900",
    letterSpacing: 4,
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    textTransform: "uppercase",
  },
});
