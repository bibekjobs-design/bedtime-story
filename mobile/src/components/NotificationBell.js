import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  AppState,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../api/client";

// 🔔 bell for the Home screen. Shows messages you add to the Supabase
// `announcements` table (see backend/sql/006_announcements.sql).
//
// - Fetches on mount, whenever the app returns to the foreground, and every
//   POLL_MS while mounted (i.e. while Home is open) - so a new row shows up
//   within about a minute without an app update.
// - "Read" state is kept on this phone (AsyncStorage), so it works for
//   logged-out visitors too. The last list is cached for offline use.
// - Messages are plain text; buttons only jump to screens inside the app.
//
// Props:
//   userKey   - changes when the user logs in/out, to refetch (audience)
//   onAction  - called with "library" | "create" | "plans" | "history"

const POLL_MS = 60000;
const SEEN_KEY = "@bedtime_seen_announcements";
const CACHE_KEY = "@bedtime_announcements_cache";
const ACTION_DEFAULT_LABEL = {
  library: "Open Library",
  create: "Create a story",
  plans: "See plans",
  history: "Open History",
};

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function NotificationBell({ userKey, onAction }) {
  const [items, setItems] = useState([]);
  const [seenIds, setSeenIds] = useState([]);
  const [open, setOpen] = useState(false);
  const [newIds, setNewIds] = useState([]); // unread at the moment the sheet opened
  const seenRef = useRef([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Load what we already know (seen ids + cached list) instantly.
  useEffect(() => {
    (async () => {
      try {
        const [seenRaw, cacheRaw] = await Promise.all([
          AsyncStorage.getItem(SEEN_KEY),
          AsyncStorage.getItem(CACHE_KEY),
        ]);
        if (!mountedRef.current) return;
        if (seenRaw) {
          const parsed = JSON.parse(seenRaw);
          if (Array.isArray(parsed)) {
            seenRef.current = parsed;
            setSeenIds(parsed);
          }
        }
        if (cacheRaw) {
          const parsed = JSON.parse(cacheRaw);
          if (Array.isArray(parsed)) setItems(parsed);
        }
      } catch (e) {}
    })();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getAnnouncements();
      if (!mountedRef.current || !Array.isArray(data)) return;
      setItems(data);
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data)).catch(() => {});
    } catch (e) {
      // Offline / backend down: keep showing whatever we already have.
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      clearInterval(timer);
      if (sub && typeof sub.remove === "function") sub.remove();
    };
  }, [refresh, userKey]);

  const unreadCount = items.filter((it) => !seenIds.includes(it.id)).length;

  function openSheet() {
    setNewIds(items.filter((it) => !seenIds.includes(it.id)).map((it) => it.id));
    setOpen(true);
    // Opening the sheet counts as reading everything currently in it.
    const merged = Array.from(new Set([...seenRef.current, ...items.map((it) => it.id)])).slice(-200);
    seenRef.current = merged;
    setSeenIds(merged);
    AsyncStorage.setItem(SEEN_KEY, JSON.stringify(merged)).catch(() => {});
  }

  function handleAction(action) {
    setOpen(false);
    if (onAction) onAction(action);
  }

  return (
    <>
      <TouchableOpacity style={styles.bellBtn} onPress={openSheet} activeOpacity={0.8}>
        <Text style={styles.bellIcon}>🔔</Text>
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>🔔 What's new</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 8 }}>
              {items.length === 0 ? (
                <Text style={styles.emptyText}>You're all caught up. 🌙{"\n"}New updates will show up here.</Text>
              ) : (
                items.map((it) => {
                  const isNew = newIds.includes(it.id);
                  return (
                    <View key={it.id} style={[styles.card, isNew && styles.cardNew]}>
                      <Text style={styles.cardIcon}>{it.icon || "🔔"}</Text>
                      <View style={{ flex: 1 }}>
                        <View style={styles.cardTitleRow}>
                          <Text style={styles.cardTitle}>{it.title}</Text>
                          {isNew && <Text style={styles.newPill}>NEW</Text>}
                        </View>
                        <Text style={styles.cardMessage}>{it.message}</Text>
                        <View style={styles.cardFooter}>
                          <Text style={styles.cardDate}>{formatDate(it.created_at)}</Text>
                          {it.action && ACTION_DEFAULT_LABEL[it.action] ? (
                            <TouchableOpacity style={styles.actionBtn} onPress={() => handleAction(it.action)}>
                              <Text style={styles.actionBtnText}>
                                {it.action_label || ACTION_DEFAULT_LABEL[it.action]}
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bellBtn: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  bellIcon: {
    fontSize: 15,
  },
  badge: {
    position: "absolute",
    top: -5,
    right: -4,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    padding: 20,
  },
  sheet: {
    maxHeight: "75%",
    backgroundColor: "#12152b",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(147, 51, 234, 0.3)",
    padding: 18,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sheetTitle: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
  },
  closeText: {
    color: "#9ba1ba",
    fontSize: 20,
  },
  list: {
    flexGrow: 0,
  },
  emptyText: {
    color: "#9ba1ba",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 24,
    paddingVertical: 28,
  },
  card: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
  },
  cardNew: {
    borderColor: "rgba(245, 166, 35, 0.55)",
    backgroundColor: "rgba(245, 166, 35, 0.08)",
  },
  cardIcon: {
    fontSize: 26,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  cardTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
    flexShrink: 1,
  },
  newPill: {
    color: "#0b0e20",
    backgroundColor: "#f5a623",
    fontSize: 10,
    fontWeight: "800",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: "hidden",
  },
  cardMessage: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    lineHeight: 21,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10,
  },
  cardDate: {
    color: "#7c829c",
    fontSize: 12,
  },
  actionBtn: {
    backgroundColor: "#f5a623",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  actionBtnText: {
    color: "#0b0e20",
    fontSize: 12,
    fontWeight: "800",
  },
});
