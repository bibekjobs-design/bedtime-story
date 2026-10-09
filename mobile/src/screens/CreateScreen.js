import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  TextInput,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { api } from "../api/client";
import { colors } from "../theme/colors";
import AsyncStorage from "@react-native-async-storage/async-storage";
import SafeAudio from "../utils/safeAudio";
import StoryLoadingOverlay from "../components/StoryLoadingOverlay";
import LanguagePicker, { languageByCode } from "../components/LanguagePicker";

export default function CreateScreen({
  activeProfile,
  voiceClones = [],
  isPremium = false,
  subscriptionTier = null,
  onPlayStory,
  onGoToHome,
  onGoToUpgrade,
}) {
  const isPro = ["premium", "premium_monthly", "premium_annual"].includes(subscriptionTier);
  // "free" here means the free trial specifically - subscriptionTier is
  // undefined/null for a logged-out state, which falls through to the
  // Normal/free-trial 3-min text below (same length either way).
  // Matches the backend caps exactly: story_service.FREE_TIER_TARGET_WORDS /
  // NORMAL_TIER_TARGET_WORDS (free trial + Normal, ~3 min) vs
  // PRO_TIER_TARGET_WORDS (Pro, ~5 min), and
  // voice_clone_service.CLONED_VOICE_CHAR_LIMIT (~3 min cloned narration).
  const [languageCode, setLanguageCode] = useState("en"); // en | hi | bn | kn | te
  const langInfo = languageByCode(languageCode);
  const baseWords = isPro ? 675 : 405;
  const shownWords = Math.round((baseWords * langInfo.wordFactor) / 5) * 5;
  const narratorLengthText = isPro
    ? `Your Super plan narrates up to 5 minutes (~${shownWords} words) per story - longer files get trimmed to fit.`
    : `Narrations run up to about 3 minutes (~${shownWords} words) per story - longer files get trimmed to fit.`;
  const cloneLengthText = "Parent voice clones are limited to about 3 minutes (~2,400 characters) per story, regardless of file length.";
  const [selectedFile, setSelectedFile] = useState(null);

  // PDF-only: read the whole document, or just a specific page range (e.g.
  // one chapter out of a big storybook PDF). The final story length is
  // still capped by the plan's word limit either way - this only changes
  // which pages of the PDF get read before that cap is applied.
  const [pdfReadMode, setPdfReadMode] = useState("normal"); // 'normal' | 'range'
  const [pdfPageFrom, setPdfPageFrom] = useState("");
  const [pdfPageTo, setPdfPageTo] = useState("");

  const [voiceSource, setVoiceSource] = useState("narrator"); // 'narrator' | 'clone'

  const [narratorVoices, setNarratorVoices] = useState([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState("luna");
  const [selectedCloneId, setSelectedCloneId] = useState(null);

  // English accent/locale (US/UK/India/Australia) for whichever narrator
  // persona is picked above - same Google TTS voice, different locale.
  const [accents, setAccents] = useState([]);
  const [selectedAccentId, setSelectedAccentId] = useState("us");

  const [usageInfo, setUsageInfo] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const [previewingVoiceId, setPreviewingVoiceId] = useState(null);

  const handlePreviewVoice = async (voice) => {
    if (previewingVoiceId === voice.id) {
      if (Platform.OS === "web" && window.currentAudioPreview) {
        window.currentAudioPreview.pause();
        window.currentAudioPreview = null;
      } else {
        await SafeAudio.stopPreview().catch(() => {});
      }
      setPreviewingVoiceId(null);
    } else {
      setPreviewingVoiceId(voice.id);
      try {
        const res = await api.getVoicePreview(voice.id, selectedAccentId);
        if (res && res.preview_url) {
          if (Platform.OS === "web") {
            if (window.currentAudioPreview) window.currentAudioPreview.pause();
            const audio = new Audio(res.preview_url);
            window.currentAudioPreview = audio;
            audio.onended = () => setPreviewingVoiceId(null);
            audio.play().catch(() => setPreviewingVoiceId(null));
          } else {
            await SafeAudio.playPreview(res.preview_url);
            setPreviewingVoiceId(null);
          }
        } else {
          setPreviewingVoiceId(null);
        }
      } catch (e) {
        setPreviewingVoiceId(null);
      }
    }
  };

  const [previewingCloneId, setPreviewingCloneId] = useState(null);

  const handlePreviewClone = async (clone) => {
    if (previewingCloneId === clone.id) {
      if (Platform.OS === "web" && window.currentAudioPreview) {
        window.currentAudioPreview.pause();
        window.currentAudioPreview = null;
      } else {
        await SafeAudio.stopPreview().catch(() => {});
      }
      setPreviewingCloneId(null);
    } else {
      setPreviewingCloneId(clone.id);
      try {
        const url = clone.sample_audio_url;
        if (url) {
          if (Platform.OS === "web") {
            if (window.currentAudioPreview) window.currentAudioPreview.pause();
            const audio = new Audio(url);
            window.currentAudioPreview = audio;
            audio.onended = () => setPreviewingCloneId(null);
            audio.play().catch(() => setPreviewingCloneId(null));
          } else {
            await SafeAudio.playPreview(url);
            setPreviewingCloneId(null);
          }
        } else {
          setPreviewingCloneId(null);
        }
      } catch (e) {
        setPreviewingCloneId(null);
      }
    }
  };

  useEffect(() => {
    loadVoices();
    loadUsage();
  }, []);

  async function loadVoices() {
    try {
      const list = await api.getNarratorVoices();
      if (list && list.length > 0) setNarratorVoices(list);
    } catch (e) {}
    try {
      const accentList = await api.getAccents();
      if (accentList && accentList.length > 0) setAccents(accentList);
    } catch (e) {}
  }

  async function loadUsage() {
    try {
      const u = await api.getStoryUsage();
      setUsageInfo(u);
    } catch (e) {}
  }

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf",
          "text/plain",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
        ],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setSelectedFile(result.assets[0]);
        // A fresh file pick starts back at "Normal Read" - the range from a
        // previous PDF wouldn't necessarily make sense for a new one.
        setPdfReadMode("normal");
        setPdfPageFrom("");
        setPdfPageTo("");
      }
    } catch (e) {}
  };

  const isPdfFile = (f) =>
    !!f && ((f.mimeType || "").toLowerCase() === "application/pdf" || /\.pdf$/i.test(f.name || ""));

  const handleGenerate = async () => {
    if (!selectedFile) {
      setError("Please select a file.");
      return;
    }
    if (subscriptionTier === "normal_monthly" || subscriptionTier === "pro_monthly") {
      setError("Creating stories is a Super feature. Upgrade to Super (₹321/month) to create 5 AI-narrated stories a month.");
      if (onGoToUpgrade) onGoToUpgrade();
      return;
    }
    if (voiceSource === "clone" && !isPremium) {
      if (onGoToUpgrade) onGoToUpgrade();
      return;
    }
    if (voiceSource === "clone" && voiceClones.length === 0) {
      setError("No voice clones available. Create one in Settings.");
      return;
    }

    const usingPageRange = isPdfFile(selectedFile) && pdfReadMode === "range";
    let pageFromNum = null;
    let pageToNum = null;
    if (usingPageRange) {
      pageFromNum = parseInt(pdfPageFrom, 10);
      pageToNum = parseInt(pdfPageTo, 10);
      if (!pageFromNum || !pageToNum || pageFromNum < 1 || pageToNum < 1) {
        setError("Please enter a valid 'From page' and 'To page' (e.g. 3 to 7).");
        return;
      }
      if (pageFromNum > pageToNum) {
        setError(`'From page' (${pageFromNum}) can't be after 'To page' (${pageToNum}).`);
        return;
      }
    }

    setGenerating(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("input_mode", "file");
      formData.append("age_group_id", String(activeProfile?.age_group_id || 1));
      formData.append("voice_id", String(selectedVoiceId));
      formData.append("accent_id", String(selectedAccentId));
      formData.append("language_code", String(voiceSource === "clone" ? "en" : languageCode));
      if (usingPageRange) {
        formData.append("pdf_page_from", String(pageFromNum));
        formData.append("pdf_page_to", String(pageToNum));
      }

      if (Platform.OS === "web") {
        const resp = await fetch(selectedFile.uri);
        const blob = await resp.blob();
        formData.append("file", blob, selectedFile.name || "document.pdf");
      } else {
        formData.append("file", {
          uri: selectedFile.uri,
          name: selectedFile.name,
          type: selectedFile.mimeType || "application/pdf",
        });
      }

      let data = await api.convertToStory(formData);

      // If the user picked a cloned parent voice, re-narrate the generated
      // story with that clone instead of the selected premade narrator.
      if (voiceSource === "clone") {
        const cloneId = selectedCloneId || voiceClones[0]?.id;
        const cloneMeta = voiceClones.find((c) => c.id === cloneId);
        const storyTextId = data.story_text_id || data.id;
        const clonedAudioRes = await api.narrateCloned(
          storyTextId,
          activeProfile?.id,
          cloneId
        );

        data = {
          ...data,
          audio_url: clonedAudioRes.audio_url,
          audio_s3_key: clonedAudioRes.audio_s3_key,
          duration_seconds: clonedAudioRes.duration_seconds,
          is_cloned_voice: true,
          // Tags used by the History screen to file this under "Cloned Voice"
          // and to show the parent's clone name instead of a narrator name.
          origin: "cloned",
          narrator_icon: "🎙️",
          narrator_name: cloneMeta?.display_name || "Parent Voice",
        };
      } else {
        // Tags used by the History screen to file this under "AI Voice".
        data = { ...data, origin: "ai" };
      }

      if (data.truncated && data.notice) {
        notifyStoryTrimmed(data.notice);
      }

      onPlayStory(data);
    } catch (e) {
      const msg = e.message || "Failed to generate story.";
      // Backend sends this wording when the free monthly quota is used up,
      // or when a Premium-only feature (e.g. voice cloning) was attempted -
      // send the parent straight to checkout instead of a dead-end error.
      const needsUpgrade = /upgrade|premium|monthly limit reached/i.test(msg);
      if (needsUpgrade && onGoToUpgrade) {
        onGoToUpgrade();
      } else {
        setError(msg);
      }
    } finally {
      setGenerating(false);
      loadUsage();
    }
  };

  const notifyStoryTrimmed = (message) => {
    if (Platform.OS === "web") {
      window.alert(message);
    } else {
      Alert.alert("Story Trimmed to 5 Minutes", message);
    }
  };

  const newStoryRemaining = usageInfo?.new_story_remaining ?? 10;
  const cloneRemaining = usageInfo?.voice_clone_remaining ?? 2;
  const isLocked = subscriptionTier === "normal_monthly" || subscriptionTier === "pro_monthly";
  const voiceTileColors = ["#6d3b8e", "#2f6f8f", "#8f4a2f", "#2f8f6a", "#8f2f5a", "#4a4f9f"];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Create a story</Text>
        <Text style={styles.subtitle}>Turn any PDF, TXT or DOCX into a bedtime story.</Text>

        <View style={styles.limitsRow}>
          <View style={styles.limitBadge}>
            <Text style={styles.limitText}>🌟 {newStoryRemaining} AI stories left</Text>
          </View>
          <View style={styles.limitBadge}>
            <Text style={styles.limitText}>🎙️ {cloneRemaining} voice clones left</Text>
          </View>
        </View>

        {isLocked && (
          <View style={styles.lockBox}>
            <Text style={styles.lockText}>
              🔒 Your plan is for listening. Creating AI-narrated stories is part of Super.
            </Text>
            <TouchableOpacity style={styles.upsellBtn} onPress={onGoToUpgrade}>
              <Text style={styles.upsellBtnText}>Upgrade to Super (₹321/month)</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={[isLocked && { opacity: 0.45 }]} pointerEvents={isLocked ? "none" : "auto"}>
          {/* File */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>📄 Your file</Text>
            <TouchableOpacity style={styles.uploadBox} onPress={handlePickFile}>
              {selectedFile ? (
                <Text style={styles.uploadTextOn} numberOfLines={2}>✅ {selectedFile.name}</Text>
              ) : (
                <Text style={styles.uploadText}>Tap to pick PDF / TXT / DOCX</Text>
              )}
            </TouchableOpacity>

            {isPdfFile(selectedFile) ? (
              <View style={styles.pdfRangeBox}>
                <View style={styles.pdfModeToggle}>
                  <TouchableOpacity
                    style={[styles.pdfModeOpt, pdfReadMode === "normal" && styles.pdfModeOptActive]}
                    onPress={() => setPdfReadMode("normal")}
                  >
                    <Text style={[styles.pdfModeText, pdfReadMode === "normal" && styles.pdfModeTextActive]}>
                      Normal Read
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.pdfModeOpt, pdfReadMode === "range" && styles.pdfModeOptActive]}
                    onPress={() => setPdfReadMode("range")}
                  >
                    <Text style={[styles.pdfModeText, pdfReadMode === "range" && styles.pdfModeTextActive]}>
                      Page Range
                    </Text>
                  </TouchableOpacity>
                </View>

                {pdfReadMode === "range" && (
                  <View style={styles.pdfPageInputsRow}>
                    <View style={styles.pdfPageInputWrap}>
                      <Text style={styles.pdfPageInputLabel}>From page</Text>
                      <TextInput
                        style={styles.pdfPageInput}
                        placeholder="1"
                        placeholderTextColor="rgba(255,255,255,0.4)"
                        keyboardType="number-pad"
                        value={pdfPageFrom}
                        onChangeText={setPdfPageFrom}
                      />
                    </View>
                    <Text style={styles.pdfPageInputDash}>—</Text>
                    <View style={styles.pdfPageInputWrap}>
                      <Text style={styles.pdfPageInputLabel}>To page</Text>
                      <TextInput
                        style={styles.pdfPageInput}
                        placeholder="5"
                        placeholderTextColor="rgba(255,255,255,0.4)"
                        keyboardType="number-pad"
                        value={pdfPageTo}
                        onChangeText={setPdfPageTo}
                      />
                    </View>
                  </View>
                )}
                <Text style={styles.hintText}>
                  Read the whole PDF, or pick just one chapter (e.g. pages 3–7).
                </Text>
              </View>
            ) : null}

            <View style={styles.limitBox}>
              <Text style={styles.limitBoxTitle}>📖 Reading a PDF?</Text>
              <Text style={styles.limitBoxText}>
                You can read the whole PDF or just one chapter. After you pick a PDF, choose "Page Range" and enter the From and To page (for example pages 3 to 7). The story length limit below still applies to the pages you choose.
              </Text>
            </View>

            <View style={styles.limitBox}>
              <Text style={styles.limitBoxTitle}>⏱ Story length limit</Text>
              <Text style={styles.limitBoxText}>
                {voiceSource === "clone" ? cloneLengthText : narratorLengthText}
              </Text>
              {voiceSource === "clone" ? (
                <Text style={[styles.limitBoxText, { marginTop: 8, color: "#ffd479" }]}>
                  ⏳ Stories made in your voice are deleted automatically 10 days after they are created. Open History and tap ⬇️ on the story to save it to your device before then.
                </Text>
              ) : null}
            </View>
          </View>

          {/* Voice */}
          <View style={styles.card}>
            <View style={styles.voiceHeaderRow}>
              <Text style={[styles.cardTitle, { marginBottom: 0 }]}>🎤 Voice</Text>
              <View style={styles.voiceToggle}>
                <TouchableOpacity
                  style={[styles.voiceToggleOpt, voiceSource === "narrator" && styles.voiceToggleOptActive]}
                  onPress={() => setVoiceSource("narrator")}
                >
                  <Text style={[styles.voiceToggleText, voiceSource === "narrator" && styles.voiceToggleTextActive]}>
                    Narrator
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.voiceToggleOpt, voiceSource === "clone" && styles.voiceToggleOptActive]}
                  onPress={() => setVoiceSource("clone")}
                >
                  <Text style={[styles.voiceToggleText, voiceSource === "clone" && styles.voiceToggleTextActive]}>
                    My voice
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {voiceSource === "narrator" ? (
              <>
                <Text style={styles.accentLabel}>Story language</Text>
                <LanguagePicker value={languageCode} onChange={setLanguageCode} style={{ marginBottom: 14 }} />
                {languageCode !== "en" && (
                  <Text style={styles.hintText}>
                    Any file is translated into {langInfo.label} first, then narrated.
                  </Text>
                )}
                {narratorVoices.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.voiceScroll}>
                    {narratorVoices.map((voice, idx) => {
                      const active = selectedVoiceId === voice.id;
                      return (
                        <View key={voice.id} style={styles.voiceItemWrapper}>
                          <TouchableOpacity
                            style={[
                              styles.voiceTile,
                              { backgroundColor: voiceTileColors[idx % voiceTileColors.length] },
                              active && styles.voiceTileActive,
                            ]}
                            onPress={() => setSelectedVoiceId(voice.id)}
                          >
                            <Text style={styles.voiceIcon}>{voice.icon || "👤"}</Text>
                          </TouchableOpacity>
                          <Text style={[styles.voiceName, active && styles.voiceNameActive]} numberOfLines={1}>
                            {voice.name}
                          </Text>
                          <TouchableOpacity style={styles.previewBtn} onPress={() => handlePreviewVoice(voice)}>
                            <Text style={styles.previewBtnText}>
                              {previewingVoiceId === voice.id ? "⏸️" : "▶️"}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </ScrollView>
                )}
                {languageCode === "en" && accents.length > 0 && (
                  <>
                    <Text style={styles.accentLabel}>Accent</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.accentScroll}>
                      {accents.map((accent) => (
                        <TouchableOpacity
                          key={accent.id}
                          style={[styles.accentChip, selectedAccentId === accent.id && styles.accentChipActive]}
                          onPress={() => setSelectedAccentId(accent.id)}
                        >
                          <Text style={styles.accentChipIcon}>{accent.flag || "🌍"}</Text>
                          <Text style={[styles.accentChipText, selectedAccentId === accent.id && styles.accentChipTextActive]}>
                            {accent.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                )}
              </>
            ) : !isPremium ? (
              <View style={styles.upsellBox}>
                <Text style={styles.upsellText}>🔒 Narrating in your own voice is a Super feature.</Text>
                <TouchableOpacity style={styles.upsellBtn} onPress={onGoToUpgrade}>
                  <Text style={styles.upsellBtnText}>Upgrade to Super (₹321/month)</Text>
                </TouchableOpacity>
              </View>
            ) : voiceClones.length === 0 ? (
              <Text style={styles.errorText}>You don't have any voice clones. Add one in Settings.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.voiceScroll}>
                {voiceClones.map((clone, idx) => {
                  const isActive = (selectedCloneId || voiceClones[0]?.id) === clone.id;
                  return (
                    <View key={clone.id} style={styles.voiceItemWrapper}>
                      <TouchableOpacity
                        style={[
                          styles.voiceTile,
                          { backgroundColor: voiceTileColors[idx % voiceTileColors.length] },
                          isActive && styles.voiceTileActive,
                        ]}
                        onPress={() => setSelectedCloneId(clone.id)}
                      >
                        <Text style={styles.voiceIcon}>👤</Text>
                      </TouchableOpacity>
                      <Text style={[styles.voiceName, isActive && styles.voiceNameActive]} numberOfLines={1}>
                        {clone.display_name || "Clone"}
                      </Text>
                      <TouchableOpacity style={styles.previewBtn} onPress={() => handlePreviewClone(clone)}>
                        <Text style={styles.previewBtnText}>
                          {previewingCloneId === clone.id ? "⏸️" : "▶️"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.generateBtn, (generating || isLocked) && { opacity: 0.6 }]}
          onPress={handleGenerate}
          disabled={generating}
        >
          {generating ? (
            <ActivityIndicator color="#1a1230" />
          ) : (
            <Text style={styles.generateBtnText}>✨ Create story</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
      <StoryLoadingOverlay
        visible={generating}
        mode={voiceSource === "clone" ? "clone" : "narrator"}
        voiceName={
          voiceSource === "clone"
            ? voiceClones.find((c) => c.id === (selectedCloneId || voiceClones[0]?.id))?.display_name
            : narratorVoices.find((v) => v.id === selectedVoiceId)?.name
        }
      />
    </View>
  );
}

const GOLD = "#f5a623";
const CARD = "#14151d";
const LINE = "rgba(255,255,255,0.08)";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#05060c" },
  content: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 140 },
  title: { color: "#fff", fontSize: 24, fontWeight: "800" },
  subtitle: { color: "#8f94ab", fontSize: 13, marginTop: 4, marginBottom: 14 },
  limitsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  limitBadge: {
    backgroundColor: CARD,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: LINE,
  },
  limitText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  card: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },
  cardTitle: { color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 12 },
  uploadBox: {
    backgroundColor: "#0b0c12",
    borderRadius: 14,
    paddingVertical: 26,
    paddingHorizontal: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    borderStyle: "dashed",
  },
  uploadText: { color: "#9ba1ba", fontWeight: "600" },
  uploadTextOn: { color: GOLD, fontWeight: "700", textAlign: "center" },
  hintText: { color: "#8f94ab", fontSize: 12, lineHeight: 17, marginTop: 10 },
  pdfRangeBox: { marginTop: 14 },
  pdfModeToggle: { flexDirection: "row", backgroundColor: "#0b0c12", borderRadius: 14, padding: 4 },
  pdfModeOpt: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center" },
  pdfModeOptActive: { backgroundColor: GOLD },
  pdfModeText: { color: "#9ba1ba", fontSize: 12.5, fontWeight: "700" },
  pdfModeTextActive: { color: "#1a1230" },
  pdfPageInputsRow: { flexDirection: "row", alignItems: "flex-end", gap: 10, marginTop: 12 },
  pdfPageInputWrap: { flex: 1 },
  pdfPageInputLabel: { color: "#9ba1ba", fontSize: 11, fontWeight: "600", marginBottom: 6 },
  pdfPageInput: {
    backgroundColor: "#0b0c12",
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#ffffff",
    fontSize: 14,
    textAlign: "center",
  },
  pdfPageInputDash: { color: "#9ba1ba", fontSize: 16, marginBottom: 10 },
  limitBox: {
    marginTop: 14,
    backgroundColor: "rgba(245,166,35,0.10)",
    borderWidth: 1,
    borderColor: "rgba(245,166,35,0.35)",
    borderRadius: 12,
    padding: 12,
  },
  limitBoxTitle: { color: GOLD, fontSize: 12.5, fontWeight: "800", marginBottom: 4 },
  limitBoxText: { color: "#fff", fontSize: 12.5, lineHeight: 18, fontWeight: "600" },
  voiceHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  voiceToggle: { flexDirection: "row", backgroundColor: "#0b0c12", borderRadius: 12, padding: 3 },
  voiceToggleOpt: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9 },
  voiceToggleOptActive: { backgroundColor: GOLD },
  voiceToggleText: { color: "#9ba1ba", fontWeight: "700", fontSize: 12 },
  voiceToggleTextActive: { color: "#1a1230" },
  voiceScroll: { flexDirection: "row" },
  voiceItemWrapper: { alignItems: "center", marginRight: 14, width: 72 },
  voiceTile: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
    opacity: 0.75,
  },
  voiceTileActive: { borderColor: GOLD, opacity: 1 },
  voiceIcon: { fontSize: 28 },
  voiceName: { color: "#cfd3e4", fontWeight: "600", fontSize: 12, marginTop: 6, marginBottom: 6 },
  voiceNameActive: { color: GOLD },
  previewBtn: {
    backgroundColor: "#0b0c12",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: LINE,
  },
  previewBtnText: { fontSize: 12 },
  accentLabel: {
    color: "#9ba1ba",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 8,
  },
  accentScroll: { flexDirection: "row" },
  accentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: "#0b0c12",
    borderWidth: 1,
    borderColor: LINE,
    marginRight: 10,
  },
  accentChipActive: { backgroundColor: GOLD, borderColor: GOLD },
  accentChipIcon: { fontSize: 14 },
  accentChipText: { color: "#d0d4e3", fontSize: 12, fontWeight: "600" },
  accentChipTextActive: { color: "#1a1230", fontWeight: "800" },
  generateBtn: {
    backgroundColor: GOLD,
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
    marginTop: 4,
  },
  generateBtnText: { color: "#1a1230", fontSize: 17, fontWeight: "800" },
  errorText: { color: "#ff6b6d", marginBottom: 12, textAlign: "center", fontWeight: "600" },
  lockBox: {
    backgroundColor: "rgba(245,166,35,0.10)",
    borderWidth: 1,
    borderColor: "rgba(245,166,35,0.35)",
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    marginBottom: 14,
  },
  lockText: { color: "#fff", fontWeight: "600", textAlign: "center", marginBottom: 12, lineHeight: 19 },
  upsellBox: { alignItems: "center", paddingVertical: 10 },
  upsellText: { color: "#9ba1ba", fontWeight: "600", marginBottom: 12, textAlign: "center" },
  upsellBtn: { backgroundColor: GOLD, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20 },
  upsellBtnText: { color: "#1a1230", fontWeight: "800", fontSize: 13 },
});
