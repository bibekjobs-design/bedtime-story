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
  Platform,
} from "react-native";
import { colors } from "../theme/colors";
import { api } from "../api/client";

export default function ResetPasswordScreen({ initialToken = "", onResetSuccess, onGoToLogin, onBack }) {
  const [token, setToken] = useState(initialToken);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  async function handleResetPassword() {
    setError(null);
    if (!token.trim()) {
      setError("Reset token is required.");
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setLoading(true);
      await api.resetPassword({
        token: token.trim(),
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setSuccess(true);
    } catch (err) {
      setError(err?.message || "Invalid or expired reset token.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.backButton} onPress={onBack || onGoToLogin}>
        <Text style={styles.backText}>← Back to Log In</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.badge}>Account Security</Text>
        <Text style={styles.title}>Set New Password 🔑</Text>
        <Text style={styles.subtitle}>
          Create a strong password for your Bedtime Story account.
        </Text>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
        </View>
      ) : null}

      {success ? (
        <View style={styles.successCard}>
          <Text style={styles.successEmoji}>🎉</Text>
          <Text style={styles.successTitle}>Password Updated!</Text>
          <Text style={styles.successDesc}>
            Your password was successfully reset. You can now log in with your new credentials.
          </Text>
          <TouchableOpacity style={styles.submitBtn} onPress={onGoToLogin}>
            <Text style={styles.submitText}>Proceed to Log In</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.formCard}>
          {!initialToken && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Reset Token</Text>
              <TextInput
                style={styles.input}
                placeholder="Paste reset token here"
                placeholderTextColor={colors.textDim}
                value={token}
                onChangeText={setToken}
                autoCapitalize="none"
              />
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>New Password (min 8 chars)</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder="••••••••"
                placeholderTextColor={colors.textDim}
                secureTextEntry={!showPassword}
                value={newPassword}
                onChangeText={setNewPassword}
              />
              <TouchableOpacity
                style={styles.eyeBtn}
                onPress={() => setShowPassword(!showPassword)}
              >
                <Text style={styles.eyeText}>{showPassword ? "🙈" : "👁️"}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Confirm New Password</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={colors.textDim}
              secureTextEntry={!showPassword}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
            onPress={handleResetPassword}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>Update Password & Log In</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
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
    paddingTop: 40,
    maxWidth: 440,
    width: "100%",
    alignSelf: "center",
  },
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    marginBottom: 20,
  },
  backText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  header: {
    marginBottom: 24,
  },
  badge: {
    color: colors.sliderThumb,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  formCard: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.25)",
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
  },
  input: {
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 14,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    paddingRight: 10,
  },
  eyeBtn: {
    padding: 6,
  },
  eyeText: {
    fontSize: 16,
  },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
  },
  errorBox: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: "#f87171",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  successCard: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
    alignItems: "center",
  },
  successEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  successTitle: {
    color: "#34d399",
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 8,
  },
  successDesc: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginBottom: 20,
  },
});
