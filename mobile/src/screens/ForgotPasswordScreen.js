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
} from "react-native";
import { colors } from "../theme/colors";
import { api } from "../api/client";

export default function ForgotPasswordScreen({ onBack, onGoToLogin, onGoToReset }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSendReset() {
    if (!email.trim()) {
      Alert.alert("Required", "Please enter your registered email address.");
      return;
    }

    try {
      setLoading(true);
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      Alert.alert("Error", err.message);
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
        <Text style={styles.badge}>Account Recovery</Text>
        <Text style={styles.title}>Forgot Password?</Text>
        <Text style={styles.subtitle}>
          Enter your registered email and we'll send you a link to reset your password.
        </Text>
      </View>

      {sent ? (
        <View style={styles.successCard}>
          <Text style={styles.successEmoji}>📬</Text>
          <Text style={styles.successTitle}>Check your inbox</Text>
          <Text style={styles.successDesc}>
            If <Text style={{ color: colors.text, fontWeight: "700" }}>{email}</Text> is registered, we've sent instructions to reset your password.
          </Text>
          {onGoToReset && (
            <TouchableOpacity
              style={[styles.backToLoginBtn, { backgroundColor: colors.primary, marginBottom: 8 }]}
              onPress={onGoToReset}
            >
              <Text style={[styles.backToLoginText, { color: "#fff", fontWeight: "800" }]}>
                🔑 Enter Reset Token / Set Password
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.backToLoginBtn} onPress={onGoToLogin}>
            <Text style={styles.backToLoginText}>Return to Log In</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.form}>
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

          <TouchableOpacity
            style={styles.submitBtn}
            onPress={handleSendReset}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>Send Reset Link</Text>
            )}
          </TouchableOpacity>

          {onGoToReset && (
            <TouchableOpacity
              style={{ marginTop: 16, alignItems: "center" }}
              onPress={onGoToReset}
            >
              <Text style={{ color: colors.sliderThumb, fontSize: 13, fontWeight: "600" }}>
                Already have a reset token? Enter it here →
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
    marginBottom: 24,
  },
  backText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  header: {
    marginBottom: 28,
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
    gap: 18,
  },
  inputGroup: {},
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 15,
  },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 10,
  },
  submitText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  successCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 28,
    alignItems: "center",
  },
  successEmoji: {
    fontSize: 48,
    marginBottom: 14,
  },
  successTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
  },
  successDesc: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  backToLoginBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  backToLoginText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
});
