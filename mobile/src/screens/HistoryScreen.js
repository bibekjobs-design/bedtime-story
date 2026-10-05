import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
} from "react-native";
import { api } from "../api/client";

const BG = "#05060c";

// Three kinds of story the app narrates, and how a history entry is filed
// under each - matches the "origin" the backend records in story_events
// (library / create_narrator / create_clone).
const CATEGORIES = [
  {
    key: "library",
    title: "Home stories",
    emptyText: "Stories you play from Home will show up here.",
  },
  {
    key: "cloned",
    title: "Cloned Parent Voice",
    emptyText: "Stories narrated with a cloned parent voice will show up here.",
  },
  {
    key: "ai",
    title: "AI Voice (Luna & friends)",
    emptyText: "Custom stories you generate with an AI narrator will show up here.",
  },
];

const ORIGIN_MAP = {
  library: "library",
  create_narrator: "ai",
  create_clone: "cloned",
};

// Placeholder look for stories without a cover picture: coloured card with
// an emoji picked from the title.
const EMOJI_RULES = [
  [/rabbit|hare|bunny/i, "🐰"],
  [/tortoise|turtle/i, "🐢"],
  [/fox/i, "🦊"],
  [/owl/i, "🦉"],
  [/elephant/i, "🐘"],
  [/bear/i, "🐻"],
  [/lion/i, "🦁"],
  [/tiger/i, "🐯"],
  [/monkey/i, "🐵"],
  [/sheep|lamb/i, "🐑"],
  [/cat|kitten/i, "🐱"],
  [/dog|puppy/i, "🐶"],
  [/mouse|mice/i, "🐭"],
  [/frog/i, "🐸"],
  [/duck/i, "🦆"],
  [/bird|crow|parrot|sparrow/i, "🐦"],
  [/fish|whale|dolphin|ocean|sea/i, "🐠"],
  [/mermaid/i, "🧜"],
  [/dragon/i, "🐉"],
  [/unicorn/i, "🦄"],
  [/fairy/i, "🧚"],
  [/castle|kingdom|king|queen|prince|princess/i, "🏰"],
  [/wizard|magic|wand/i, "🪄"],
  [/rocket|space|astronaut/i, "🚀"],
  [/alien/i, "👽"],
  [/planet/i, "🪐"],
  [/star/i, "⭐"],
  [/moon|night|sleep|dream|lullaby|goodnight/i, "🌙"],
  [/sun/i, "☀️"],
  [/rain|cloud/i, "☁️"],
  [/forest|tree|woods/i, "🌳"],
  [/flower|garden/i, "🌸"],
  [/pirate|ship|treasure/i, "🏴‍☠️"],
  [/train/i, "🚂"],
  [/boat/i, "⛵"],
  [/snow|winter/i, "❄️"],
];
const GRADIENT_COLORS = [
  "#3a8f4d", "#5b3aa8", "#1f5fa8", "#c24d1a", "#a8265b", "#157a6a", "#2a2f6b",
];

function emojiFor(title) {
  const t = String(title || "");
  const found = [];
  for (const [re, em] of EMOJI_RULES) {
    if (re.test(t)) found.push(em);
    if (found.length === 2) break;
  }
  return found.length ? found.join("") : "🌙";
}

function colorFor(title) {
  let h = 0;
  const t = String(title || "");
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 9973;
  return GRADIENT_COLORS[h % GRADIENT_COLORS.length];
}


function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function groupByOrigin(events) {
  const groups = { library: [], cloned: [], ai: [] };
  const seen = new Set();
  // Events arrive newest-first, so the first one we meet for a story is its
  // latest play. Replaying the same story many times shows it only once.
  for (const item of events) {
    const origin = ORIGIN_MAP[item.origin] || "ai";
    const storyKey = item.story_text_id || String(item.title || "").trim().toLowerCase();
    const key = origin + "|" + storyKey + "|" + (origin === "cloned" ? item.voice_clone_id || "" : "");
    if (seen.has(key)) continue;
    seen.add(key);
    // Server rows use created_at; the card code below uses played_at.
    groups[origin].push({ ...item, played_at: item.created_at });
  }
  return groups;
}

function HistoryCard({ title, cover, emoji, line, tag, onPress }) {
  const [broken, setBroken] = useState(false);
  const hasCover = !broken && typeof cover === "string" && cover.startsWith("http");
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.card}>
      {hasCover ? (
        <Image
          source={{ uri: cover }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder, { backgroundColor: colorFor(title) }]}>
          <View style={styles.placeholderShade} />
          <Text style={styles.placeholderEmoji}>{emoji || emojiFor(title)}</Text>
        </View>
      )}
      <View style={styles.titleShade1} pointerEvents="none" />
      <View style={styles.titleShade2} pointerEvents="none" />
      <View style={styles.cardTextWrap} pointerEvents="none">
        <Text style={styles.cardTitle} numberOfLines={2}>
          {title}
        </Text>
        {line ? <Text style={styles.cardLine}>{line}</Text> : null}
      </View>
      {tag ? (
        <View style={styles.tagBadge}>
          <Text style={styles.tagBadgeText}>{tag}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

export default function HistoryScreen({ step, onPlayStory, onGoToHome }) {
  const [history, setHistory] = useState([]);
  const [creations, setCreations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHistory();
    // Reload every time this tab becomes active, since a story may have
    // been played (and recorded) since the last time History was open.
    // History lives on the server (story_events table), so it follows the
    // account across devices.
  }, [step]);

  async function loadHistory() {
    try {
      setLoading(true);
      const [historyRes, creationsRes] = await Promise.all([
        api.getHistory(60).catch(() => []),
        api.getMyCreations(60).catch(() => []),
      ]);
      setHistory(Array.isArray(historyRes) ? historyRes : []);
      setCreations(Array.isArray(creationsRes) ? creationsRes : []);
    } catch (e) {
      console.warn("Failed to load history", e);
      setHistory([]);
      setCreations([]);
    } finally {
      setLoading(false);
    }
  }

  const groups = groupByOrigin(history);
  const totalCount = history.length;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator size="large" color="#f5a623" style={{ marginTop: 50 }} />
        ) : totalCount === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyEmoji}>📖</Text>
            <Text style={styles.emptyTitle}>No bedtime history yet</Text>
            <Text style={styles.emptyText}>
              Every story you listen to from Home, the AI Generator, or Parent Voice Clones
              will show up here, in rows by type, so you can replay it in one tap.
            </Text>
          </View>
        ) : (
          <>
            {CATEGORIES.map((cat) => {
              const items = groups[cat.key];
              return (
                <View key={cat.key}>
                  <Text style={styles.rowTitle}>{cat.title}</Text>
                  {items.length === 0 ? (
                    <Text style={styles.rowEmpty}>{cat.emptyText}</Text>
                  ) : (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.rowScroll}
                    >
                      {items.map((item, idx) => (
                        <HistoryCard
                          key={item.id || `${item.story_text_id || idx}-${idx}`}
                          title={item.title || "Bedtime Story"}
                          cover={item.cover_image_url}
                          emoji={cat.key === "cloned" ? "🎙️" : undefined}
                          tag={cat.key === "cloned" ? "🎙️ Parent" : null}
                          line={
                            (item.duration_seconds ? Math.round(item.duration_seconds / 60) : 5) +
                            "m · " +
                            timeAgo(item.played_at)
                          }
                          onPress={() => onPlayStory({ ...item, mode: "audio_only" })}
                        />
                      ))}
                    </ScrollView>
                  )}
                </View>
              );
            })}

          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG, paddingTop: 8 },
  listContent: { paddingBottom: 130 },
  rowTitle: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "800",
    marginTop: 20,
    marginBottom: 10,
    marginHorizontal: 16,
  },
  rowEmpty: { color: "#9ba1ba", fontSize: 13, marginHorizontal: 16, lineHeight: 18 },
  rowScroll: { paddingHorizontal: 16, gap: 10 },

  card: { width: 112, height: 164, borderRadius: 10, overflow: "hidden", backgroundColor: "#15172a" },
  placeholder: { alignItems: "center", justifyContent: "center" },
  placeholderShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.22)" },
  placeholderEmoji: { fontSize: 44, marginBottom: 20 },
  titleShade1: { position: "absolute", left: 0, right: 0, bottom: 0, height: 70, backgroundColor: "rgba(0,0,0,0.45)" },
  titleShade2: { position: "absolute", left: 0, right: 0, bottom: 0, height: 38, backgroundColor: "rgba(0,0,0,0.4)" },
  cardTextWrap: { position: "absolute", left: 8, right: 8, bottom: 8 },
  cardTitle: { color: "#ffffff", fontSize: 12, fontWeight: "800", lineHeight: 15 },
  cardLine: { color: "#ffe2a3", fontSize: 10, fontWeight: "700", marginTop: 3 },
  tagBadge: {
    position: "absolute",
    left: 7,
    top: 7,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tagBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },

  emptyBox: { alignItems: "center", marginTop: 60, paddingHorizontal: 30 },
  emptyEmoji: { fontSize: 48, marginBottom: 10 },
  emptyTitle: { color: "#ffffff", fontSize: 18, fontWeight: "800", marginBottom: 8 },
  emptyText: { color: "#9ba1ba", fontSize: 14, textAlign: "center", lineHeight: 20 },
});
