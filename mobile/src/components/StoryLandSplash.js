import React, { useEffect, useRef } from "react";
import { View, Text, Image, Animated, Easing, StyleSheet, Platform, useWindowDimensions } from "react-native";
import { Asset } from "expo-asset";
import SafeAudio from "../utils/safeAudio";

// Door-lock sound plays in sync with the first letter, while the letters grow in from the middle.
const LOGO = require("../../assets/logo_badge.png");
const DOOR_SOUND = require("../../assets/sounds/door_lock.mp3");

// Shown right after login, before the profile picker: the letters of
// STORYLAND (one word, gold-to-purple capitals): the letters grow one by one from the middle (Y)
// out to both ends, then the whole word fades into the dark background.
const WORDS = ["STORYLAND"];
const MID = 4; // index of the middle letter (Y)
// Gold -> lavender -> purple gradient across the letters (matches the logo).
const STOPS = [[246, 196, 83], [233, 168, 255], [165, 107, 255]];
function letterColor(i, n) {
  const t = n <= 1 ? 0 : i / (n - 1);
  const [a, b, f] = t < 0.5 ? [STOPS[0], STOPS[1], t / 0.5] : [STOPS[1], STOPS[2], (t - 0.5) / 0.5];
  const c = a.map((v, j) => Math.round(v + (b[j] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export default function StoryLandSplash({ onDone }) {
  const { width } = useWindowDimensions();
  // One line "STORYLAND", sized to fit any phone width (56 max on wide screens).
  const fontSize = Math.max(22, Math.min(56, Math.floor((width - 40) / 9.2)));
  const letters = [];
  WORDS.forEach((w, wi) => w.split("").forEach((ch, ci) => letters.push({ ch, wi, ci })));

  const anims = useRef(letters.map(() => new Animated.Value(0))).current;
  const fade = useRef(new Animated.Value(1)).current;
  const logoAnim = useRef(new Animated.Value(0)).current;
  const useNative = Platform.OS !== "web";

  useEffect(() => {
    const slideIns = anims.map((a, i) =>
      Animated.timing(a, {
        toValue: 1,
        duration: 380,
        delay: 900 + Math.abs(i - MID) * 150,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: useNative,
      })
    );
    const run = Animated.sequence([
      Animated.parallel([
        Animated.timing(logoAnim, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: useNative }),
        ...slideIns,
      ]),
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
    }, 900); // sound starts exactly when the first letter (Y) appears
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
      <Animated.View style={{ alignItems: "center", opacity: fade }}>
        <Animated.Image
          source={LOGO}
          style={{
            width: 150, height: 150, borderRadius: 32, marginBottom: 30,
            opacity: logoAnim,
            transform: [{ scale: logoAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
          }}
        />
        <View style={styles.wordsWrap}>
        {WORDS.map((w, wi) => (
          <View key={w} style={[styles.wordRow, wi > 0 && { marginLeft: fontSize * 0.45 }]}>
            {w.split("").map((ch, ci) => {
              k += 1;
              const a = anims[k];
              const scale = a.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });
              return (
                <Animated.Text
                  key={`${wi}-${ci}`}
                  style={[styles.letter, { fontSize, letterSpacing: Math.max(1, fontSize * 0.06), opacity: a, color: letterColor(k, 9), transform: [{ scale }] }]}
                >
                  {ch}
                </Animated.Text>
              );
            })}
          </View>
        ))}
        </View>
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
  wordsWrap: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  wordRow: { flexDirection: "row" },
  letter: {
    color: "#f6c453",
    textShadowColor: "rgba(165,107,255,0.55)",
    textShadowRadius: 14,
    textShadowOffset: { width: 0, height: 0 },
    fontSize: 56,
    fontWeight: "900",
    letterSpacing: 4,
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    textTransform: "uppercase",
  },
});
