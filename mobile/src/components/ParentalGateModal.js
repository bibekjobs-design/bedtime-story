import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  Alert,
} from "react-native";
import { colors } from "../theme/colors";

export default function ParentalGateModal({ visible, onCancel, onSuccess }) {
  const [num1, setNum1] = useState(7);
  const [num2, setNum2] = useState(8);
  const [answer, setAnswer] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (visible) {
      // Generate a dynamic multiplication challenge
      const a = Math.floor(Math.random() * 6) + 4; // 4 - 9
      const b = Math.floor(Math.random() * 6) + 4; // 4 - 9
      setNum1(a);
      setNum2(b);
      setAnswer("");
      setErrorMsg("");
    }
  }, [visible]);

  function handleVerify() {
    const expected = num1 * num2;
    if (parseInt(answer.trim(), 10) === expected) {
      setErrorMsg("");
      onSuccess();
    } else {
      setErrorMsg("Incorrect answer. Grown-ups only!");
      setAnswer("");
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.badge}>🛡️ Grown-ups Only</Text>
          <Text style={styles.title}>Parental Gate</Text>
          <Text style={styles.subtitle}>
            Please solve this math question to enter adult settings:
          </Text>

          <View style={styles.challengeBox}>
            <Text style={styles.challengeText}>
              What is {num1} × {num2} ?
            </Text>
          </View>

          {errorMsg ? (
            <Text style={{ color: "#ef4444", fontSize: 13, marginBottom: 12, fontWeight: "600" }}>
              ⚠️ {errorMsg}
            </Text>
          ) : null}

          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            placeholder="Your answer"
            placeholderTextColor={colors.textDim}
            value={answer}
            onChangeText={(val) => {
              setAnswer(val);
              if (errorMsg) setErrorMsg("");
            }}
            onSubmitEditing={handleVerify}
            returnKeyType="done"
            autoFocus
          />

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.verifyBtn} onPress={handleVerify}>
              <Text style={styles.verifyText}>Verify</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 26,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  badge: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 6,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    marginBottom: 18,
    lineHeight: 18,
  },
  challengeBox: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 14,
    marginBottom: 16,
  },
  challengeText: {
    color: colors.sliderThumb,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 1,
  },
  input: {
    width: "100%",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 14,
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    paddingVertical: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
  },
  cancelText: {
    color: colors.textMuted,
    fontWeight: "600",
  },
  verifyBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: "center",
  },
  verifyText: {
    color: "#fff",
    fontWeight: "700",
  },
});
