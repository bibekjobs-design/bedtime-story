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
import SLogo from "../components/SLogo";

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
      {/* S logo + title (look only) */}
      <View style={styles.hero}>
        <SLogo size="lg" />
      </View>

      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>
          {activeTab === "login" ? "Welcome back" : "Create your account"}
        </Text>
        <Text style={styles.sheetSubtitle}>
          {activeTab === "login"
            ? "Log in to continue your stories"
            : "Start your bedtime story journey"}
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
                placeholderTextColor="#6b6e80"
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
                  placeholderTextColor="#6b6e80"
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
                  <Text style={styles.eyeIcon}>{showPassword ? "HIDE" : "SHOW"}</Text>
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
                placeholderTextColor="#6b6e80"
                value={fullName}
                onChangeText={setFullName}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email Address</Text>
              <TextInput
                style={styles.input}
                placeholder="parent@example.com"
                placeholderTextColor="#6b6e80"
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
                placeholderTextColor="#6b6e80"
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
                  placeholderTextColor="#6b6e80"
                  secureTextEntry={!showRegPassword}
                  value={regPassword}
                  onChangeText={setRegPassword}
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowRegPassword(!showRegPassword)}
                >
                  <Text style={styles.eyeIcon}>{showRegPassword ? "HIDE" : "SHOW"}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Confirm Password</Text>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="Repeat password"
                  placeholderTextColor="#6b6e80"
                  secureTextEntry={!showConfirmPassword}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  <Text style={styles.eyeIcon}>{showConfirmPassword ? "HIDE" : "SHOW"}</Text>
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

const RED = "#e50914";
const GOLD = "#f5a623"; // buttons (same as the rest of the app)
const WHITE = "#ffffff";
const LINE = "rgba(255,255,255,0.12)";
const HOME_BG = "#05060c"; // same ground as the Home screen
const FIELD = "#14151d";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: HOME_BG,
  },
  content: {
    padding: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  hero: {
    alignItems: "center",
    marginBottom: 16,
  },
  sheet: {},
  sheetTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 6,
  },
  sheetSubtitle: {
    color: "#8d90a0",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    marginBottom: 20,
  },

  tabsRow: {
    flexDirection: "row",
    backgroundColor: "#12131b",
    borderRadius: 14,
    padding: 3,
    marginBottom: 20,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 11,
    alignItems: "center",
  },
  tabBtnActive: {
    backgroundColor: "#232430",
  },
  tabText: {
    color: "#8d90a0",
    fontSize: 14,
    fontWeight: "700",
  },
  tabTextActive: {
    color: "#fff",
  },

  form: {},
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    color: "#8d90a0",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  forgotLink: {
    color: WHITE,
    fontSize: 13,
    fontWeight: "700",
  },
  input: {
    backgroundColor: FIELD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: LINE,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: "#fff",
    fontSize: 15,
  },
  inputFocused: {
    borderColor: "#ffffff",
  },
  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: FIELD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: LINE,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: "#fff",
    fontSize: 15,
  },
  eyeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  eyeIcon: {
    color: WHITE,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
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
    borderColor: "#6b6e80",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: FIELD,
    borderColor: WHITE,
  },
  checkmark: {
    color: WHITE,
    fontSize: 14,
    fontWeight: "700",
  },
  checkboxLabel: {
    flex: 1,
    color: "#8d90a0",
    fontSize: 13,
    lineHeight: 18,
  },
  submitBtn: {
    backgroundColor: FIELD, // same as the email / password fields
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    marginBottom: 18,
  },
  submitText: {
    color: WHITE,
    fontSize: 16,
    fontWeight: "800",
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  footerText: {
    color: "#8d90a0",
    fontSize: 14,
  },
  signUpLink: {
    color: WHITE,
    fontSize: 14,
    fontWeight: "700",
  },
  errorBox: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  errorText: {
    color: "#f87171",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: FIELD,
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    borderWidth: 1,
    borderColor: LINE,
  },
  modalEmoji: {
    fontSize: 48,
    marginBottom: 14,
  },
  modalTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 8,
  },
  modalSubtitle: {
    color: "#9a9db0",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  modalProceedBtn: {
    width: "100%",
    backgroundColor: "#232430",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  modalProceedText: {
    color: WHITE,
    fontSize: 15,
    fontWeight: "700",
  },
});
