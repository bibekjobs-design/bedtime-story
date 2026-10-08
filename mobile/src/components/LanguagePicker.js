import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

// Narration languages. `wordFactor` mirrors the backend (story_service.SUPPORTED_LANGUAGES):
// words in these languages take longer to speak, so the per-plan word cap is scaled.
export const LANGUAGES = [
  { code: "en", label: "English", native: "English", wordFactor: 1.0 },
  { code: "hi", label: "Hindi", native: "हिन्दी", wordFactor: 1.0 },
  { code: "bn", label: "Bengali", native: "বাংলা", wordFactor: 0.9 },
  { code: "kn", label: "Kannada", native: "ಕನ್ನಡ", wordFactor: 0.8 },
  { code: "te", label: "Telugu", native: "తెలుగు", wordFactor: 0.85 },
];

export function languageByCode(code) {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}

// Turns a story card (possibly shown in a chosen language) into the data the
// Player needs. Original-language stories play as before; a translated view
// loads that language version (already saved by the admin, no new cost).
export async function openStoryInView(api, story) {
  const code = story.language_code;
  const orig = (story.language_codes || [])[0];
  if (code && orig && code !== orig) {
    const committed = await api.commitStory(story.id, "standard", "luna", "us", code);
    return { ...story, ...committed, language_code: code, origin: "library" };
  }
  if (story.has_audio && story.audio_url && story.full_text) {
    return { ...story, language_code: undefined, origin: "library" };
  }
  const committed = await api.commitStory(story.id, "standard", "luna");
  return { ...story, ...committed, language_code: undefined, origin: "library" };
}

// Inline dropdown (no nested Modal, so it also works inside the admin modal).
export default function LanguagePicker({ value, onChange, disabled = false, style }) {
  const [open, setOpen] = useState(false);
  const current = languageByCode(value);

  return (
    <View style={style}>
      <TouchableOpacity
        style={[styles.button, disabled && { opacity: 0.5 }]}
        onPress={() => !disabled && setOpen((o) => !o)}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>
          🌐 {current.label}
          {current.code !== "en" ? `  ·  ${current.native}` : ""}
        </Text>
        <Text style={styles.caret}>{open ? "▴" : "▾"}</Text>
      </TouchableOpacity>

      {open && (
        <View style={styles.list}>
          {LANGUAGES.map((l) => {
            const active = l.code === value;
            return (
              <TouchableOpacity
                key={l.code}
                style={[styles.item, active && styles.itemActive]}
                onPress={() => {
                  onChange(l.code);
                  setOpen(false);
                }}
              >
                <Text style={[styles.itemText, active && styles.itemTextActive]}>
                  {l.label}
                  {l.code !== "en" ? `  ·  ${l.native}` : ""}
                </Text>
                {active ? <Text style={styles.tick}>✓</Text> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const GOLD = "#f5a623";

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#0b0c12",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  caret: { color: GOLD, fontSize: 14, fontWeight: "800" },
  list: {
    marginTop: 6,
    backgroundColor: "#0b0c12",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    overflow: "hidden",
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  itemActive: { backgroundColor: "rgba(245,166,35,0.12)" },
  itemText: { color: "#cfd3e4", fontSize: 14, fontWeight: "600" },
  itemTextActive: { color: GOLD, fontWeight: "800" },
  tick: { color: GOLD, fontWeight: "800" },
});
