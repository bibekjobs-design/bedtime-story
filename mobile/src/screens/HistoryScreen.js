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
import { colors } from "../theme/colors";
import { api } from "../api/client";

// Three categories the app narrates stories in, and how to file a history
// entry under each - matches the "origin" the backend now records in
// story_events (library / create_narrator / create_clone).
const CATEGORIES = [
  {
    key: "library",
    title: "📚 Library",
    subtitle: "Pre-made bedtime stories",
    emptyText: "Stories you play from the Library will appear here.",
  },
  {
    key: "cloned",
    title: "🎙️ Cloned Parent Voice",
    subtitle: "Narrated in Mom or Dad's own voice",
    emptyText: "Stories narrated with a cloned parent voice will appear here.",
  },
  {
    key: "ai",
    title: "✨ AI Voice (Luna & friends)",
    subtitle: "Custom stories narrated by an AI storyteller",
    emptyText: "Custom stories you generate with an AI narrator will appear here.",
  },
];

const ORIGIN_MAP = {
  library: "library",
  create_narrator: "ai",
  create_clone: "cloned",
};

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
  for (const item of events) {
    const origin = ORIGIN_MAP[item.origin] || "ai";
    // Normalize field names to what the card renderer below expects
    // (server rows use created_at; the old local format used played_at).
    const normalized = { ...item, played_at: item.created_at };
    groups[origin].push(normalized);
  }
  return groups;
}

export default function HistoryScreen({ step, onPlayStory, onGoToHome }) {
  const [history, setHistory] = useState([]);
  const [creations, setCreations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openSection, setOpenSection] = useState("library");
  const [showCreations, setShowCreations] = useState(false);

  useEffect(() => {
    loadHistory();
    // Reload every time this tab becomes active, since a story may have
    // been played (and recorded) from Library/Create/Clone since the last
    // time History was open. History now lives on the server (story_events
    // table), so it survives cache clears and follows the account across
    // every device - it no longer depends on this device's local storage.
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
      <View style={styles.headerRow}>
        <Text style={styles.titleSerif}>Bedtime History</Text>
        <TouchableOpacity style={styles.homeBtn} onPress={onGoToHome}>
          <Image source={require("../../assets/images/fox.jpg")} style={styles.homeBtnImg} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.listContent}>
        {loading ? (
          <ActivityIndicator size="large" color="#f5a623" style={{ marginTop: 50 }} />
        ) : totalCount === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyEmoji}>📖</Text>
            <Text style={styles.emptyTitle}>No bedtime history yet</Text>
            <Text style={styles.emptyText}>
              Every story you listen to from the Library, AI Generator, or Parent Voice Clones
              will show up here, grouped by type, so you can replay it in one tap.
            </Text>
          </View>
        ) : (
          <>
            {CATEGORIES.map((cat) => {
              const items = groups[cat.key];
              const isOpen = openSection === cat.key;
              return (
                <View key={cat.key} style={styles.categoryBlock}>
                  <TouchableOpacity
                    style={[styles.categoryHeader, isOpen && styles.categoryHeaderActive]}
                    onPress={() => setOpenSection(isOpen ? null : cat.key)}
                    activeOpacity={0.85}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.categoryTitle}>{cat.title}</Text>
                      <Text style={styles.categorySubtitle}>{cat.subtitle}</Text>
                    </View>
                    {items.length > 0 && (
                      <View style={styles.countBadge}>
                        <Text style={styles.countBadgeText}>{items.length}</Text>
                      </View>
                    )}
                    <Text style={styles.chevron}>{isOpen ? "▼" : "▶"}</Text>
                  </TouchableOpacity>

                  {isOpen && (
                    <View style={styles.categoryBody}>
                      {items.length === 0 ? (
                        <Text style={styles.categoryEmptyText}>{cat.emptyText}</Text>
                      ) : (
                        items.map((item, idx) => (
                          <TouchableOpacity
                            key={item.id || `${item.story_text_id || idx}-${idx}`}
                            style={styles.storyCard}
                            activeOpacity={0.8}
                            onPress={() => onPlayStory({ ...item, mode: "audio_only" })}
                          >
                            <View style={styles.storyThumb}>
                              <Image
                                source={require("../../assets/images/moon.jpg")}
                                style={styles.thumbImg}
                              />
                            </View>
                            <View style={styles.storyInfo}>
                              <Text style={styles.storyTitle}>{item.title || "Bedtime Story"}</Text>
                              <View style={styles.metaRow}>
                                <Text style={styles.metaText}>
                                  ⏱️ {item.duration_seconds ? Math.round(item.duration_seconds / 60) : 5}m
                                </Text>
                                <Text style={styles.metaText}>
                                  {cat.key === "cloned" ? "🎙️ Parent Voice" : `🎤 ${item.voice_id || "Luna"}`}
                                </Text>
                                <Text style={styles.metaText}>{timeAgo(item.played_at)}</Text>
                              </View>
                            </View>
                            <View style={styles.replayBtn}>
                              <Text style={styles.replayBtnText}>▶️</Text>
                            </View>
                          </TouchableOpacity>
                        ))
                      )}
                    </View>
                  )}
                </View>
              );
            })}

            {creations.length > 0 && (
              <View style={styles.categoryBlock}>
                <TouchableOpacity
                  style={[styles.categoryHeader, showCreations && styles.categoryHeaderActive]}
                  onPress={() => setShowCreations(!showCreations)}
                  activeOpacity={0.85}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.categoryTitle}>⭐ My Creations</Text>
                    <Text style={styles.categorySubtitle}>
                      Stories you've uploaded, now in the shared Library - see how they're rated
                    </Text>
                  </View>
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{creations.length}</Text>
                  </View>
                  <Text style={styles.chevron}>{showCreations ? "▼" : "▶"}</Text>
                </TouchableOpacity>

                {showCreations && (
                  <View style={styles.categoryBody}>
                    {creations.map((c, idx) => (
                      <View key={c.story_text_id || idx} style={styles.storyCard}>
                        <View style={styles.storyThumb}>
                          <Image
                            source={require("../../assets/images/moon.jpg")}
                            style={styles.thumbImg}
                          />
                        </View>
                        <View style={styles.storyInfo}>
                          <Text style={styles.storyTitle}>{c.title || "Bedtime Story"}</Text>
                          <View style={styles.metaRow}>
                            <Text style={styles.metaText}>
                              {c.total_ratings > 0
                                ? `⭐ ${Number(c.average_rating).toFixed(1)} · ${c.total_ratings} rating${c.total_ratings === 1 ? "" : "s"}`
                                : "No ratings yet"}
                            </Text>
                            <Text style={styles.metaText}>{timeAgo(c.created_at)}</Text>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "transparent",
    paddingTop: 40,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  titleSerif: {
    fontSize: 28,
    fontWeight: "800",
    color: "#ffffff",
    fontFamily: "serif",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  homeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    overflow: "hidden",
  },
  homeBtnImg: {
    width: "100%",
    height: "100%",
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 100, // space for bottom nav
  },
  categoryBlock: {
    marginBottom: 10,
  },
  categoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: "rgba(109, 40, 217, 0.2)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.25)",
    borderLeftWidth: 4,
    borderLeftColor: "#a855f7",
  },
  categoryHeaderActive: {
    backgroundColor: "rgba(109, 40, 217, 0.38)",
    borderColor: "rgba(192, 132, 252, 0.5)",
    borderLeftColor: "#c084fc",
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  categoryTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  categorySubtitle: {
    color: "#c3c9dc",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  countBadge: {
    backgroundColor: "rgba(245, 166, 35, 0.2)",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 10,
  },
  countBadgeText: {
    color: "#f5a623",
    fontSize: 12,
    fontWeight: "700",
  },
  chevron: {
    color: "#c084fc",
    fontSize: 13,
    fontWeight: "800",
  },
  categoryBody: {
    paddingTop: 10,
    paddingHorizontal: 4,
  },
  categoryEmptyText: {
    color: "#9aa2b8",
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 12,
    paddingVertical: 10,
    lineHeight: 18,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  storyCard: {
    backgroundColor: "rgba(11, 14, 32, 0.85)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  storyThumb: {
    width: 60,
    height: 60,
    borderRadius: 14,
    overflow: "hidden",
    marginRight: 12,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  thumbImg: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  storyInfo: {
    flex: 1,
  },
  storyTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#ffffff",
    fontFamily: "serif",
    marginBottom: 6,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  metaRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  metaText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#e4e7f2",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  replayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(245, 166, 35, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  replayBtnText: {
    fontSize: 14,
  },
  clearBtn: {
    marginTop: 14,
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  clearBtnText: {
    color: "#9ba1ba",
    fontSize: 13,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  emptyBox: {
    alignItems: "center",
    marginTop: 60,
    paddingHorizontal: 20,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#ffffff",
    marginBottom: 8,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  emptyText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#c3c9dc",
    textAlign: "center",
    lineHeight: 19,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
