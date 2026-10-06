import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  useWindowDimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors } from "../theme/colors";
import { api } from "../api/client";
import SLogo from "../components/SLogo";

export default function AgeGroupScreen({
  currentUser,
  profiles = [],
  activeProfile,
  onSelectAgeGroup,
  onOpenLogin,
  onOpenProfiles,
  onGoToUpgrade,
  onLogout,
  onOpenAdmin,
  onNotificationAction,
}) {
  const { width: W, height: H } = useWindowDimensions();
  // Deterministic star dust inside the band (same every render)
  const dust = useMemo(() => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const out = [];
    for (let i = 0; i < 70; i++) {
      const x = rnd();
      const y = rnd() * 0.97;
      out.push({ x, y, s: rnd() < 0.12 ? 3.2 : rnd() < 0.4 ? 2.2 : 1.5, o: (0.55 + rnd() * 0.45).toFixed(2) });
    }
    return out;
  }, []);

  // Hero picture: a random cover from the story library (stored in the database)
  const [heroUri, setHeroUri] = useState(null);
  const isPremium = ["premium", "premium_monthly", "premium_annual", "admin_vip"].includes(
    currentUser?.subscription_tier
  );
  const [localActiveProfile, setLocalActiveProfile] = useState(activeProfile);

  // Free-trial status for the "X free days left" line under the profiles.
  const [trialStatus, setTrialStatus] = useState(null);
  useEffect(() => {
    if (!currentUser) {
      setTrialStatus(null);
      return undefined;
    }
    let cancelled = false;
    api
      .getSubscriptionStatus()
      .then((res) => {
        if (!cancelled) setTrialStatus(res);
      })
      .catch(() => {
        if (!cancelled) setTrialStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, currentUser?.subscription_tier]);

  function trialLine() {
    if (!trialStatus) return null;
    if (trialStatus.plan_tier === "trial") {
      const days = trialStatus.trial_days_left || 0;
      const hours = trialStatus.trial_hours_left || 0;
      if (days <= 1) {
        return hours > 1
          ? `🎁 Free trial ends today - ${hours} hours left`
          : "🎁 Free trial ends in less than an hour";
      }
      return `🎁 ${days} free days left in your trial`;
    }
    if (trialStatus.plan_tier === "free_expired") {
      return "Your free trial has ended - the Library is still free to enjoy";
    }
    return null; // paid / admin: nothing to show
  }
  const trialText = trialLine();

  const toddlerProfiles = profiles.filter((p) => (p.age_group_id === 1 || (p.age && p.age <= 4)));
  const kidProfiles = profiles.filter((p) => (p.age_group_id === 2 || (p.age && p.age >= 5)));

  useEffect(() => {
    let cancelled = false;
    const keyFor = (g) => "@bedtime_precreated_cache_" + g + "_all_popular";
    const pickRandomCover = (lists) => {
      const covers = [];
      lists.forEach((list) => {
        (Array.isArray(list) ? list : []).forEach((s) => {
          if (s && typeof s.cover_image_url === "string" && s.cover_image_url.startsWith("http")) {
            covers.push(s.cover_image_url);
          }
        });
      });
      if (covers.length === 0) return null;
      return covers[Math.floor(Math.random() * covers.length)];
    };

    // 1) Instantly use the cached library (if any) so the picture shows at once
    Promise.all(
      [1, 2, 3].map((g) =>
        AsyncStorage.getItem(keyFor(g))
          .then((raw) => (raw ? JSON.parse(raw) : []))
          .catch(() => [])
      )
    ).then((lists) => {
      if (cancelled) return;
      const pick = pickRandomCover(lists);
      if (pick) setHeroUri((cur) => cur || pick);
    });

    // 2) Fetch fresh library, refresh the cache (0ms transitions) and pick a cover
    Promise.all(
      [1, 2, 3].map((g) =>
        api
          .getPrecreatedStories(null, g, 1, "popular")
          .then((data) => {
            if (data && data.length > 0) {
              AsyncStorage.setItem(keyFor(g), JSON.stringify(data)).catch(() => {});
            }
            return data || [];
          })
          .catch(() => [])
      )
    ).then((lists) => {
      if (cancelled) return;
      const pick = pickRandomCover(lists);
      if (pick) setHeroUri((cur) => cur || pick);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setLocalActiveProfile(activeProfile);
  }, [activeProfile]);

  // Tapping a profile bubble both selects it AND immediately continues into
  // the app - no separate "Begin Reading" button needed. Passing the tapped
  // profile straight through (rather than relying on the localActiveProfile
  // state update, which wouldn't be visible yet in this same tap) avoids a
  // stale-state bug.
  const beginWithProfile = (profile) => {
    setLocalActiveProfile(profile);
    if (profile) {
      const isToddler = profile.age_group_id === 1 || (profile.age && profile.age <= 4);
      onSelectAgeGroup(
        {
          id: isToddler ? 1 : 2,
          label: isToddler ? "2-4" : "5+",
          name: profile.name,
        },
        profile
      );
    } else {
      // Default to general toddlers if no profile selected
      onSelectAgeGroup({
        id: 1,
        label: "2-4",
        name: toddlerProfiles.length > 0 ? toddlerProfiles[0].name : "Toddlers",
      });
    }
  };

  const TILE_COLORS = [
    ["#ff6b6b", "#e63946"],
    ["#6a7bff", "#3b4bd6"],
    ["#f5a623", "#f08c00"],
    ["#34c9a1", "#1f9e7e"],
  ];

  const hasProfiles = profiles.length > 0;

  return (
    <View style={styles.container}>
      {/* Night-sky background (full screen): sky, moon, hills */}
      <View style={styles.sky} pointerEvents="none" />

      {/* Hero story picture (random cover from the library) fading into black */}
      {heroUri ? (
        <View style={[styles.hero, { height: H * 0.64 }]} pointerEvents="none">
          <Image
            source={{ uri: heroUri }}
            style={styles.heroImage}
            resizeMode="cover"
            onError={() => setHeroUri(null)}
          />
          {Array.from({ length: 28 }).map((_, i) => (
            <View
              key={"f" + i}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: (H * 0.64 * (27 - i)) / 56,
                height: (H * 0.64) / 56 + 1,
                backgroundColor: "rgba(5, 6, 12, " + Math.min(1, (i / 27) * 1.05).toFixed(3) + ")",
              }}
            />
          ))}
          {Array.from({ length: 6 }).map((_, i) => (
            <View
              key={"t" + i}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: i * 12,
                height: 13,
                backgroundColor: "rgba(5, 6, 12, " + (0.5 - i * 0.08).toFixed(2) + ")",
              }}
            />
          ))}
        </View>
      ) : null}
      {/* Small white stars scattered across the sky */}
      {!heroUri ? (
      <View pointerEvents="none" style={styles.starField}>
        {dust.map((d, i) => (
          <View
            key={"d" + i}
            style={{
              position: "absolute",
              left: d.x * 100 + "%",
              top: d.y * 100 + "%",
              width: d.s,
              height: d.s,
              borderRadius: d.s,
              backgroundColor: "rgba(255,255,255," + d.o + ")",
            }}
          />
        ))}
      </View>
      ) : null}
      {STARS.map((s, i) => (
        <Text
          key={i}
          pointerEvents="none"
          style={[styles.star, { top: s.top, left: s.left, fontSize: s.size, color: s.color }]}
        >
          {s.ch}
        </Text>
      ))}
      {!heroUri ? <View style={styles.hillBack} pointerEvents="none" /> : null}
      {!heroUri ? <View style={styles.hillFront} pointerEvents="none" /> : null}

      {/* Top-left: S logo (like the N on Netflix) */}
      <View style={styles.logoWrap}>
        <SLogo size="md" />
      </View>

      {/* Top-right: Admin link (admins only). Bell and Log Out live inside the child profile. */}
      {currentUser?.is_admin ? (
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.chip} onPress={onOpenAdmin} activeOpacity={0.8}>
            <Text style={styles.chipTextGold}>📊 Admin</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.ask}>Who's listening tonight?</Text>

        {/* Profile tiles */}
        <View style={styles.tiles}>
          {hasProfiles ? (
            profiles.map((profile, idx) => {
              const isToddler = profile.age_group_id === 1 || (profile.age && profile.age <= 4);
              const emoji = isToddler ? "🦊" : "🦉";
              const isActive = localActiveProfile?.id === profile.id;
              const [c1] = TILE_COLORS[idx % TILE_COLORS.length];
              return (
                <TouchableOpacity
                  key={profile.id}
                  style={styles.tile}
                  activeOpacity={0.85}
                  onPress={() => beginWithProfile(profile)}
                >
                  <View style={[styles.face, { backgroundColor: c1 }, isActive && styles.faceActive]}>
                    <Text style={styles.faceEmoji}>{emoji}</Text>
                  </View>
                  <Text style={styles.tileName} numberOfLines={1}>{profile.name}</Text>
                  <Text style={styles.tileAge}>Age {isToddler ? "3-5" : "6-8"}</Text>
                </TouchableOpacity>
              );
            })
          ) : (
            <>
              {/* No profiles yet: the two default age groups */}
              <TouchableOpacity style={styles.tile} activeOpacity={0.85} onPress={() => beginWithProfile(null)}>
                <View style={[styles.face, { backgroundColor: TILE_COLORS[0][0] }]}>
                  <Text style={styles.faceEmoji}>🦊</Text>
                </View>
                <Text style={styles.tileName}>Toddlers</Text>
                <Text style={styles.tileAge}>Age 2-4</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.tile} activeOpacity={0.85} onPress={() => beginWithProfile(null)}>
                <View style={[styles.face, { backgroundColor: TILE_COLORS[1][0] }]}>
                  <Text style={styles.faceEmoji}>🦉</Text>
                </View>
                <Text style={styles.tileName}>Kids</Text>
                <Text style={styles.tileAge}>Age 5+</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Add (logged-in: add a profile, guest: log in) */}
          <TouchableOpacity
            style={styles.tile}
            activeOpacity={0.85}
            onPress={currentUser ? onOpenProfiles : onOpenLogin}
          >
            <View style={[styles.face, styles.faceMuted]}>
              <Text style={styles.faceSymbol}>+</Text>
            </View>
            <Text style={styles.tileName}>Add</Text>
          </TouchableOpacity>

          {/* Edit = Manage Profiles */}
          {currentUser ? (
            <TouchableOpacity style={styles.tile} activeOpacity={0.85} onPress={onOpenProfiles}>
              <View style={[styles.face, styles.faceMuted]}>
                <Text style={styles.faceEmoji}>✏️</Text>
              </View>
              <Text style={styles.tileName}>Edit</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Upgrade to Pro - free accounts only */}
        {currentUser && !isPremium && (
          <TouchableOpacity style={styles.upgradeBtn} activeOpacity={0.85} onPress={onGoToUpgrade}>
            <Text style={styles.upgradeBtnText}>
              {currentUser?.subscription_tier === "pro_monthly" ? "👑 Upgrade to Super" : "👑 Upgrade to Pro"}
            </Text>
          </TouchableOpacity>
        )}

        {/* Free-days line sits under the Upgrade button */}
        {currentUser && trialText ? (
          <TouchableOpacity activeOpacity={0.85} onPress={onGoToUpgrade}>
            <Text
              style={[
                styles.trialText,
                trialStatus?.plan_tier === "free_expired" && styles.trialTextExpired,
              ]}
            >
              {trialText}
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* Bottom breathing room */}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </View>
  );
}

// Night-sky Home: dark translucent fills + light text.
const DARK_FILL = "rgba(8, 11, 28, 0.62)";

// (removed the sparkle-shaped stars; the Milky Way dust provides the stars)
const STARS = [];

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#05060c",
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  sky: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "62%",
    backgroundColor: "#05060c",
  },
  hero: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    overflow: "hidden",
  },
  heroImage: { width: "100%", height: "100%" },
  starField: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "58%",
  },
  star: { position: "absolute" },
  hillBack: {
    position: "absolute",
    bottom: -90,
    right: -80,
    width: 380,
    height: 260,
    borderRadius: 190,
    backgroundColor: "#0a0b14",
  },
  hillFront: {
    position: "absolute",
    bottom: -120,
    left: -90,
    width: 520,
    height: 260,
    borderRadius: 260,
    backgroundColor: "#07080f",
  },
  logoWrap: {
    position: "absolute",
    top: 14,
    left: 18,
    zIndex: 5,
    alignItems: "flex-start",
  },
  logoBadge: {
    width: 56,
    height: 64,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  logoS: {
    fontSize: 44,
    lineHeight: 52,
    fontWeight: "900",
    color: "#e50914",
    fontFamily: "serif",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
    zIndex: 5,
  },
  chip: {
    backgroundColor: DARK_FILL,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  chipText: { color: "#e6e8f2", fontSize: 11, fontWeight: "700" },
  chipTextGold: { color: "#ffe2a3", fontSize: 11, fontWeight: "700" },
  loginPill: {
    backgroundColor: colors.primary,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  loginPillText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: "flex-end", alignItems: "center", paddingTop: 120, paddingBottom: 90 },

  trialText: {
    marginTop: 14,
    alignSelf: "center",
    color: "#fff3d6",
    fontSize: 12,
    fontWeight: "800",
    backgroundColor: DARK_FILL,
    borderWidth: 1,
    borderColor: "rgba(245, 166, 35, 0.55)",
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 12,
    overflow: "hidden",
  },
  trialTextExpired: {
    color: "#d5d9ea",
    fontSize: 11,
    fontWeight: "600",
    borderColor: "rgba(255,255,255,0.18)",
  },

  ask: {
    marginTop: 18,
    marginBottom: 16,
    fontSize: 18,
    color: "#e6e8f2",
  },

  // ---- profile tiles ----
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 16,
    rowGap: 18,
  },
  tile: { width: 92, alignItems: "center" },
  face: {
    width: 92,
    height: 92,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  faceActive: { borderWidth: 3, borderColor: "#ffffff" },
  faceMuted: { backgroundColor: "rgba(255,255,255,0.16)" },
  faceEmoji: { fontSize: 42 },
  faceSymbol: { fontSize: 44, color: "#ffffff", fontWeight: "300", marginTop: -4 },
  tileName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#ffffff",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 6,
    maxWidth: 92,
  },
  tileAge: { fontSize: 11, fontWeight: "700", color: "#ffe2a3", marginTop: 2 },

  upgradeBtn: {
    marginTop: 24,
    height: 46,
    paddingHorizontal: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 23,
    backgroundColor: "rgba(8, 11, 28, 0.65)",
    borderWidth: 1.5,
    borderColor: "#f5a623",
  },
  upgradeBtnText: { color: "#ffe2a3", fontSize: 15, fontWeight: "800" },

  bottomSpacer: { height: 24 },
});
