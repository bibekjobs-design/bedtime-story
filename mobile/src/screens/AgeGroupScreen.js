import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors } from "../theme/colors";
import { api } from "../api/client";
import NotificationBell from "../components/NotificationBell";

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
    // Silently prefetch & cache library stories for 0ms transition
    api.getPrecreatedStories(null, 1, 1, "popular").then((data) => {
      if (data && data.length > 0) {
        AsyncStorage.setItem("@bedtime_precreated_cache_1_all_popular", JSON.stringify(data)).catch(() => {});
      }
    }).catch(() => {});
    api.getPrecreatedStories(null, 2, 1, "popular").then((data) => {
      if (data && data.length > 0) {
        AsyncStorage.setItem("@bedtime_precreated_cache_2_all_popular", JSON.stringify(data)).catch(() => {});
      }
    }).catch(() => {});
    api.getPrecreatedStories(null, 3, 1, "popular").then((data) => {
      if (data && data.length > 0) {
        AsyncStorage.setItem("@bedtime_precreated_cache_3_all_popular", JSON.stringify(data)).catch(() => {});
      }
    }).catch(() => {});
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

  return (
    <View style={styles.container}>
      {/* Top-right: Admin (admins only) + notifications bell + Log Out */}
      <View style={styles.topRow}>
        {currentUser?.is_admin ? (
          <TouchableOpacity style={styles.chip} onPress={onOpenAdmin} activeOpacity={0.8}>
            <Text style={styles.chipTextGold}>📊 Admin</Text>
          </TouchableOpacity>
        ) : null}
        <NotificationBell userKey={currentUser?.id || "guest"} onAction={onNotificationAction} />
        {currentUser ? (
          <TouchableOpacity style={styles.chip} onPress={onLogout} activeOpacity={0.8}>
            <Text style={styles.chipText}>🚪 Log Out</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.loginPill} onPress={onOpenLogin} activeOpacity={0.8}>
            <Text style={styles.loginPillText}>🔑 Parent Login</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.header}>
        <Text style={styles.titleSerif}>Dream Weaver</Text>
        <Text style={styles.subtitle}>Who is listening tonight?</Text>
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
      </View>

      <ScrollView style={styles.profilesScroll} contentContainerStyle={styles.profilesGrid} horizontal={false}>
        <View style={styles.bubblesRow}>
          {profiles.length > 0 ? (
            profiles.map((profile) => {
              const isToddler = profile.age_group_id === 1 || (profile.age && profile.age <= 4);
              const emoji = isToddler ? "🦊" : "🦉";
              const isActive = localActiveProfile?.id === profile.id;

              return (
                <TouchableOpacity
                  key={profile.id}
                  style={[styles.profileBubble, isActive && styles.profileBubbleActive]}
                  activeOpacity={0.8}
                  onPress={() => beginWithProfile(profile)}
                >
                  <View style={[styles.avatar, isActive && styles.avatarActive]}>
                    <Text style={styles.avatarEmoji}>{emoji}</Text>
                  </View>
                  <Text style={styles.profileName}>{profile.name}</Text>
                  <View style={styles.ageBadge}>
                    <Text style={styles.ageBadgeText}>Age {isToddler ? "3-5" : "6-8"}</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          ) : (
            <>
              {/* Fallback age groups if there are no profiles yet */}
              <TouchableOpacity
                style={[styles.profileBubble, !localActiveProfile && styles.profileBubbleActive]}
                activeOpacity={0.8}
                onPress={() => beginWithProfile(null)}
              >
                <View style={[styles.avatar, !localActiveProfile && styles.avatarActive]}>
                  <Text style={styles.avatarEmoji}>🦊</Text>
                </View>
                <Text style={styles.profileName}>Toddlers</Text>
                <View style={styles.ageBadge}>
                  <Text style={styles.ageBadgeText}>Age 2-4</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.profileBubble} activeOpacity={0.8} onPress={() => beginWithProfile(null)}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarEmoji}>✨</Text>
                </View>
                <Text style={styles.profileName}>Kids</Text>
                <View style={styles.ageBadge}>
                  <Text style={styles.ageBadgeText}>Age 5+</Text>
                </View>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Upgrade to Pro - free accounts only */}
        {currentUser && !isPremium && (
          <TouchableOpacity style={[styles.btn, styles.btnPro]} activeOpacity={0.85} onPress={onGoToUpgrade}>
            <Text style={[styles.btnText, styles.btnProText]}>👑 Upgrade to Pro</Text>
          </TouchableOpacity>
        )}

        {/* Manage / Add Profiles */}
        <TouchableOpacity
          style={[styles.btn, styles.btnManage]}
          activeOpacity={0.85}
          onPress={currentUser ? onOpenProfiles : onOpenLogin}
        >
          <Text style={styles.btnText}>
            {currentUser ? "⚙️ Manage Profiles" : "🔑 Parent Login to Personalize"}
          </Text>
        </TouchableOpacity>

        {/* Keeps the buttons clear of the bottom nav bar */}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </View>
  );
}

// Dark translucent fills + light text so everything stays readable on the
// golden nebula background.
const DARK_FILL = "rgba(8, 11, 28, 0.62)";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "transparent",
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
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
  header: {
    alignItems: "center",
    marginBottom: 6,
  },
  titleSerif: {
    fontSize: 36,
    fontWeight: "700",
    color: "#ffffff",
    fontFamily: "serif",
    marginBottom: 4,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowRadius: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#d5d9ea",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 6,
  },
  trialText: {
    marginTop: 12,
    color: "#fff3d6",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
    backgroundColor: DARK_FILL,
    borderWidth: 1,
    borderColor: "rgba(245, 166, 35, 0.55)",
    borderRadius: 18,
    paddingVertical: 7,
    paddingHorizontal: 14,
    overflow: "hidden",
  },
  trialTextExpired: {
    color: "#d5d9ea",
    fontSize: 13,
    fontWeight: "600",
    borderColor: "rgba(255,255,255,0.18)",
  },
  profilesScroll: { flex: 1 },
  profilesGrid: {
    alignItems: "center",
    paddingTop: 26,
    paddingBottom: 40,
  },
  bubblesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 24,
    marginBottom: 6,
  },
  profileBubble: { alignItems: "center", opacity: 0.7 },
  profileBubbleActive: { opacity: 1 },
  avatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: DARK_FILL,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  avatarActive: { borderColor: "#f5a623" },
  avatarEmoji: { fontSize: 50 },
  profileName: {
    fontSize: 20,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 6,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 6,
  },
  ageBadge: {
    backgroundColor: DARK_FILL,
    borderWidth: 1,
    borderColor: "rgba(245, 166, 35, 0.55)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  ageBadgeText: { color: "#ffe2a3", fontSize: 12, fontWeight: "700" },
  btn: {
    width: "72%",
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 23,
    backgroundColor: DARK_FILL,
    marginTop: 12,
  },
  btnPro: {
    marginTop: 22,
    borderWidth: 1.5,
    borderColor: "#f5a623",
  },
  btnManage: {
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.3)",
  },
  btnText: { color: "#ffffff", fontSize: 15, fontWeight: "800" },
  btnProText: { color: "#ffe2a3" },
  bottomSpacer: { height: 96 },
});
