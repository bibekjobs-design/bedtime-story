import React, { useState, useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet, View, Text, TextInput, TouchableOpacity, Platform, Alert, LogBox, StatusBar as RNStatusBar, Modal, Linking } from "react-native";
import { initialWindowMetrics } from "react-native-safe-area-context";
import SafeAudio from "./src/utils/safeAudio";
import { colors } from "./src/theme/colors";
import { authStorage } from "./src/api/authStorage";
import { api, setOnUnauthorizedHandler } from "./src/api/client";
import { SITE_URL } from "./src/api/config";

LogBox.ignoreAllLogs(true);

import AgeGroupScreen from "./src/screens/AgeGroupScreen";
import HomeFeedScreen, { clearFeedCache } from "./src/screens/HomeFeedScreen";
import CreateScreen from "./src/screens/CreateScreen";
import PlayerScreen from "./src/screens/PlayerScreen";
import LoginScreen from "./src/screens/LoginScreen";
import RegisterScreen from "./src/screens/RegisterScreen";
import ForgotPasswordScreen from "./src/screens/ForgotPasswordScreen";
import ResetPasswordScreen from "./src/screens/ResetPasswordScreen";
import ProfilesScreen from "./src/screens/ProfilesScreen";
import HistoryScreen, { clearHistoryCache } from "./src/screens/HistoryScreen";
import CategoryStoriesScreen from "./src/screens/CategoryStoriesScreen";
import AdminDashboardScreen from "./src/screens/AdminDashboardScreen";
import ParentalGateModal from "./src/components/ParentalGateModal";
import SubscriptionModal from "./src/components/SubscriptionModal";
import StarryBackground from "./src/components/StarryBackground";
import NotificationBell from "./src/components/NotificationBell";
import SLogo from "./src/components/SLogo";
import StoryLandSplash from "./src/components/StoryLandSplash";

function getInitialAuthFlow() {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const match = window.location.href.match(/[?&#]token=([a-zA-Z0-9_\-]+)/);
    if (match && match[1]) {
      return { step: "reset", token: match[1] };
    }
  }
  return { step: "login", token: "" };
}

export default function App() {
  const initialAuth = getInitialAuthFlow();
  // Navigation state:
  // 'login' | 'age' | 'picker' | 'player' | 'register' | 'forgot' | 'reset' | 'profiles'
  const [currentStep, setCurrentStep] = useState(initialAuth.step);
  const [selectedAgeGroup, setSelectedAgeGroup] = useState(null);
  const [selectedStory, setSelectedStory] = useState(null);
  const [playerOrigin, setPlayerOrigin] = useState("home"); // where to go back to from the Player
  const [resetToken, setResetToken] = useState(initialAuth.token);

  // Auth & Profile state
  const [currentUser, setCurrentUser] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(null);
  const [voiceClones, setVoiceClones] = useState([]);
  const [showParentGate, setShowParentGate] = useState(false);
  const [pendingParentTarget, setPendingParentTarget] = useState("profiles"); // 'profiles' | 'login'
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false); // Delete-account confirmation
  const [deletePw, setDeletePw] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");
  const [menuOpen, setMenuOpen] = useState(false); // header ☰ menu
  const [notifSignal, setNotifSignal] = useState(0); // bumps to open the notification sheet
  const [unreadCount, setUnreadCount] = useState(0);
  const [browseLanguage, setBrowseLanguage] = useState("en"); // story-list language filter (Home + categories)
  const [categoryBackStep, setCategoryBackStep] = useState("home"); // where Back goes from a category page

  // Real safe-area bottom inset (gesture bar / home indicator height) instead
  // of a guessed fixed value, so the nav bar sits correctly above it.
  const bottomInset = initialWindowMetrics?.insets?.bottom ?? 0;

  useEffect(() => {
    let hasResetToken = initialAuth.step === "reset";
    // Check for reset token in URL parameters (Web)
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const match = window.location.href.match(/[?&#]token=([a-zA-Z0-9_\-]+)/);
      if (match && match[1]) {
        hasResetToken = true;
        setResetToken(match[1]);
        setCurrentStep("reset");
      }
    }

    setOnUnauthorizedHandler((reason) => {
      handleLogout();
      if (reason && reason.toLowerCase().includes("another device")) {
        if (Platform.OS === "web") {
          window.alert("Session Expired: Your account was logged in from another device. Please log in again.");
        } else {
          Alert.alert("Session Expired", "Your account was logged in from another device. Please log in again.");
        }
      }
    });
    loadSavedSession(hasResetToken);
  }, []);

  async function loadSavedSession(hasResetToken = false, moveToProfiles = true) {
    const user = await authStorage.getUser();
    if (user) {
      setCurrentUser(user);
      if (moveToProfiles && !hasResetToken && initialAuth.step !== "reset") {
        setCurrentStep("age");
      }
      try {
        // Refresh the user record live from the server (not just the cached
        // copy from login time) - this is what picks up subscription_tier
        // changes since login, e.g. an admin/test account's premium
        // override, or a plan upgrade, without needing to log out and in.
        api.getMe().then((freshUser) => {
          if (freshUser) {
            setCurrentUser(freshUser);
            authStorage.saveUser(freshUser).catch(() => {});
          }
        }).catch(() => {});

        const [clones, userProfiles] = await Promise.all([
          api.getVoiceClones().catch(() => []),
          api.getProfiles().catch(() => []),
        ]);
        const uniqueClones = (clones || []).filter(
          (v, idx, arr) => arr.findIndex((item) => item.id === v.id) === idx
        );
        setVoiceClones(uniqueClones);
        const validProfiles = userProfiles || [];
        setProfiles(validProfiles);

        // Validate active child profile against server list
        const savedProfile = await authStorage.getActiveProfile();
        if (
          savedProfile &&
          validProfiles.some((p) => p.id === savedProfile.id)
        ) {
          setActiveProfile(savedProfile);
        } else if (validProfiles.length > 0) {
          setActiveProfile(validProfiles[0]);
          await authStorage.saveActiveProfile(validProfiles[0]);
        } else {
          setActiveProfile(null);
          await authStorage.saveActiveProfile(null);
        }
      } catch (err) {
        console.warn("Session loading error:", err);
      }
    } else {
      setCurrentUser(null);
      setProfiles([]);
      setActiveProfile(null);
      await authStorage.saveActiveProfile(null);
      if (!hasResetToken && initialAuth.step !== "reset") {
        setCurrentStep("login");
      }
    }
  }

  function handleOpenParentArea() {
    if (currentUser) {
      setCurrentStep("profiles");
    } else {
      setCurrentStep("login");
    }
  }

  function handleDirectLoginPress() {
    setCurrentStep("login");
  }

  function handleGateSuccess() {
    setShowParentGate(false);
    if (currentUser) {
      setCurrentStep("profiles");
    } else {
      setCurrentStep("login");
    }
  }

  function openSitePage(page) {
    setMenuOpen(false);
    const url = `${SITE_URL}/${page}`;
    if (Platform.OS === "web" && typeof window !== "undefined") window.open(url, "_blank");
    else Linking.openURL(url).catch(() => {});
  }

  async function handleDeleteAccount() {
    setDeleteBusy(true);
    setDeleteErr("");
    try {
      await api.deleteAccount(deletePw);
      setDeleteOpen(false);
      setDeletePw("");
      await handleLogout();
    } catch (e) {
      setDeleteErr(e?.message || "Could not delete the account. Please try again.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleLogout() {
    clearFeedCache();
    clearHistoryCache();
    // 1. Immediately silence all active audio playback (narration and ambient)
    try {
      await SafeAudio.stopAllAudio();
    } catch (e) {
      console.warn("Audio silencing on logout:", e);
    }

    // 2. Clear state and session
    await authStorage.clearAll();
    setCurrentUser(null);
    setSelectedStory(null);
    setProfiles([]);
    setActiveProfile(null);
    setVoiceClones([]);
    setCurrentStep("login");
  }

  const [initialSearchQuery, setInitialSearchQuery] = useState("");

  const isPlayer = currentStep === "player";
  const isAuthScreen = ["login", "register", "forgot", "profiles", "splash"].includes(currentStep);
  const isPremiumUser = ["premium", "premium_monthly", "premium_annual", "admin_vip"].includes(
    currentUser?.subscription_tier
  );

  return (
    <StarryBackground>
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />

      {currentStep === "home" && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "#05060c" }]} />
      )}

      {/* Always-Accessible Top Header Bar */}
      {!isPlayer && !isAuthScreen && currentStep !== "age" && (
        <View style={styles.topHeader}>
          <TouchableOpacity
            style={styles.logoRow}
            onPress={() => setCurrentStep("age")}
            activeOpacity={0.8}
          >
            <SLogo size="sm" />
          </TouchableOpacity>

          <View style={styles.headerRightRow}>
            <NotificationBell
              hideButton
              openSignal={notifSignal}
              onUnreadChange={setUnreadCount}
              userKey={currentUser?.id || "guest"}
              onAction={(action) => {
                // Buttons on announcements only ever open screens inside the app.
                if (action === "plans") setShowSubscriptionModal(true);
                else if (action === "library") setCurrentStep("home");
                else if (["home", "create", "history"].includes(action)) setCurrentStep(action);
              }}
            />
            <TouchableOpacity style={styles.menuBtn} onPress={() => setMenuOpen(true)} activeOpacity={0.8}>
              <Text style={styles.menuBtnIcon}>☰</Text>
              {unreadCount > 0 && <View style={styles.menuDot} />}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Delete account: asks for the password, then removes everything */}
      <Modal visible={deleteOpen} transparent animationType="fade" onRequestClose={() => setDeleteOpen(false)}>
        <View style={styles.delScrim}>
          <View style={styles.delCard}>
            <Text style={styles.delTitle}>Delete your account?</Text>
            <Text style={styles.delText}>
              This permanently deletes your account, child profiles, history, stories you made and your cloned voices. It cannot be undone. Any auto-renew is stopped. Payment records are kept only as the law requires.
            </Text>
            <TextInput
              style={styles.delInput}
              placeholder="Enter your password to confirm"
              placeholderTextColor="#6b6e80"
              secureTextEntry
              value={deletePw}
              onChangeText={setDeletePw}
              autoCapitalize="none"
            />
            {deleteErr ? <Text style={styles.delErr}>{deleteErr}</Text> : null}
            <View style={styles.delRow}>
              <TouchableOpacity style={styles.delBtnGhost} onPress={() => setDeleteOpen(false)} disabled={deleteBusy}>
                <Text style={styles.delBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.delBtnDanger, (!deletePw || deleteBusy) && { opacity: 0.5 }]}
                disabled={!deletePw || deleteBusy}
                onPress={handleDeleteAccount}
              >
                <Text style={styles.delBtnText}>{deleteBusy ? "Deleting..." : "Delete forever"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Header menu: notifications and profile */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={styles.menuScrim} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuPanel} onStartShouldSetResponder={() => true}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                setTimeout(() => setNotifSignal((n) => n + 1), 250);
              }}
            >
              <Text style={styles.menuItemText}>🔔 Notifications</Text>
              {unreadCount > 0 && (
                <View style={styles.menuCount}>
                  <Text style={styles.menuCountText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
            {currentUser ? (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  setTimeout(handleOpenParentArea, 250);
                }}
              >
                <Text style={styles.menuItemText} numberOfLines={1}>
                  {activeProfile ? `🧸 ${activeProfile.name}` : "🛡️ Family Profiles"}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  setTimeout(handleDirectLoginPress, 250);
                }}
              >
                <Text style={styles.menuItemText}>🔑 Parent Login</Text>
              </TouchableOpacity>
            )}
            {SITE_URL ? (
              <>
                <TouchableOpacity style={styles.menuItem} onPress={() => openSitePage("privacy.html")}>
                  <Text style={styles.menuItemText}>🔒 Privacy Policy</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} onPress={() => openSitePage("terms.html")}>
                  <Text style={styles.menuItemText}>📄 Terms & Refunds</Text>
                </TouchableOpacity>
              </>
            ) : null}
            {currentUser ? (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  setDeletePw("");
                  setDeleteErr("");
                  setTimeout(() => setDeleteOpen(true), 250);
                }}
              >
                <Text style={[styles.menuItemText, { color: "#ff6b6b" }]}>🗑️ Delete my account</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Listening Screens */}
      {currentStep === "age" && (
        <AgeGroupScreen
          currentUser={currentUser}
          profiles={profiles}
          activeProfile={activeProfile}
          onSelectAgeGroup={(ageGroup, profile) => {
            setSelectedAgeGroup(ageGroup);
            if (profile) {
              setActiveProfile(profile);
              authStorage.saveActiveProfile(profile).catch(() => {});
            }
            setCurrentStep("home");
          }}
          onOpenLogin={handleDirectLoginPress}
          onOpenProfiles={() => setCurrentStep("profiles")}
          onGoToUpgrade={() => setShowSubscriptionModal(true)}
          onLogout={handleLogout}
          onOpenAdmin={() => setCurrentStep("admin_dashboard")}
          onNotificationAction={(action) => {
            // Buttons on announcements only ever open screens inside the app.
            if (action === "plans") setShowSubscriptionModal(true);
            else if (action === "library") setCurrentStep("home");
            else if (["home", "create", "history"].includes(action)) setCurrentStep(action);
          }}
        />
      )}

      {currentStep === "home" && (
        <HomeFeedScreen
          browseLanguage={browseLanguage}
          onBrowseLanguageChange={setBrowseLanguage}
          activeProfile={activeProfile}
          currentUser={currentUser}
          onGoToUpgrade={() => setShowSubscriptionModal(true)}
          onPlayStory={(storyData) => {
            setSelectedStory(storyData);
            setPlayerOrigin("home");
            setCurrentStep("player");
          }}
          onOpenCategory={(category) => {
            setSelectedCategory(category);
            setCategoryBackStep("home");
            setCurrentStep("category");
          }}
        />
      )}

      {currentStep === "category" && selectedCategory && (
        <CategoryStoriesScreen
          browseLanguage={browseLanguage}
          onBrowseLanguageChange={setBrowseLanguage}
          category={selectedCategory}
          activeProfile={activeProfile}
          currentUser={currentUser}
          onGoToUpgrade={() => setShowSubscriptionModal(true)}
          onPlayStory={(storyData) => {
            setSelectedStory(storyData);
            setPlayerOrigin("category");
            setCurrentStep("player");
          }}
          onBack={() => setCurrentStep(categoryBackStep)}
        />
      )}

      {currentStep === "create" && (
        <CreateScreen
          activeProfile={activeProfile}
          voiceClones={voiceClones}
          isPremium={isPremiumUser}
          subscriptionTier={currentUser?.subscription_tier}
          onPlayStory={(storyData) => {
            setSelectedStory(storyData);
            setPlayerOrigin("create");
            setCurrentStep("player");
          }}
          onGoToHome={() => setCurrentStep("home")}
          onGoToUpgrade={() => setShowSubscriptionModal(true)}
        />
      )}

      {currentStep === "history" && (
        <HistoryScreen
          step={currentStep}
          onPlayStory={(storyData) => {
            setSelectedStory(storyData);
            setPlayerOrigin("history");
            setCurrentStep("player");
          }}
          onGoToHome={() => setCurrentStep("home")}
        />
      )}

      {currentStep === "admin_dashboard" && (
        <AdminDashboardScreen onGoToHome={() => setCurrentStep("home")} />
      )}

      {currentStep === "player" && selectedStory && (
        <PlayerScreen
          key={`${selectedStory.story_text_id || selectedStory.id}-${selectedStory.language_code || "orig"}`}
          story={selectedStory}
          onBack={() => setCurrentStep(playerOrigin)}
          onSwitchLanguage={(data) => setSelectedStory(data)}
        />
      )}

      {currentStep === "splash" && <StoryLandSplash onDone={() => setCurrentStep("age")} />}

      {/* Auth & Profile Screens */}
      {currentStep === "login" && (
        <LoginScreen
          onLoginSuccess={async (user) => {
            setCurrentUser(user);
            setCurrentStep("splash"); // STORY intro first (the profile picker must not flash before it)
            await loadSavedSession(false, false);
          }}
          onGoToRegister={() => setCurrentStep("register")}
          onGoToForgot={() => setCurrentStep("forgot")}
          onBack={() => setCurrentStep("age")}
        />
      )}

      {currentStep === "register" && (
        <LoginScreen
          initialTab="signup"
          onLoginSuccess={async (user) => {
            setCurrentUser(user);
            setCurrentStep("splash"); // STORY intro first (the profile picker must not flash before it)
            await loadSavedSession(false, false);
          }}
          onGoToForgot={() => setCurrentStep("forgot")}
          onBack={() => setCurrentStep("login")}
        />
      )}

      {currentStep === "forgot" && (
        <ForgotPasswordScreen
          onBack={() => setCurrentStep("login")}
          onGoToLogin={() => setCurrentStep("login")}
          onGoToReset={() => setCurrentStep("reset")}
        />
      )}

      {currentStep === "reset" && (
        <ResetPasswordScreen
          initialToken={resetToken}
          onResetSuccess={() => {
            if (Platform.OS === "web" && typeof window !== "undefined") {
              window.history.replaceState({}, document.title, window.location.pathname);
            }
            setResetToken("");
            setCurrentStep("login");
          }}
          onGoToLogin={() => {
            if (Platform.OS === "web" && typeof window !== "undefined") {
              window.history.replaceState({}, document.title, window.location.pathname);
            }
            setResetToken("");
            setCurrentStep("login");
          }}
          onBack={() => {
            if (Platform.OS === "web" && typeof window !== "undefined") {
              window.history.replaceState({}, document.title, window.location.pathname);
            }
            setResetToken("");
            setCurrentStep("login");
          }}
        />
      )}

      {(currentStep === "profiles" || currentStep === "settings") && (
        <ProfilesScreen
          user={currentUser}
          activeProfile={activeProfile}
          step={currentStep}
          voiceClones={voiceClones}
          onVoiceClonesChange={setVoiceClones}
          onProfilesChange={setProfiles}
          onSetActiveProfile={async (prof) => {
            setActiveProfile(prof);
            await authStorage.saveActiveProfile(prof);
          }}
          onLogout={handleLogout}
          onBack={async () => {
            await loadSavedSession();
            setCurrentStep("age");
          }}
          onGoToUpgrade={() => setShowSubscriptionModal(true)}
        />
      )}

      {/* Subscription & UPI Payment Modal */}
      <SubscriptionModal
        visible={showSubscriptionModal}
        onClose={() => setShowSubscriptionModal(false)}
        onSubscriptionSuccess={async () => {
          await loadSavedSession();
        }}
      />

      {/* Bottom Navigation Bar - 4 tabs (hidden on the profile picker) */}
      {!isPlayer && !isAuthScreen && currentStep !== "age" && (
        <View style={[styles.bottomNav, { paddingBottom: 8, bottom: 12 + bottomInset }]}>
          <TouchableOpacity style={[styles.navItem, currentStep === "home" && styles.navItemActive]} onPress={() => setCurrentStep("home")}>
            <Text style={styles.navIcon}>🏠</Text>
            <Text style={[styles.navText, currentStep === "home" && styles.navTextActive]}>Home</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.navItem, currentStep === "create" && styles.navItemActive]} onPress={() => setCurrentStep("create")}>
            <Text style={styles.navIcon}>✨</Text>
            <Text style={[styles.navText, currentStep === "create" && styles.navTextActive]}>Create</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.navItem, currentStep === "history" && styles.navItemActive]} onPress={() => setCurrentStep("history")}>
            <Text style={styles.navIcon}>🕘</Text>
            <Text style={[styles.navText, currentStep === "history" && styles.navTextActive]}>History</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navItem} onPress={currentUser ? handleLogout : handleDirectLoginPress}>
            <Text style={styles.navIcon}>{currentUser ? "🚪" : "🔑"}</Text>
            <Text style={styles.navText}>{currentUser ? "Log Out" : "Log In"}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Compliance Parental Gate Modal */}
      <ParentalGateModal
        visible={showParentGate}
        onCancel={() => setShowParentGate(false)}
        onSuccess={handleGateSuccess}
      />
      </SafeAreaView>
    </StarryBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "transparent",
    width: "100%",
    maxWidth: "100%",
    alignSelf: "stretch",
    // Web: exactly the visible screen height (dvh follows the phone browser's
    // address bar). A taller-than-screen box pushed the bottom of the list and
    // the nav below the fold, so Home could not be scrolled to its end.
    ...(Platform.OS === "web"
      ? { height: "100dvh", maxHeight: "100dvh", minHeight: 0 }
      : { minHeight: "100%" }),
    paddingTop: Platform.OS === "android" ? (RNStatusBar.currentHeight || 28) + 6 : 0,
  },
  topHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  logoIcon: {
    fontSize: 22,
  },
  logoText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  headerRightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  delScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 20 },
  delCard: { backgroundColor: "#0d0e16", borderRadius: 20, padding: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  delTitle: { color: "#fff", fontSize: 20, fontWeight: "800", marginBottom: 8 },
  delText: { color: "#b9bccb", fontSize: 13, lineHeight: 19, marginBottom: 14 },
  delInput: { backgroundColor: "#14151d", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", color: "#fff", paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  delErr: { color: "#ff6b6b", fontSize: 12, marginTop: 8 },
  delRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  delBtnGhost: { flex: 1, backgroundColor: "#232430", borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  delBtnDanger: { flex: 1, backgroundColor: "#7f1d1d", borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  delBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  menuBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#14151d",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  menuBtnIcon: { color: "#ffffff", fontSize: 19 },
  menuDot: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#e50914",
  },
  menuScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "flex-end" },
  menuPanel: {
    width: 230,
    height: "100%",
    backgroundColor: "#0d0e16",
    borderLeftWidth: 1,
    borderLeftColor: "rgba(255,255,255,0.12)",
    paddingTop: Platform.OS === "android" ? 64 : 60,
    paddingHorizontal: 12,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#14151d",
    marginBottom: 8,
  },
  menuItemText: { color: "#ffffff", fontSize: 14, fontWeight: "600", flexShrink: 1 },
  menuCount: { backgroundColor: "#e50914", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1 },
  menuCountText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  parentPill: {
    backgroundColor: "rgba(147, 51, 234, 0.15)",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(147, 51, 234, 0.3)",
  },
  parentPillText: {
    color: colors.sliderThumb,
    fontSize: 12,
    fontWeight: "700",
  },
  logoutBtn: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  logoutBtnText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  loginPill: {
    backgroundColor: colors.primary,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  loginPillText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  bottomNav: {
    ...Platform.select({
      web: { position: "fixed" },
      default: { position: "absolute" }
    }),
    bottom: 12,
    left: 16,
    right: 16,
    backgroundColor: "rgba(38, 38, 46, 0.97)",
    borderRadius: 34,
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 8,
    zIndex: 10,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 12,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(25px)' } : {}),
  },
  navItemActive: {
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 26,
  },
  sBadge: {
    width: 36,
    height: 42,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  sBadgeText: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "900",
    color: "#e50914",
    fontFamily: "serif",
  },
  navItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
  navIcon: {
    fontSize: 19,
    marginBottom: 4,
  },
  hamburgerIcon: {
    width: 19,
    height: 19,
    justifyContent: "center",
    alignItems: "center",
    gap: 3,
    marginBottom: 4,
  },
  hamburgerBar: {
    width: 17,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.textMuted,
  },
  hamburgerBarActive: {
    backgroundColor: colors.sliderThumb,
  },
  navText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  navTextActive: {
    color: colors.sliderThumb,
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  moreSheet: {
    backgroundColor: "#12172c",
    borderTopWidth: 1,
    borderTopColor: "rgba(147, 51, 234, 0.3)",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 30,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignSelf: "center",
    marginBottom: 14,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 6,
    borderRadius: 12,
  },
  sheetRowIcon: {
    fontSize: 17,
    width: 22,
  },
  sheetRowText: {
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "600",
  },
  sheetRowTextAdmin: {
    color: "#7dd3fc",
  },
  sheetRowTextLogout: {
    color: "#f87171",
  },
  sheetDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginVertical: 4,
  },
});
