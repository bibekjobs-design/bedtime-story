import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, Modal, TextInput, StyleSheet, Alert, Linking, Share,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from "react-native";
import { api } from "../api/client";

// "Rate STORYLAND" + "Share STORYLAND" - shown under the story rating card.
const FALLBACK_MESSAGE =
  "My child loves bedtime stories on STORYLAND - calming stories narrated in 5 languages, with a 30-day free trial. Try it:";

export default function ShareRateApp() {
  const [showRate, setShowRate] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");

  async function handleShare() {
    if (sharing) return;
    setSharing(true);
    let text = FALLBACK_MESSAGE;
    try {
      const l = await api.getAppLinks();
      text = `${l.share_message || FALLBACK_MESSAGE}${l.share_url ? `\n${l.share_url}` : ""}`;
    } catch (e) {}
    try {
      // Straight to WhatsApp when it is installed ...
      await Linking.openURL(`whatsapp://send?text=${encodeURIComponent(text)}`);
    } catch (e) {
      // ... otherwise the normal share sheet (any app).
      try {
        await Share.share({ message: text });
      } catch (e2) {}
    }
    setSharing(false);
  }

  async function handleSend() {
    if (!stars) { setError("Tap the stars to rate STORYLAND."); return; }
    setSaving(true);
    setError("");
    try {
      const res = await api.sendAppFeedback(stars, comment.trim());
      setShowRate(false);
      setStars(0);
      setComment("");
      if (res && res.ask_store_review && res.play_store_url) {
        Alert.alert("Thank you!", "Glad you like STORYLAND. Would you rate us on Google Play too?", [
          { text: "Not now", style: "cancel" },
          { text: "Rate on Google Play", onPress: () => Linking.openURL(res.play_store_url).catch(() => {}) },
        ]);
      } else {
        Alert.alert("Thank you!", "Your feedback helps us make STORYLAND better.");
      }
    } catch (e) {
      setError(e?.message || "Could not send your rating. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={s.wrap}>
      <TouchableOpacity style={[s.btn, s.rateBtn]} onPress={() => setShowRate(true)}>
        <Text style={s.btnText}>⭐ Rate STORYLAND</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[s.btn, s.shareBtn]} onPress={handleShare} disabled={sharing}>
        {sharing ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>💬 Share on WhatsApp</Text>}
      </TouchableOpacity>

      <Modal visible={showRate} transparent animationType="fade" onRequestClose={() => setShowRate(false)}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={s.card}>
            <Text style={s.title}>Rate STORYLAND</Text>
            <Text style={s.sub}>How are we doing?</Text>
            <View style={s.starsRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity key={n} onPress={() => { setStars(n); setError(""); }} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                  <Text style={[s.star, stars >= n ? s.starOn : s.starOff]}>★</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={s.input}
              placeholder="Tell us more (optional)"
              placeholderTextColor="#8a8aa0"
              value={comment}
              onChangeText={setComment}
              multiline
              maxLength={1000}
            />
            {error ? <Text style={s.err}>{error}</Text> : null}
            <View style={s.actions}>
              <TouchableOpacity style={s.cancel} onPress={() => setShowRate(false)}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.send} onPress={handleSend} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.sendText}>Send</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { width: "100%", flexDirection: "row", gap: 10, marginBottom: 16 },
  btn: { flex: 1, minHeight: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  rateBtn: { backgroundColor: "rgba(255,211,107,0.14)", borderWidth: 1, borderColor: "rgba(255,211,107,0.45)" },
  shareBtn: { backgroundColor: "#1f9d55" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 13, textAlign: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 380, backgroundColor: "#14142a", borderRadius: 20, padding: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  title: { color: "#fff", fontSize: 20, fontWeight: "800", textAlign: "center" },
  sub: { color: "#a8a8c0", fontSize: 13, textAlign: "center", marginTop: 4, marginBottom: 12 },
  starsRow: { flexDirection: "row", justifyContent: "center", gap: 6, marginBottom: 12 },
  star: { fontSize: 40 },
  starOn: { color: "#ffd36b" },
  starOff: { color: "#3a3a58" },
  input: { minHeight: 80, color: "#fff", backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 12, padding: 12, textAlignVertical: "top", fontSize: 14 },
  err: { color: "#ff8a8a", fontSize: 12, marginTop: 8, textAlign: "center" },
  actions: { flexDirection: "row", gap: 10, marginTop: 14 },
  cancel: { flex: 1, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  cancelText: { color: "#fff", fontWeight: "600" },
  send: { flex: 1, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#e50914" },
  sendText: { color: "#fff", fontWeight: "800" },
});
