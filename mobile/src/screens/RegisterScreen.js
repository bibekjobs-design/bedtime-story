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
} from "react-native";
import { colors } from "../theme/colors";
import { api } from "../api/client";

export default function RegisterScreen({ onRegisterSuccess, onGoToLogin, onBack }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [loading, setLoading] = useState(false);

  const [successModalVisible, setSuccessModalVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleRegister() {
    setErrorMessage("");
    if (!fullName.trim() || !email.trim() || !mobileNumber.trim() || !password || !confirmPassword) {
      setErrorMessage("Please complete all fields to register.");
      return;
    }

    if (password.length < 8) {
      setErrorMessage("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    try {
      setLoading(true);
      await api.register({
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        mobile_number: mobileNumber.trim(),
        password,
        confirm_password: confirmPassword,
        marketing_opt_in: marketingOptIn,
      });

      setSuccessModalVisible(true);
    } catch (err) {
      setErrorMessage(err.message || "Registration failed. Please check your details.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.badge}>New Parent Account</Text>
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>
          Sign up to access personalized stories, multiple child profiles, and offline bedtime playback.
        </Text>
      </View>

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
            value={email}
            onChangeText={setEmail}
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
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowPassword(!showPassword)}
            >
              <Text style={styles.eyeIcon}>{showPassword ? "👁️" : "🙈"}</Text>
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

        {/* Separate marketing opt-in checkbox */}
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
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Create Account</Text>
          )}
        </TouchableOpacity>

        <View style={styles.footerRow}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <TouchableOpacity onPress={onGoToLogin}>
            <Text style={styles.signUpLink}>Log In</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Registration Success Modal */}
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
                onGoToLogin();
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
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    marginBottom: 20,
  },
  backText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  header: {
    marginBottom: 24,
  },
  badge: {
    color: colors.sliderThumb,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 6,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  form: {
    gap: 16,
    backgroundColor: "rgba(15, 20, 45, 0.7)",
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  inputGroup: {},
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
  },
  input: {
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
  eyeBtn: {
    paddingHorizontal: 14,
  },
  eyeIcon: {
    fontSize: 16,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginVertical: 4,
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
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  submitText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 10,
  },
  footerText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  signUpLink: {
    color: colors.sliderThumb,
    fontSize: 14,
    fontWeight: "700",
  },
  errorBox: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
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
