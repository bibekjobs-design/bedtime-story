import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
} from "react-native";
import { colors } from "../theme/colors";
import { api } from "../api/client";
import { authStorage } from "../api/authStorage";
import VoiceRecorderModal from "../components/VoiceRecorderModal";

export default function ProfilesScreen({
  user,
  activeProfile,
  step,
  onSetActiveProfile,
  onLogout,
  onBack,
  onGoToUpgrade,
  onVoiceClonesChange,
  onProfilesChange,
}) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);

  // Auto-renew status for the plan card (Subscribe monthly / cancel).
  const [subStatus, setSubStatus] = useState(null);
  const [cancellingAutopay, setCancellingAutopay] = useState(false);
  useEffect(() => {
    if (!user) return;
    api.getSubscriptionStatus().then(setSubStatus).catch(() => {});
  }, [user?.id, user?.subscription_tier]);

  function autopayEndDate() {
    const raw = subStatus?.subscription_expires_at || user?.subscription_expires_at;
    const d = raw ? new Date(raw) : null;
    return d && !isNaN(d.getTime())
      ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
      : null;
  }

  function handleCancelAutopay() {
    const run = async () => {
      setCancellingAutopay(true);
      try {
        const res = await api.cancelAutopay();
        const refreshed = await api.getSubscriptionStatus();
        setSubStatus(refreshed);
        const msg = res?.message || "Auto-renew is off.";
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("Auto-renew off", msg);
      } catch (e) {
        const msg = e.message || "Couldn't cancel auto-renew. Please try again.";
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("Error", msg);
      } finally {
        setCancellingAutopay(false);
      }
    };
    const question = "Turn off auto-renew? Your plan stays active until the end of the period you've already paid for.";
    if (Platform.OS === "web") {
      if (window.confirm(question)) run();
    } else {
      Alert.alert("Cancel auto-renew", question, [
        { text: "Keep it on", style: "cancel" },
        { text: "Turn off", style: "destructive", onPress: run },
      ]);
    }
  }
  const [showAddModal, setShowAddModal] = useState(false);
  const [ageGroups, setAgeGroups] = useState([]);

  // New Profile Form State
  const [newChildName, setNewChildName] = useState("");
  const [selectedChildAge, setSelectedChildAge] = useState(4);
  const [selectedAgeGroupId, setSelectedAgeGroupId] = useState(1);
  // Deep-sleeper friendly: default sleep timer stays at or under 15 minutes
  // so a napping child isn't left with audio playing for 30-45 minutes.
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState(15);
  const [creating, setCreating] = useState(false);

  // The app only has 3 content buckets (2-4, 5-7, 8-15) with story categories
  // actually mapped to them - the parent picks an exact age in years for a
  // clearer, friendlier UI, and we translate that year to whichever bucket's
  // story content actually fits, rather than making a 4th/5th bucket with no
  // content behind it.
  function mapAgeToGroupId(age, groups) {
    if (!groups || groups.length === 0) return null;
    const sorted = [...groups].sort((a, b) => a.min_age - b.min_age);
    const match = sorted.find((g) => age >= g.min_age && age <= g.max_age);
    if (match) return match.id;
    // Older than the oldest defined bucket (shouldn't normally happen once
    // that bucket's max_age covers up to 15) - fall back to it anyway rather
    // than sending an invalid/undefined age_group_id.
    return sorted[sorted.length - 1].id;
  }

  const [voiceClones, setVoiceClones] = useState([]);
  const [showVoiceCloneModal, setShowVoiceCloneModal] = useState(false);

  useEffect(() => {
    if (ageGroups.length > 0) {
      setSelectedAgeGroupId(mapAgeToGroupId(selectedChildAge, ageGroups));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ageGroups]);

  useEffect(() => {
    // Profiles and Settings share one mounted instance of this screen (see
    // App.js), so toggling between them never used to remount and never
    // refetched - a profile added from elsewhere (another session, a script,
    // a teammate) stayed invisible until a full page reload. Refetch every
    // time the parent's active step changes so it's always current.
    loadData();
  }, [step]);

  async function loadData() {
    try {
      setLoading(true);
      const [profData, ageData, cloneData] = await Promise.all([
        api.getProfiles().catch(() => []),
        api.getAgeGroups().catch(() => []),
        api.getVoiceClones().catch(() => []),
      ]);
      const uniqueClones = (cloneData || []).filter(
        (v, idx, arr) => arr.findIndex((item) => item.id === v.id) === idx
      );
      setProfiles(profData || []);
      setAgeGroups(ageData || []);
      setVoiceClones(uniqueClones);
      if (onVoiceClonesChange) onVoiceClonesChange(uniqueClones);
      // Home screen (AgeGroupScreen) reads its own top-level `profiles` state
      // in App.js, separate from this screen's local state - without this,
      // a newly created/loaded profile (e.g. Advik) keeps showing as the
      // generic "Toddlers"/"Kids" fallback on Home until a full page reload.
      if (onProfilesChange) onProfilesChange(profData || []);

      // If activeProfile is not in server profiles list, clear it
      if (activeProfile && (!profData || !profData.some((p) => p.id === activeProfile.id))) {
        onSetActiveProfile(null);
      }
    } catch (err) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateProfile() {
    if (!newChildName.trim()) {
      if (Platform.OS === "web") {
        window.alert("Please enter the child's name.");
      } else {
        Alert.alert("Required", "Please enter the child's name.");
      }
      return;
    }

    try {
      setCreating(true);
      const created = await api.createProfile({
        name: newChildName.trim(),
        age_group_id: selectedAgeGroupId,
        language_id: 1,
        narration_speed: 0.8,
        sleep_timer_minutes: sleepTimerMinutes,
      });

      setProfiles((prev) => {
        const filtered = prev.filter((p) => p.id !== created.id);
        const next = [...filtered, created];
        if (onProfilesChange) onProfilesChange(next);
        return next;
      });
      onSetActiveProfile(created);
      setShowAddModal(false);
      const savedName = newChildName.trim();
      setNewChildName("");

      if (Platform.OS === "web") {
        window.alert(`Saved Successfully! Profile for ${savedName} has been created.`);
      } else {
        Alert.alert("Saved Successfully", `Profile for ${savedName} has been created!`);
      }
    } catch (err) {
      if (Platform.OS === "web") {
        window.alert("Failed to create profile: " + err.message);
      } else {
        Alert.alert("Error", err.message);
      }
    } finally {
      setCreating(false);
    }
  }

  const [samplePlayingId, setSamplePlayingId] = useState(null);
  const sampleAudioRef = useRef(null);

  function togglePlaySample(clone) {
    if (samplePlayingId === clone.id && sampleAudioRef.current) {
      sampleAudioRef.current.pause();
      sampleAudioRef.current = null;
      setSamplePlayingId(null);
    } else {
      if (sampleAudioRef.current) {
        sampleAudioRef.current.pause();
      }
      const url = clone.sample_audio_url;
      if (!url) {
        alert("Voice sample audio is not available.");
        return;
      }
      const audio = new Audio(url);
      sampleAudioRef.current = audio;
      audio.onended = () => {
        setSamplePlayingId(null);
        sampleAudioRef.current = null;
      };
      audio.onerror = () => {
        alert("Could not play audio sample.");
        setSamplePlayingId(null);
        sampleAudioRef.current = null;
      };
      audio.play().catch((e) => {
        alert("Could not play sample: " + e.message);
        setSamplePlayingId(null);
      });
      setSamplePlayingId(clone.id);
    }
  }

  async function handleDeleteProfile(profileId, childName) {
    if (Platform.OS === "web") {
      if (window.confirm(`Are you sure you want to delete ${childName}'s profile?`)) {
        try {
          await api.deleteProfile(profileId);
          setProfiles((prev) => {
            const next = prev.filter((p) => p.id !== profileId);
            if (onProfilesChange) onProfilesChange(next);
            return next;
          });
          if (activeProfile?.id === profileId) {
            onSetActiveProfile(null);
          }
        } catch (err) {
          alert("Error: " + err.message);
        }
      }
      return;
    }

    Alert.alert(
      "Delete Profile",
      `Are you sure you want to delete ${childName}'s profile?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteProfile(profileId);
              setProfiles((prev) => {
                const next = prev.filter((p) => p.id !== profileId);
                if (onProfilesChange) onProfilesChange(next);
                return next;
              });
              if (activeProfile?.id === profileId) {
                onSetActiveProfile(null);
              }
            } catch (err) {
              Alert.alert("Error", err.message);
            }
          },
        },
      ]
    );
  }

  async function handleDeleteVoiceClone(cloneId, label) {
    const doDelete = async () => {
      // Optimistically remove from state
      setVoiceClones((prev) => {
        const updated = prev.filter((v) => v.id !== cloneId);
        if (onVoiceClonesChange) onVoiceClonesChange(updated);
        return updated;
      });
      if (samplePlayingId === cloneId && sampleAudioRef.current) {
        sampleAudioRef.current.pause();
        sampleAudioRef.current = null;
        setSamplePlayingId(null);
      }
      try {
        await api.deleteVoiceClone(cloneId);
      } catch (err) {
        console.warn("Delete voice clone warning:", err);
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm(`Are you sure you want to remove "${label || "this voice"}"?`)) {
        await doDelete();
      }
      return;
    }

    Alert.alert(
      "Delete Voice Clone",
      `Are you sure you want to remove "${label || "this voice"}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: doDelete,
        },
      ]
    );
  }

  const isPremium = ["premium", "premium_monthly", "premium_annual", "admin_vip"].includes(
    user?.subscription_tier
  );
  const isNormal = user?.subscription_tier === "normal_monthly";
  const isProPlan = user?.subscription_tier === "pro_monthly"; // Rs 151
  const isPaid = isPremium || isNormal || isProPlan;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backText}>← Back to Stories</Text>
        </TouchableOpacity>

        {/* Parent Account Card */}
        <View style={styles.parentCard}>
          <View style={styles.parentHeader}>
            <View>
              <Text style={styles.parentName}>{user?.full_name || "Parent"}</Text>
              <Text style={styles.parentEmail}>{user?.email}</Text>
            </View>
            <View
              style={[
                styles.tierBadge,
                isPremium ? styles.tierBadgePremium : isNormal ? styles.tierBadgePremium : styles.tierBadgeFree,
              ]}
            >
              <Text style={styles.tierText}>
                {isPremium ? "👑 Pro" : isNormal ? "📖 Normal" : "Free Plan"}
              </Text>
            </View>
          </View>

          {/* Auto-renew status (only for users who chose "Subscribe monthly") */}
          {subStatus?.autopay_status === "active" || subStatus?.autopay_status === "authenticated" ? (
            <View style={styles.autopayBox}>
              <Text style={styles.autopayTitle}>🔁 Auto-renew is on</Text>
              <Text style={styles.autopayText}>
                Your plan renews every month{autopayEndDate() ? ` (current period ends ${autopayEndDate()})` : ""}.
              </Text>
              <TouchableOpacity
                style={[styles.autopayCancelBtn, cancellingAutopay && { opacity: 0.6 }]}
                onPress={handleCancelAutopay}
                disabled={cancellingAutopay}
              >
                <Text style={styles.autopayCancelText}>
                  {cancellingAutopay ? "Turning off..." : "Cancel auto-renew"}
                </Text>
              </TouchableOpacity>
            </View>
          ) : subStatus?.autopay_status === "cancelling" ? (
            <View style={styles.autopayBox}>
              <Text style={styles.autopayTitle}>Auto-renew is off</Text>
              <Text style={styles.autopayText}>
                Your plan stays active{autopayEndDate() ? ` until ${autopayEndDate()}` : " until the end of the period you've paid for"}, then it won't renew.
              </Text>
            </View>
          ) : null}

          {!isPremium && (
            <View style={styles.upgradeCard}>
              <View style={styles.upgradeCardHeader}>
                <Text style={styles.upgradeEmoji}>{isProPlan ? "👑" : "✨"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.upgradeTitle}>
                    {isProPlan
                      ? "Unlock parent voice cloning"
                      : isNormal
                      ? "Unlock story creation"
                      : "Give your kids the full magic"}
                  </Text>
                  <Text style={styles.upgradeSubtitle}>
                    {isProPlan ? (
                      <>
                        Bedtime Story Super · <Text style={styles.upgradePrice}>₹219</Text>/month{" "}
                        <Text style={styles.upgradeStrikePrice}>₹299</Text>
                      </>
                    ) : (
                      <>
                        Bedtime Story Pro · <Text style={styles.upgradePrice}>₹151</Text>/month
                      </>
                    )}
                  </Text>
                </View>
              </View>

              <View style={styles.upgradeBenefits}>
                {isProPlan ? (
                  <>
                    <View style={styles.upgradeBenefitRow}>
                      <Text style={styles.upgradeBenefitIcon}>🎙️</Text>
                      <Text style={styles.upgradeBenefitText}>
                        Narrate stories in <Text style={styles.boldInline}>your own voice</Text> — Mom or Dad, cloned (4/month)
                      </Text>
                    </View>
                    <View style={styles.upgradeBenefitRow}>
                      <Text style={styles.upgradeBenefitIcon}>✨</Text>
                      <Text style={styles.upgradeBenefitText}>
                        8 AI story generations every month, up to 5 minutes each
                      </Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.upgradeBenefitRow}>
                      <Text style={styles.upgradeBenefitIcon}>✨</Text>
                      <Text style={styles.upgradeBenefitText}>
                        <Text style={styles.boldInline}>5 AI-narrated stories</Text> every month, voiced by Luna & friends
                      </Text>
                    </View>
                    <View style={styles.upgradeBenefitRow}>
                      <Text style={styles.upgradeBenefitIcon}>🎙️</Text>
                      <Text style={styles.upgradeBenefitText}>
                        Want Mom or Dad's own cloned voice? That's in Super (₹219/month)
                      </Text>
                    </View>
                  </>
                )}
                <View style={styles.upgradeBenefitRow}>
                  <Text style={styles.upgradeBenefitIcon}>🧸</Text>
                  <Text style={styles.upgradeBenefitText}>
                    <Text style={styles.boldInline}>Unlimited child profiles</Text> — one for every kid, not just one
                  </Text>
                </View>
                <View style={styles.upgradeBenefitRow}>
                  <Text style={styles.upgradeBenefitIcon}>🌙</Text>
                  <Text style={styles.upgradeBenefitText}>
                    Full library access & offline playback for restful, screen-free bedtimes
                  </Text>
                </View>
              </View>

              <TouchableOpacity style={styles.upgradeCta} onPress={onGoToUpgrade}>
                <Text style={styles.upgradeCtaText}>
                  {isProPlan
                    ? "Upgrade to Super — ₹219/month"
                    : isNormal
                    ? "Upgrade to Pro — ₹151/month"
                    : "View Plans — from ₹99/month"}
                </Text>
              </TouchableOpacity>
              <Text style={styles.upgradeFooterNote}>Cancel anytime. No hidden charges.</Text>
            </View>
          )}
        </View>

        {/* Child Profiles Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Child Profiles</Text>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => setShowAddModal(true)}
          >
            <Text style={styles.addBtnText}>+ Add Child</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primaryLight} style={{ marginVertical: 30 }} />
        ) : profiles.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyEmoji}>🧸</Text>
            <Text style={styles.emptyTitle}>No child profiles yet</Text>
            <Text style={styles.emptySubtitle}>
              Add a child profile to save their favorite age group and sleep timer.
            </Text>
            <TouchableOpacity
              style={styles.addFirstBtn}
              onPress={() => setShowAddModal(true)}
            >
              <Text style={styles.addFirstBtnText}>Create Profile</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.profileList}>
            {profiles.map((p) => {
              const isActive = activeProfile?.id === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.profileCard, isActive && styles.profileCardActive]}
                  onPress={() => onSetActiveProfile(p)}
                  activeOpacity={0.8}
                >
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarEmoji}>🧸</Text>
                  </View>

                  <View style={styles.profileDetails}>
                    <View style={styles.profileTitleRow}>
                      <Text style={styles.childName}>{p.name}</Text>
                      {isActive && (
                        <View style={styles.activePill}>
                          <Text style={styles.activePillText}>Active</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.profileMeta}>
                      Ages {p.age_groups?.label || "2-4"} • Timer: {p.sleep_timer_minutes || 20}m
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleDeleteProfile(p.id, p.name)}
                  >
                    <Text style={styles.deleteText}>✕</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Parent Voice Clones Section - visible to everyone, but cloning a
            voice has a real per-clone cost, so free accounts are routed to
            checkout instead of the recorder when they tap it. */}
        <View style={[styles.sectionHeader, { marginTop: 12 }]}>
          <Text style={styles.sectionTitle}>Parent Voice Clones 🎙️</Text>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => (isPremium ? setShowVoiceCloneModal(true) : onGoToUpgrade && onGoToUpgrade())}
          >
            <Text style={styles.addBtnText}>{isPremium ? "+ Clone Voice" : "🔒 + Clone Voice"}</Text>
          </TouchableOpacity>
        </View>

        {voiceClones.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyEmoji}>🎙️</Text>
            <Text style={styles.emptyTitle}>No Cloned Voices Yet</Text>
            <Text style={styles.emptySubtitle}>
              {isPremium
                ? "Clone your voice so bedtime stories can be narrated in Mom or Dad's comforting voice."
                : "Clone your voice so bedtime stories can be narrated in Mom or Dad's comforting voice. This is a Super feature (₹219/month)."}
            </Text>
            <TouchableOpacity
              style={styles.addFirstBtn}
              onPress={() => (isPremium ? setShowVoiceCloneModal(true) : onGoToUpgrade && onGoToUpgrade())}
            >
              <Text style={styles.addFirstBtnText}>
                {isPremium ? "Clone Your Voice" : "Upgrade to Clone Your Voice"}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.profileList}>
            {voiceClones.map((vc) => (
              <View key={vc.id} style={styles.profileCard}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarEmoji}>🎙️</Text>
                </View>
                <View style={styles.profileDetails}>
                  <Text style={styles.childName}>{vc.display_name || "Parent Voice"}</Text>
                  <Text style={styles.profileMeta}>Status: Ready ✅</Text>
                </View>
                <TouchableOpacity
                  style={styles.sampleListenBtn}
                  onPress={() => togglePlaySample(vc)}
                >
                  <Text style={styles.sampleListenText}>
                    {samplePlayingId === vc.id ? "⏸️ Pause" : "▶️ Sample"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => handleDeleteVoiceClone(vc.id, vc.display_name)}
                >
                  <Text style={styles.deleteText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Interactive Voice Recorder Studio Modal */}
      <VoiceRecorderModal
        visible={showVoiceCloneModal}
        onClose={() => setShowVoiceCloneModal(false)}
        onVoiceCreated={(newClone) => {
          setVoiceClones((prev) => {
            const filtered = prev.filter((v) => v.id !== newClone.id);
            const updated = [...filtered, newClone];
            if (onVoiceClonesChange) onVoiceClonesChange(updated);
            return updated;
          });
        }}
      />

      {/* Add Profile Modal */}
      <Modal visible={showAddModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Child Profile</Text>
            <Text style={styles.modalSubtitle}>
              Customize story pacing and age group for your child.
            </Text>

            <View style={styles.modalForm}>
              <Text style={styles.modalLabel}>Child's Name</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. Aarav, Maya"
                placeholderTextColor={colors.textDim}
                value={newChildName}
                onChangeText={setNewChildName}
              />

              <Text style={styles.modalLabel}>Child's Age</Text>
              <View style={styles.ageRow}>
                {Array.from({ length: 14 }, (_, i) => i + 2).map((yr) => (
                  <TouchableOpacity
                    key={yr}
                    style={[
                      styles.ageBtn,
                      selectedChildAge === yr && styles.ageBtnActive,
                    ]}
                    onPress={() => {
                      setSelectedChildAge(yr);
                      setSelectedAgeGroupId(mapAgeToGroupId(yr, ageGroups));
                    }}
                  >
                    <Text
                      style={[
                        styles.ageBtnText,
                        selectedChildAge === yr && styles.ageBtnTextActive,
                      ]}
                    >
                      {yr}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.modalLabel}>Default Sleep Timer (max 15 min)</Text>
              <View style={styles.ageRow}>
                {[5, 10, 15].map((mins) => (
                  <TouchableOpacity
                    key={mins}
                    style={[
                      styles.ageBtn,
                      sleepTimerMinutes === mins && styles.ageBtnActive,
                    ]}
                    onPress={() => setSleepTimerMinutes(mins)}
                  >
                    <Text
                      style={[
                        styles.ageBtnText,
                        sleepTimerMinutes === mins && styles.ageBtnTextActive,
                      ]}
                    >
                      {mins}m
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setShowAddModal(false)}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalSaveBtn}
                  onPress={handleCreateProfile}
                  disabled={creating}
                >
                  {creating ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.modalSaveText}>Save Profile</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "transparent",
  },
  content: {
    padding: 24,
    paddingTop: 54,
    paddingBottom: 40,
  },
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    marginBottom: 20,
  },
  backText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  parentCard: {
    backgroundColor: "rgba(15, 20, 45, 0.7)",
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    marginBottom: 28,
  },
  autopayBox: {
    marginTop: 14,
    backgroundColor: "rgba(124, 58, 237, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(124, 58, 237, 0.35)",
    borderRadius: 16,
    padding: 14,
  },
  autopayTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 4,
  },
  autopayText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 13,
    lineHeight: 19,
  },
  autopayCancelBtn: {
    alignSelf: "flex-start",
    marginTop: 10,
    backgroundColor: "rgba(255, 90, 90, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(255, 90, 90, 0.35)",
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  autopayCancelText: {
    color: "#ff8a8a",
    fontSize: 12,
    fontWeight: "700",
  },
  parentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  parentName: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 4,
  },
  parentEmail: {
    color: colors.textMuted,
    fontSize: 13,
  },
  tierBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  tierBadgeFree: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  tierBadgePremium: {
    backgroundColor: "rgba(245, 158, 11, 0.2)",
    borderWidth: 1,
    borderColor: colors.accent,
  },
  tierText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
  },
  upgradeCard: {
    marginTop: 18,
    backgroundColor: "rgba(147, 51, 234, 0.14)",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.35)",
  },
  upgradeCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  upgradeEmoji: {
    fontSize: 30,
  },
  upgradeTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 3,
  },
  upgradeSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  upgradePrice: {
    color: colors.sliderThumb,
    fontWeight: "800",
  },
  upgradeStrikePrice: {
    color: colors.textDim,
    fontWeight: "600",
    fontSize: 11,
    textDecorationLine: "line-through",
  },
  upgradeBenefits: {
    marginBottom: 16,
  },
  upgradeBenefitRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
    gap: 8,
  },
  upgradeBenefitIcon: {
    fontSize: 14,
    marginTop: 1,
  },
  upgradeBenefitText: {
    color: colors.text,
    fontSize: 12.5,
    lineHeight: 18,
    flex: 1,
  },
  boldInline: {
    fontWeight: "800",
    color: colors.sliderThumb,
  },
  upgradeCta: {
    backgroundColor: colors.primary,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
  },
  upgradeCtaText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },
  upgradeFooterNote: {
    color: colors.textDim,
    fontSize: 10,
    textAlign: "center",
    marginTop: 8,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  addBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  addBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  profileList: {
    gap: 12,
    marginBottom: 30,
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15, 20, 45, 0.7)",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  profileCardActive: {
    borderColor: colors.primaryLight,
    backgroundColor: "rgba(245, 166, 35, 0.2)",
  },
  avatarCircle: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  avatarEmoji: {
    fontSize: 22,
  },
  profileDetails: {
    flex: 1,
  },
  profileTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  childName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  activePill: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  activePillText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  profileMeta: {
    color: colors.textMuted,
    fontSize: 12,
  },
  deleteBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteText: {
    color: "#ef4444",
    fontSize: 14,
    fontWeight: "700",
  },
  emptyBox: {
    backgroundColor: "rgba(15, 20, 45, 0.7)",
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    marginBottom: 28,
  },
  emptyEmoji: {
    fontSize: 40,
    marginBottom: 10,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 6,
  },
  emptySubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 18,
  },
  addFirstBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  addFirstBtnText: {
    color: "#fff",
    fontWeight: "700",
  },
  logoutBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.25)",
  },
  logoutText: {
    color: "#f87171",
    fontSize: 14,
    fontWeight: "700",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: "rgba(15, 20, 45, 0.95)",
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  modalTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 4,
  },
  modalSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 20,
  },
  modalForm: {
    gap: 14,
  },
  modalLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
  modalInput: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
  ageRow: {
    flexDirection: "row",
    gap: 8,
  },
  ageBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    alignItems: "center",
  },
  ageBtnActive: {
    backgroundColor: colors.primary,
  },
  ageBtnText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  ageBtnTextActive: {
    color: "#fff",
    fontWeight: "700",
  },
  modalBtnRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  modalCancelText: {
    color: colors.textMuted,
    fontWeight: "600",
  },
  modalSaveBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  modalSaveText: {
    color: "#fff",
    fontWeight: "700",
  },
  passageBox: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  passageText: {
    color: colors.sliderThumb,
    fontSize: 13,
    fontStyle: "italic",
    lineHeight: 18,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.textDim,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmark: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  checkboxLabel: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  sampleListenBtn: {
    backgroundColor: "rgba(147, 51, 234, 0.2)",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(147, 51, 234, 0.4)",
    marginRight: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  sampleListenText: {
    color: colors.primaryLight,
    fontSize: 12,
    fontWeight: "700",
  },
});
