import React, { useState } from "react";
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

// Unified auth screen: hero illustration + a single sheet with Log In / Sign Up
// as switchable tabs (no screen navigation between them). All Login and Sign Up
// field state, validation and API calls are unchanged from the previous
// separate LoginScreen/RegisterScreen - only the presentation is merged.
export default function LoginScreen({
  onLoginSuccess,
  onGoToRegister, // kept for backward compatibility; no longer needed to switch tabs
  onGoToForgot,
  onBack,
  initialTab = "login",
}) {
  const [activeTab, setActiveTab] = useState(initialTab); // "login" | "signup"

  // --- Login state (unchanged) ---
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password) {
      if (Platform.OS === "web") {
        window.alert("Please enter your email and password.");
      } else {
        Alert.alert("Required", "Please enter your email and password.");
      }
      return;
    }

    try {
      setLoading(true);
      const res = await api.login({ email: email.trim(), password });
      await authStorage.saveToken(res.access_token);
      await authStorage.saveUser(res.user);
      onLoginSuccess(res.user);
    } catch (err) {
      if (Platform.OS === "web") {
        window.alert("Login Failed: " + err.message);
      } else {
        Alert.alert("Login Failed", err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  // --- Sign Up state (unchanged from RegisterScreen.js) ---
  const [fullName, setFullName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [regLoading, setRegLoading] = useState(false);
  const [successModalVisible, setSuccessModalVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleRegister() {
    setErrorMessage("");
    if (!fullName.trim() || !regEmail.trim() || !mobileNumber.trim() || !regPassword || !confirmPassword) {
      setErrorMessage("Please complete all fields to register.");
      return;
    }

    if (regPassword.length < 8) {
      setErrorMessage("Password must be at least 8 characters.");
      return;
    }

    if (regPassword !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    try {
      setRegLoading(true);
      await api.register({
        full_name: fullName.trim(),
        email: regEmail.trim().toLowerCase(),
        mobile_number: mobileNumber.trim(),
        password: regPassword,
        confirm_password: confirmPassword,
        marketing_opt_in: marketingOptIn,
      });

      setSuccessModalVisible(true);
    } catch (err) {
      setErrorMessage(err.message || "Registration failed. Please check your details.");
    } finally {
      setRegLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <Text style={styles.backText}>← Browse Stories as Guest</Text>
      </TouchableOpacity>

      {/* Hero illustration */}
      <View style={styles.hero}>
        <Text style={styles.heroEmoji}>🦊📖</Text>
      </View>

      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>Dream Weaver</Text>
        <Text style={styles.sheetSubtitle}>
          {activeTab === "login"
            ? "Sign in to access your child's personalized bedtime stories and voice clones."
            : "Sign up to access personalized stories, multiple child profiles, and offline bedtime playback."}
        </Text>

        {/* Tab switcher */}
        <View style={styles.tabsRow}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === "login" && styles.tabBtnActive]}
            onPress={() => setActiveTab("login")}
          >
            <Text style={[styles.tabText, activeTab === "login" && styles.tabTextActive]}>Log In</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === "signup" && styles.tabBtnActive]}
            onPress={() => setActiveTab("signup")}
          >
            <Text style={[styles.tabText, activeTab === "signup" && styles.tabTextActive]}>Sign Up</Text>
          </TouchableOpacity>
        </View>

        {activeTab === "login" ? (
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email Address</Text>
              <TextInput
                style={[styles.input, emailFocused && styles.inputFocused]}
                placeholder="parent@example.com"
                placeholderTextColor={colors.textDim}
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
              />
            </View>

            <View style={styles.inputGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Password</Text>
                <TouchableOpacity onPress={onGoToForgot}>
                  <Text style={styles.forgotLink}>Forgot password?</Text>
                </TouchableOpacity>
              </View>
              <View style={[styles.passwordContainer, passwordFocused && styles.inputFocused]}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="Your password"
                  placeholderTextColor={colors.textDim}
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <Text style={styles.eyeIcon}>{showPassword ? "👁️" : "🙈"}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={styles.submitBtn}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>Log In</Text>
              )}
            </TouchableOpacity>

            <View style={styles.footerRow}>
              <Text style={styles.footerText}>Don't have an account? </Text>
              <TouchableOpacity onPress={() => setActiveTab("signup")}>
                <Text style={styles.signUpLink}>Sign Up</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.form}>
            {errorMessage ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>⚠️ {errorMessage}</Text>
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Full Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Jane Doe"
                placeholderTextColor={colors.textDim}
                value={fullName}
                onChangeText={setFullName}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email Address</Text>
              <TextInput
                style={styles.input}
                placeholder="parent@example.com"
                placeholderTextColor={colors.textDim}
                keyboardType="email-address"
                autoCapitalize="none"
                value={regEmail}
                onChangeText={setRegEmail}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Mobile Number</Text>
              <TextInput
                style={styles.input}
                placeholder="9876543210"
                placeholderTextColor={colors.textDim}
                keyboardType="phone-pad"
                value={mobileNumber}
                onChangeText={setMobileNumber}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password (min 8 characters)</Text>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="Create strong password"
                  placeholderTextColor={colors.textDim}
                  secureTextEntry={!showRegPassword}
                  value={regPassword}
                  onChangeText={setRegPassword}
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowRegPassword(!showRegPassword)}
                >
                  <Text style={styles.eyeIcon}>{showRegPassword ? "👁️" : "🙈"}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Confirm Password</Text>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="Repeat password"
                  placeholderTextColor={colors.textDim}
                  secureTextEntry={!showConfirmPassword}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  <Text style={styles.eyeIcon}>{showConfirmPassword ? "👁️" : "🙈"}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setMarketingOptIn(!marketingOptIn)}
              activeOpacity={0.8}
            >
              <View style={[styles.checkbox, marketingOptIn && styles.checkboxChecked]}>
                {marketingOptIn && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>
                Send me gentle bedtime story recommendations and product updates (optional).
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.submitBtn}
              onPress={handleRegister}
              disabled={regLoading}
              activeOpacity={0.8}
            >
              {regLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>Create Account</Text>
              )}
            </TouchableOpacity>

            <View style={styles.footerRow}>
              <Text style={styles.footerText}>Already have an account? </Text>
              <TouchableOpacity onPress={() => setActiveTab("login")}>
                <Text style={styles.signUpLink}>Log In</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Registration Success Modal (unchanged behavior) */}
      <Modal visible={successModalVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEmoji}>🎉 🌙</Text>
            <Text style={styles.modalTitle}>Account Created!</Text>
            <Text style={styles.modalSubtitle}>
              You have successfully registered your parent account. You can now log in to customize stories for your child.
            </Text>
            <TouchableOpacity
              style={styles.modalProceedBtn}
              onPress={() => {
                setSuccessModalVisible(false);
                setActiveTab("login");
              }}
            >
              <Text style={styles.modalProceedText}>Proceed to Log In →</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
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
    backgroundColor: "rgba(22, 29, 54, 0.6)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    marginBottom: 24,
  },
  backText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },

  hero: {
    height: 120,
    borderRadius: 22,
    backgroundColor: "rgba(26, 20, 64, 0.55)",
    borderWidth: 1,
    borderColor: "rgba(147, 51, 234, 0.25)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: -18,
  },
  heroEmoji: {
    fontSize: 40,
  },

  sheet: {
    backgroundColor: "rgba(11, 14, 32, 0.85)",
    borderRadius: 24,
    paddingTop: 26,
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(147, 51, 234, 0.22)",
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 4,
  },
  sheetSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    marginBottom: 18,
  },

  tabsRow: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 14,
    padding: 4,
    marginBottom: 18,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 11,
    alignItems: "center",
  },
  tabBtnActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  tabTextActive: {
    color: "#fff",
  },

  form: {},
  inputGroup: {
    marginBottom: 18,
  },
  label: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  forgotLink: {
    color: colors.sliderThumb,
    fontSize: 12,
    fontWeight: "600",
  },
  input: {
    backgroundColor: "rgba(22, 29, 54, 0.85)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 14,
  },
  inputFocused: {
    borderColor: colors.primaryLight,
    backgroundColor: "rgba(30, 24, 64, 0.9)",
  },
  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(22, 29, 54, 0.85)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 14,
  },
  eyeBtn: {
    paddingHorizontal: 12,
  },
  eyeIcon: {
    fontSize: 16,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 18,
  },
  checkbox: {
    width: 22,
    height: 22,
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
    fontSize: 14,
    fontWeight: "700",
  },
  checkboxLabel: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  submitText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  footerText: {
    color: colors.textDim,
    fontSize: 13,
  },
  signUpLink: {
    color: colors.sliderThumb,
    fontSize: 13,
    fontWeight: "700",
  },
  errorBox: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
    padding: 12,
    borderRadius: 12,
    marginBottom: 14,
  },
  errorText: {
    color: "#f87171",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: "rgba(15, 20, 45, 0.95)",
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  modalEmoji: {
    fontSize: 48,
    marginBottom: 14,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 8,
  },
  modalSubtitle: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  modalProceedBtn: {
    width: "100%",
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  modalProceedText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
});
