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
  const narratorLengthText = isPro
    ? "Your Pro plan narrates up to 5 minutes (~675 words) per story - longer files get trimmed to fit."
    : "Narrations run up to about 3 minutes (~405 words) per story - longer files get trimmed to fit.";
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
      formData.append("age_group_id", activeProfile?.age_group_id || 1);
      formData.append("voice_id", selectedVoiceId);
      formData.append("accent_id", selectedAccentId);
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

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.titleSerif}>Voice Studio</Text>
        <TouchableOpacity style={styles.homeBtn} onPress={onGoToHome}>
          <Image source={require("../../assets/images/fox.jpg")} style={styles.homeBtnImg} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Limits Display */}
        <View style={styles.limitsRow}>
          <View style={styles.limitBadge}>
            <Text style={styles.limitText}>🌟 {newStoryRemaining} AI Stories Left</Text>
          </View>
          <View style={styles.limitBadge}>
            <Text style={styles.limitText}>🎙️ {cloneRemaining} Voice Clones Left</Text>
          </View>
        </View>

        {/* Upload Area */}
        <View style={styles.glassCard}>
          <Text style={styles.cardTitle}>📄 Upload a PDF, TXT, or DOCX File</Text>
          <TouchableOpacity style={styles.uploadBox} onPress={handlePickFile}>
            {selectedFile ? (
              <Text style={styles.uploadText}>✅ File: {selectedFile.name}</Text>
            ) : (
              <Text style={styles.uploadText}>Tap to pick PDF/TXT/DOCX</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.lengthHintText}>
            ℹ️ For PDFs, you can read the whole file or pick a specific page range (e.g. pages 3-7) -
            handy for a big storybook where you only want one chapter.
          </Text>

          {isPdfFile(selectedFile) && (
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
            </View>
          )}

          <Text style={styles.lengthHintText}>
            ℹ️ {voiceSource === "clone" ? cloneLengthText : narratorLengthText}
          </Text>
        </View>

        {/* Voice Source: pick a premade Narrator or one of your Voice Clones */}
        <View style={styles.glassCard}>
          <View style={styles.voiceHeaderRow}>
            <Text style={[styles.cardTitle, { marginBottom: 0 }]}>🎤 Choose a Narrator</Text>
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
                  Clone
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {voiceSource === "narrator" ? (
            <>
              {narratorVoices.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.voiceScroll}>
                  {narratorVoices.map(voice => (
                    <View key={voice.id} style={styles.voiceItemWrapper}>
                      <TouchableOpacity
                        style={[styles.voiceItem, selectedVoiceId === voice.id && styles.voiceItemActive]}
                        onPress={() => setSelectedVoiceId(voice.id)}
                      >
                        <Text style={styles.voiceIcon}>{voice.icon || "👤"}</Text>
                        <Text style={[styles.voiceName, selectedVoiceId === voice.id && styles.voiceNameActive]}>{voice.name}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.previewBtn}
                        onPress={() => handlePreviewVoice(voice)}
                      >
                        <Text style={styles.previewBtnText}>
                          {previewingVoiceId === voice.id ? "⏸️" : "▶️"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}
              {accents.length > 0 && (
                <>
                  <Text style={styles.accentLabel}>Accent</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.accentScroll}>
                    {accents.map(accent => (
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
              <Text style={styles.upsellText}>
                🔒 Narrating in your own voice is a Pro feature.
              </Text>
              <TouchableOpacity style={styles.upsellBtn} onPress={onGoToUpgrade}>
                <Text style={styles.upsellBtnText}>Upgrade to Pro (₹219/month)</Text>
              </TouchableOpacity>
            </View>
          ) : voiceClones.length === 0 ? (
            <Text style={styles.errorText}>You don't have any voice clones. Add one in Settings.</Text>
          ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.voiceScroll}>
                {voiceClones.map(clone => {
                  const isActive = (selectedCloneId || voiceClones[0]?.id) === clone.id;
                  return (
                    <View key={clone.id} style={styles.voiceItemWrapper}>
                      <TouchableOpacity
                        style={[styles.voiceItem, isActive && styles.voiceItemActive]}
                        onPress={() => setSelectedCloneId(clone.id)}
                      >
                        <Text style={styles.voiceIcon}>👤</Text>
                        <Text style={[styles.voiceName, isActive && styles.voiceNameActive]}>{clone.display_name || "Clone"}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.previewBtn}
                        onPress={() => handlePreviewClone(clone)}
                      >
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

        {error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.generateBtn, generating && {opacity: 0.7}]}
          onPress={handleGenerate}
          disabled={generating}
        >
          {generating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.generateBtnText}>✨ Generate Story</Text>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "transparent",
    paddingTop: 40,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  titleSerif: {
    fontSize: 28,
    fontWeight: "700",
    color: "#ffffff",
    fontFamily: "serif",
  },
  homeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    overflow: "hidden",
  },
  homeBtnImg: {
    width: "100%",
    height: "100%",
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 120,
  },
  limitsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 20,
  },
  limitBadge: {
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  limitText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  glassCard: {
    backgroundColor: "rgba(15, 20, 45, 0.7)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 24,
    padding: 20,
    marginBottom: 20,
  },
  cardTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 15,
  },
  textArea: {
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 16,
    padding: 15,
    color: "#fff",
    height: 100,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  uploadBox: {
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 16,
    padding: 30,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderStyle: "dashed",
  },
  uploadText: {
    color: "#9ba1ba",
    fontWeight: "600",
  },
  lengthHintText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 10,
  },
  pdfRangeBox: {
    marginTop: 14,
  },
  pdfModeToggle: {
    flexDirection: "row",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 14,
    padding: 4,
  },
  pdfModeOpt: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: "center",
  },
  pdfModeOptActive: {
    backgroundColor: "rgba(245, 166, 35, 0.25)",
  },
  pdfModeText: {
    color: "#9ba1ba",
    fontSize: 12.5,
    fontWeight: "700",
  },
  pdfModeTextActive: {
    color: "#f5a623",
  },
  pdfPageInputsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    marginTop: 12,
  },
  pdfPageInputWrap: {
    flex: 1,
  },
  pdfPageInputLabel: {
    color: "#9ba1ba",
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 6,
  },
  pdfPageInput: {
    backgroundColor: "rgba(0,0,0,0.35)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#ffffff",
    fontSize: 14,
    textAlign: "center",
  },
  pdfPageInputDash: {
    color: "#9ba1ba",
    fontSize: 16,
    marginBottom: 10,
  },
  voiceHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  voiceToggle: {
    flexDirection: "row",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 12,
    padding: 3,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  voiceToggleOpt: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 9,
  },
  voiceToggleOptActive: {
    backgroundColor: "#f5a623",
  },
  voiceToggleText: {
    color: "#9ba1ba",
    fontWeight: "700",
    fontSize: 12,
  },
  voiceToggleTextActive: {
    color: "#1a1230",
  },
  voiceScroll: {
    flexDirection: "row",
  },
  voiceItemWrapper: {
    alignItems: "center",
    marginRight: 20,
  },
  voiceItem: {
    alignItems: "center",
    opacity: 0.5,
    marginBottom: 8,
  },
  voiceItemActive: {
    opacity: 1,
  },
  voiceIcon: {
    fontSize: 30,
    marginBottom: 5,
  },
  voiceName: {
    color: "#fff",
    fontWeight: "600",
  },
  voiceNameActive: {
    color: "#f5a623",
  },
  previewBtn: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    padding: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  previewBtnText: {
    fontSize: 12,
  },
  accentLabel: {
    color: "#9ba1ba",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 8,
  },
  accentScroll: {
    flexDirection: "row",
  },
  accentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.3)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginRight: 10,
  },
  accentChipActive: {
    backgroundColor: "rgba(245, 166, 35, 0.2)",
    borderColor: "rgba(245, 166, 35, 0.5)",
  },
  accentChipIcon: {
    fontSize: 14,
  },
  accentChipText: {
    color: "#d0d4e3",
    fontSize: 12,
    fontWeight: "600",
  },
  accentChipTextActive: {
    color: "#f5a623",
  },
  generateBtn: {
    backgroundColor: "#f5a623",
    paddingVertical: 18,
    borderRadius: 30,
    alignItems: "center",
    shadowColor: "#f5a623",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  generateBtnText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  errorText: {
    color: "#ff4d4f",
    marginBottom: 15,
    textAlign: "center",
    fontWeight: "600",
  },
  upsellBox: {
    alignItems: "center",
    paddingVertical: 10,
  },
  upsellText: {
    color: "#9ba1ba",
    fontWeight: "600",
    marginBottom: 12,
    textAlign: "center",
  },
  upsellBtn: {
    backgroundColor: "#f5a623",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
  },
  upsellBtnText: {
    color: "#1a1230",
    fontWeight: "800",
    fontSize: 13,
  },
});
