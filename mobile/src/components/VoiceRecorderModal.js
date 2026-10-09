import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Platform,
} from "react-native";
import { colors } from "../theme/colors";
import { api } from "../api/client";

// Native (phone) recording uses expo-audio; the web build keeps using the browser MediaRecorder.
let ExpoAudio = null;
if (Platform.OS !== "web") {
  try {
    ExpoAudio = require("expo-audio");
  } catch (e) {
    console.warn("expo-audio not available:", e && e.message);
  }
}

const TARGET_SECONDS = 23; // 1.5x the original 15s - the read-aloud script needs ~16s at a normal pace

export default function VoiceRecorderModal({ visible, onClose, onVoiceCreated }) {
  const [voiceName, setVoiceName] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState(null);
  const [secondsRecorded, setSecondsRecorded] = useState(0);
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);
  const playbackAudioRef = useRef(null);
  const nativeRecorderRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      resetState();
    }
  }, [visible]);

  function resetState() {
    stopPlayback();
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    releaseNativeRecorder();
    setIsRecording(false);
    setRecordedBlob(null);
    if (recordedAudioUrl) {
      if (Platform.OS === "web") URL.revokeObjectURL(recordedAudioUrl);
      setRecordedAudioUrl(null);
    }
    setSecondsRecorded(0);
    setConsentGiven(false);
    setErrorMessage("");
    setIsSubmitting(false);
  }

  function releaseNativeRecorder() {
    const rec = nativeRecorderRef.current;
    nativeRecorderRef.current = null;
    if (rec) {
      try {
        if (rec.isRecording) rec.stop();
      } catch (e) {}
      try {
        if (rec.release) rec.release();
      } catch (e) {}
    }
  }

  async function startRecording() {
    setErrorMessage("");
    audioChunksRef.current = [];
    setSecondsRecorded(0);
    setRecordedBlob(null);
    if (recordedAudioUrl) {
      if (Platform.OS === "web") URL.revokeObjectURL(recordedAudioUrl);
      setRecordedAudioUrl(null);
    }
    stopPlayback();
    releaseNativeRecorder();

    try {
      if (Platform.OS === "web") {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setErrorMessage("Microphone access is not supported by this browser.");
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          setRecordedBlob(blob);
          const previewUrl = URL.createObjectURL(blob);
          setRecordedAudioUrl(previewUrl);
          // Stop all audio tracks to release microphone indicator
          stream.getTracks().forEach((track) => track.stop());
        };

        mediaRecorder.start(250); // collect in 250ms chunks
        setIsRecording(true);

        // Start timer with progress (TARGET_SECONDS)
        let elapsed = 0;
        timerIntervalRef.current = setInterval(() => {
          elapsed += 1;
          setSecondsRecorded(elapsed);
          if (elapsed >= TARGET_SECONDS) {
            stopRecording();
          }
        }, 1000);
      } else {
        if (!ExpoAudio) {
          setErrorMessage("Recording is not available in this app build.");
          return;
        }
        const perm = await ExpoAudio.requestRecordingPermissionsAsync();
        if (!perm || !perm.granted) {
          setErrorMessage(
            "Microphone permission is needed. Please allow it in your phone Settings > Apps > STORYLAND > Permissions."
          );
          return;
        }
        await ExpoAudio.setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });
        const recorder = new ExpoAudio.AudioModule.AudioRecorder(
          ExpoAudio.RecordingPresets.HIGH_QUALITY
        );
        nativeRecorderRef.current = recorder;
        await recorder.prepareToRecordAsync();
        recorder.record();
        setIsRecording(true);

        let elapsedNative = 0;
        timerIntervalRef.current = setInterval(() => {
          elapsedNative += 1;
          setSecondsRecorded(elapsedNative);
          if (elapsedNative >= TARGET_SECONDS) {
            stopRecording();
          }
        }, 1000);
      }
    } catch (err) {
      setErrorMessage(
        "Could not access microphone. Please allow microphone permission and try again."
      );
      setIsRecording(false);
    }
  }

  async function stopRecording() {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    const rec = nativeRecorderRef.current;
    if (rec) {
      try {
        await rec.stop();
        const uri = rec.uri;
        if (uri) {
          setRecordedBlob({ uri, native: true });
          setRecordedAudioUrl(uri);
        } else {
          setErrorMessage("Recording failed. Please try again.");
        }
      } catch (e) {
        setErrorMessage("Recording failed. Please try again.");
      }
      try {
        await ExpoAudio.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      } catch (e) {}
    }
    setIsRecording(false);
  }

  function togglePlayback() {
    if (!recordedAudioUrl) return;

    if (isPlayingBack && playbackAudioRef.current) {
      stopPlayback();
    } else if (Platform.OS === "web") {
      const audio = new Audio(recordedAudioUrl);
      playbackAudioRef.current = audio;
      audio.onended = () => setIsPlayingBack(false);
      audio.play();
      setIsPlayingBack(true);
    } else if (ExpoAudio) {
      try {
        const player = ExpoAudio.createAudioPlayer({ uri: recordedAudioUrl });
        playbackAudioRef.current = player;
        player.addListener("playbackStatusUpdate", (st) => {
          if (st && st.didJustFinish) stopPlayback();
        });
        player.play();
        setIsPlayingBack(true);
      } catch (e) {
        setErrorMessage("Could not play the sample.");
      }
    }
  }

  function stopPlayback() {
    const p = playbackAudioRef.current;
    playbackAudioRef.current = null;
    if (p) {
      try {
        p.pause();
      } catch (e) {}
      if (Platform.OS !== "web") {
        try {
          p.remove();
        } catch (e) {}
      }
    }
    setIsPlayingBack(false);
  }

  async function handleSaveVoiceClone() {
    if (!voiceName.trim()) {
      setErrorMessage("Please enter a name for your voice (e.g., Mom or Dad).");
      return;
    }
    if (!recordedBlob) {
      setErrorMessage("Please record your voice sample first.");
      return;
    }
    if (!consentGiven) {
      setErrorMessage("Please confirm parental consent before saving.");
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage("");

      const formData = new FormData();
      formData.append("label", voiceName.trim());
      formData.append("consent", "true");
      if (Platform.OS === "web") {
        formData.append("audio_file", recordedBlob, "voice_sample.webm");
      } else {
        formData.append("audio_file", {
          uri: recordedBlob.uri,
          name: "voice_sample.m4a",
          type: "audio/m4a",
        });
      }

      const createdClone = await api.uploadVoiceClone(formData);
      if (onVoiceCreated) onVoiceCreated(createdClone);
      if (onClose) onClose();
    } catch (err) {
      setErrorMessage(err.message || "Failed to create voice clone.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const recordPercent = Math.min(100, Math.round((secondsRecorded / TARGET_SECONDS) * 100));

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Header */}
          <Text style={styles.badge}>🎙️ Parent Voice Studio</Text>
          <Text style={styles.title}>Clone Your Voice</Text>
          <Text style={styles.subtitle}>
            Read the gentle bedtime passage aloud so stories can be narrated in your voice.
          </Text>

          {errorMessage ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {errorMessage}</Text>
            </View>
          ) : null}

          {/* Voice Label Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Voice Name / Label</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Mom, Dad, Papa"
              placeholderTextColor={colors.textDim}
              value={voiceName}
              onChangeText={setVoiceName}
            />
          </View>

          {/* Passage to Read */}
          <Text style={styles.label}>Read This Aloud ({TARGET_SECONDS} seconds):</Text>
          <View style={styles.scriptCard}>
            <Text style={styles.scriptText}>
              "The stars are shining softly in the deep night sky, and the sleepy moon smiles down to whisper gentle dreams to you. Close your eyes, take a deep breath, and rest easy tonight."
            </Text>
          </View>

          {/* Recording Status & Progress Bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressHeader}>
              <View style={styles.recordingPill}>
                <View
                  style={[
                    styles.recordingDot,
                    isRecording && styles.recordingDotActive,
                  ]}
                />
                <Text style={styles.recordingStatusText}>
                  {isRecording
                    ? `Recording... (${secondsRecorded}s / ${TARGET_SECONDS}s)`
                    : recordedBlob
                    ? "Sample Captured! ✅"
                    : "Ready to Record"}
                </Text>
              </View>
              <Text style={styles.percentText}>{recordPercent}%</Text>
            </View>

            {/* Progress Bar */}
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${recordPercent}%` },
                  isRecording && styles.progressBarFillActive,
                ]}
              />
            </View>
          </View>

          {/* Record / Stop / Listen Controls */}
          <View style={styles.controlsRow}>
            {!isRecording && !recordedBlob && (
              <TouchableOpacity
                style={styles.recordBtn}
                onPress={startRecording}
                activeOpacity={0.8}
              >
                <Text style={styles.recordBtnText}>🔴 Start Recording</Text>
              </TouchableOpacity>
            )}

            {isRecording && (
              <TouchableOpacity
                style={styles.stopBtn}
                onPress={stopRecording}
                activeOpacity={0.8}
              >
                <Text style={styles.stopBtnText}>⏹️ Stop Early</Text>
              </TouchableOpacity>
            )}

            {recordedBlob && !isRecording && (
              <View style={styles.reviewRow}>
                <TouchableOpacity
                  style={styles.playbackBtn}
                  onPress={togglePlayback}
                >
                  <Text style={styles.playbackBtnText}>
                    {isPlayingBack ? "⏸️ Pause Sample" : "▶️ Listen to Sample"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.rerecordBtn}
                  onPress={startRecording}
                >
                  <Text style={styles.rerecordBtnText}>🔄 Re-record</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Legal Consent Checkbox */}
          {recordedBlob && !isRecording && (
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setConsentGiven(!consentGiven)}
              activeOpacity={0.8}
            >
              <View style={[styles.checkbox, consentGiven && styles.checkboxChecked]}>
                {consentGiven && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>
                I am the parent/guardian and this is my own voice (or the person has agreed). I consent to STORYLAND sending this recording to our voice partner (ElevenLabs) to make a voice for bedtime stories only. My cloned voice stays until I delete it. Stories made in my voice are deleted automatically 10 days after they are created, and I can save them before then.</Text>
            </TouchableOpacity>
          )}

          {/* Modal Buttons */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => {
                if (onClose) onClose();
              }}
              disabled={isSubmitting}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.saveBtn,
                (!recordedBlob || isRecording) && styles.saveBtnDisabled,
              ]}
              onPress={handleSaveVoiceClone}
              disabled={!recordedBlob || isRecording || isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveText}>Save & Clone Voice ✨</Text>
              )}
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
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 24,
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
    marginBottom: 4,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 18,
  },
  errorBox: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
  },
  errorText: {
    color: "#f87171",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  inputGroup: {
    marginBottom: 14,
  },
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
  },
  input: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  scriptCard: {
    backgroundColor: "rgba(147, 51, 234, 0.1)",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(147, 51, 234, 0.25)",
    marginBottom: 16,
  },
  scriptText: {
    color: colors.sliderThumb,
    fontSize: 14,
    fontStyle: "italic",
    lineHeight: 22,
    textAlign: "center",
  },
  progressContainer: {
    marginBottom: 18,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  recordingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.textDim,
  },
  recordingDotActive: {
    backgroundColor: "#ef4444",
  },
  recordingStatusText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  percentText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "700",
  },
  progressBarTrack: {
    width: "100%",
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  progressBarFillActive: {
    backgroundColor: "#ef4444",
  },
  controlsRow: {
    alignItems: "center",
    marginBottom: 16,
  },
  recordBtn: {
    backgroundColor: "#ef4444",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 14,
  },
  recordBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  stopBtn: {
    backgroundColor: "rgba(239, 68, 68, 0.25)",
    borderWidth: 1,
    borderColor: "#ef4444",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 14,
  },
  stopBtnText: {
    color: "#fca5a5",
    fontSize: 14,
    fontWeight: "700",
  },
  reviewRow: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  playbackBtn: {
    flex: 1.5,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  playbackBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  rerecordBtn: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  rerecordBtnText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 18,
  },
  checkbox: {
    width: 20,
    height: 20,
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
    fontSize: 12,
    fontWeight: "700",
  },
  checkboxLabel: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  cancelText: {
    color: colors.textMuted,
    fontWeight: "600",
  },
  saveBtn: {
    flex: 1.5,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveText: {
    color: "#fff",
    fontWeight: "700",
  },
});
