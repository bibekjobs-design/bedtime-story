import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native";
import Slider from "@react-native-community/slider";
import SafeAudio from "../utils/safeAudio";
import * as FileSystem from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors } from "../theme/colors";
import { api } from "../api/client";

const AMBIENT_SOUNDSCAPES = [
  {
    id: "woodland_whispers",
    name: "Forest Whispers",
    icon: "🌲",
    description: "Soft acoustic guitar & gentle night breeze",
    audio_url: "https://xkalrbmmvtwwxmbfghjk.supabase.co/storage/v1/object/public/story-audio/ambient/woodland_whispers.wav",
  },
  {
    id: "ocean_waves",
    name: "Calm Ocean Waves",
    icon: "🌊",
    description: "Gentle ocean waves & warm deep water pads",
    audio_url: "https://xkalrbmmvtwwxmbfghjk.supabase.co/storage/v1/object/public/story-audio/ambient/ocean_waves.wav",
  },
  {
    id: "starlight_chimes",
    name: "Celestial Starlight",
    icon: "✨",
    description: "Dreamy cosmic chimes & atmospheric shimmer",
    audio_url: "https://xkalrbmmvtwwxmbfghjk.supabase.co/storage/v1/object/public/story-audio/ambient/starlight_chimes.wav",
  },
  {
    id: "cozy_rain",
    name: "Rain on Window",
    icon: "🌧️",
    description: "Soft rain on window with gentle lullaby chords",
    audio_url: "https://xkalrbmmvtwwxmbfghjk.supabase.co/storage/v1/object/public/story-audio/ambient/cozy_rain.wav",
  },
  {
    id: "music_box_piano",
    name: "Lullaby Music Box",
    icon: "🎹",
    description: "Warm classical piano lullaby & music box",
    audio_url: "https://xkalrbmmvtwwxmbfghjk.supabase.co/storage/v1/object/public/story-audio/ambient/music_box_piano.wav",
  },
];

export default function PlayerScreen({ story, onBack }) {
  // Voice Narration Audio State
  const [sound, setSound] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(
    (story.duration_seconds || 360) * 1000
  );
  const [isBuffering, setIsBuffering] = useState(true);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Story-Matched Ambient Sound State
  const matchedAmbient =
    story.ambient_sound ||
    AMBIENT_SOUNDSCAPES.find((s) => s.id === "woodland_whispers") ||
    AMBIENT_SOUNDSCAPES[0];
  const [activeAmbient, setActiveAmbient] = useState(matchedAmbient);
  const [ambientVolume, setAmbientVolume] = useState(0.15); // 15% volume default
  const [ambientEnabled, setAmbientEnabled] = useState(true);
  const [showAmbientModal, setShowAmbientModal] = useState(false);

  // Sleep Timer state
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState(null);
  const [sleepTimerSecondsLeft, setSleepTimerSecondsLeft] = useState(null);
  const [showTimerModal, setShowTimerModal] = useState(false);

  // Story Rating State
  const [userRating, setUserRating] = useState(story.user_rating || null);
  const [avgRating, setAvgRating] = useState(
    story.average_rating ? Number(story.average_rating).toFixed(1) : "5.0"
  );
  const [totalRatings, setTotalRatings] = useState(story.total_ratings || 1);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [isRatingSaving, setIsRatingSaving] = useState(false);

  // Favorite State
  const [isFavorite, setIsFavorite] = useState(false);

  // Story text reader toggle
  const [showFullText, setShowFullText] = useState(false);

  // Parent-voice (cloned) stories only narrate the first part of the source
  // text, so showing the full source text / teaser under the player looks
  // wrong - hide both for those stories.
  const isClonedStory = !!story.is_cloned_voice || story.origin === "cloned";

  // Narration speed (1 = normal). Lets parents slow the voice down for
  // younger listeners. Only the narration is affected, not the ambient music.
  const SPEED_OPTIONS = [0.7, 0.8, 0.9, 1];
  const [playbackRate, setPlaybackRate] = useState(1);

  const soundRef = useRef(null);
  const ambientSoundRef = useRef(null);
  const sleepIntervalRef = useRef(null);

  async function checkFavoriteStatus() {
    try {
      const raw = await AsyncStorage.getItem("@bedtime_user_favorites");
      const list = raw ? JSON.parse(raw) : [];
      const storyId = story.story_text_id || story.id;
      setIsFavorite(list.includes(storyId));
    } catch (e) {}
  }

  async function toggleFavorite() {
    try {
      const raw = await AsyncStorage.getItem("@bedtime_user_favorites");
      const list = raw ? JSON.parse(raw) : [];
      const storyId = story.story_text_id || story.id;
      let updated;
      if (list.includes(storyId)) {
        updated = list.filter((id) => id !== storyId);
        setIsFavorite(false);
      } else {
        updated = [storyId, ...list];
        setIsFavorite(true);
      }
      await AsyncStorage.setItem("@bedtime_user_favorites", JSON.stringify(updated));
    } catch (e) {}
  }

  async function handleRate(stars) {
    setUserRating(stars);
    setIsRatingSaving(true);
    try {
      const storyId = story.story_text_id || story.id;
      const res = await api.rateStory(storyId, stars);
      if (res && res.average_rating) {
        setAvgRating(Number(res.average_rating).toFixed(1));
        setTotalRatings(res.total_ratings);
      }
      setRatingSubmitted(true);
      setTimeout(() => {
        setRatingSubmitted(false);
      }, 3000);
    } catch (err) {
      console.warn("Rating save notice:", err);
      setRatingSubmitted(true);
    } finally {
      setIsRatingSaving(false);
    }
  }

  useEffect(() => {
    setupAudioAndAmbient();
    checkOfflineStatus();
    checkFavoriteStatus();

    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
      if (ambientSoundRef.current) {
        ambientSoundRef.current.unloadAsync().catch(() => {});
      }
      if (sleepIntervalRef.current) {
        clearInterval(sleepIntervalRef.current);
      }
    };
  }, []);

  // Sleep timer interval
  useEffect(() => {
    if (sleepTimerSecondsLeft === null) return;

    if (sleepTimerSecondsLeft <= 0) {
      // Pause both playback streams when timer ends
      if (soundRef.current) {
        soundRef.current.pauseAsync().catch(() => {});
      }
      if (ambientSoundRef.current) {
        ambientSoundRef.current.pauseAsync().catch(() => {});
      }
      setIsPlaying(false);
      setSleepTimerMinutes(null);
      setSleepTimerSecondsLeft(null);
      Alert.alert("🌙 Sleep Timer", "Story paused. Sweet dreams!");
      return;
    }

    const timer = setInterval(() => {
      setSleepTimerSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [sleepTimerSecondsLeft]);

  async function checkOfflineStatus() {
    try {
      const localUri = await AsyncStorage.getItem(`offline_${story.story_text_id}`);
      if (localUri) {
        const fileInfo = await FileSystem.getInfoAsync(localUri);
        if (fileInfo.exists) {
          setIsDownloaded(true);
        }
      }
    } catch (e) {}
  }

  async function setupAudioAndAmbient() {
    try {
      setIsBuffering(true);
      await SafeAudio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
      });

      // 1. Setup Voice Narration (Track 1)
      const localUri = await AsyncStorage.getItem(`offline_${story.story_text_id}`);
      const audioSource = localUri ? { uri: localUri } : { uri: story.audio_url };

      const { sound: newSound } = await SafeAudio.Sound.createAsync(
        audioSource,
        { shouldPlay: true, volume: 1.0 },
        onPlaybackStatusUpdate
      );
      soundRef.current = newSound;
      setSound(newSound);

      // History is now recorded server-side, at generation/commit time (see
      // history_service.py - Library plays, Create->Narrator generations,
      // and Create->Clone narrations all write a story_events row there),
      // so it survives cache clears and follows the account across devices.
      // Nothing to do here anymore.
      setIsPlaying(true);

      // 2. Setup Looping Ambient Soundtrack (Track 2) - best-effort only.
      if (matchedAmbient?.audio_url) {
        try {
          const { sound: ambSound } = await SafeAudio.Sound.createAsync(
            { uri: matchedAmbient.audio_url },
            { shouldPlay: true, isLooping: true, volume: ambientVolume }
          );
          ambientSoundRef.current = ambSound;
        } catch (ambErr) {
          console.warn("Ambient track failed to load (narration still playing):", ambErr);
        }
      }
    } catch (err) {
      Alert.alert("Audio Error", "Could not stream bedtime story: " + err.message);
    } finally {
      setIsBuffering(false);
    }
  }

  async function switchAmbientTrack(track) {
    setActiveAmbient(track);
    setShowAmbientModal(false);
    try {
      if (ambientSoundRef.current) {
        await ambientSoundRef.current.stopAsync();
        await ambientSoundRef.current.unloadAsync();
        ambientSoundRef.current = null;
      }
      if (ambientEnabled && track.audio_url) {
        const { sound: newAmb } = await SafeAudio.Sound.createAsync(
          { uri: track.audio_url },
          { shouldPlay: isPlaying, isLooping: true, volume: ambientVolume }
        );
        ambientSoundRef.current = newAmb;
      }
    } catch (e) {}
  }

  async function toggleAmbientMute() {
    const nextState = !ambientEnabled;
    setAmbientEnabled(nextState);
    if (ambientSoundRef.current) {
      if (nextState) {
        await ambientSoundRef.current.setVolumeAsync(ambientVolume);
        if (isPlaying) await ambientSoundRef.current.playAsync();
      } else {
        await ambientSoundRef.current.setVolumeAsync(0);
      }
    }
  }

  async function handleAmbientVolumeChange(vol) {
    setAmbientVolume(vol);
    if (ambientSoundRef.current && ambientEnabled) {
      await ambientSoundRef.current.setVolumeAsync(vol);
    }
  }

  function onPlaybackStatusUpdate(status) {
    if (!status.isLoaded) return;

    setPositionMillis(status.positionMillis || 0);
    if (status.durationMillis) {
      setDurationMillis(status.durationMillis);
    }
    setIsPlaying(status.isPlaying);
    setIsBuffering(status.isBuffering);

    if (status.didJustFinish) {
      setIsPlaying(false);
      if (ambientSoundRef.current) {
        ambientSoundRef.current.pauseAsync().catch(() => {});
      }
      setShowRatingModal(true);
    }
  }

  async function handleChangeSpeed(rate) {
    setPlaybackRate(rate);
    if (soundRef.current && typeof soundRef.current.setRateAsync === "function") {
      try {
        await soundRef.current.setRateAsync(rate);
      } catch (e) {}
    }
  }

  async function togglePlayPause() {
    if (!sound) return;
    if (isPlaying) {
      await sound.pauseAsync();
      if (ambientSoundRef.current) {
        await ambientSoundRef.current.pauseAsync();
      }
    } else {
      await sound.playAsync();
      if (ambientSoundRef.current && ambientEnabled) {
        await ambientSoundRef.current.playAsync();
      }
    }
  }

  async function skipSeconds(deltaSeconds) {
    if (!sound) return;
    const newPos = Math.max(
      0,
      Math.min(durationMillis, positionMillis + deltaSeconds * 1000)
    );
    await sound.setPositionAsync(newPos);
  }

  async function onSeek(value) {
    if (!sound) return;
    await sound.setPositionAsync(value);
  }

  function handleSetSleepTimer(minutes) {
    setShowTimerModal(false);
    if (!minutes) {
      setSleepTimerMinutes(null);
      setSleepTimerSecondsLeft(null);
      return;
    }
    setSleepTimerMinutes(minutes);
    setSleepTimerSecondsLeft(minutes * 60);
  }

  async function handleDownloadOffline() {
    if (isDownloaded) {
      Alert.alert("Offline Ready", "This bedtime story is already saved for offline listening!");
      return;
    }

    try {
      setDownloading(true);
      const targetDir = `${FileSystem.documentDirectory}stories/`;
      const dirInfo = await FileSystem.getInfoAsync(targetDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
      }

      const fileUri = `${targetDir}${story.story_text_id}.mp3`;
      const downloadRes = await FileSystem.downloadAsync(story.audio_url, fileUri);

      if (downloadRes.status === 200) {
        await AsyncStorage.setItem(`offline_${story.story_text_id}`, fileUri);
        setIsDownloaded(true);
        Alert.alert("Downloaded! 🌙", "Story saved for offline listening anywhere.");
      }
    } catch (err) {
      Alert.alert("Download Error", "Could not download story: " + err.message);
    } finally {
      setDownloading(false);
    }
  }

  function formatTime(ms) {
    const totalSeconds = Math.floor((ms || 0) / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  }

  return (
    <View style={styles.container}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {/* Top Bar */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backButtonText}>← Stories</Text>
          </TouchableOpacity>

          <View style={styles.topActions}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={toggleFavorite}
            >
              <Text style={styles.actionIcon}>
                {isFavorite ? "❤️ Fav" : "🤍 Fav"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => setShowTimerModal(true)}
            >
              <Text style={styles.actionIcon}>
                {sleepTimerMinutes ? `🌙 ${Math.ceil(sleepTimerSecondsLeft / 60)}m` : "⏱️ Timer"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleDownloadOffline}
              disabled={downloading}
            >
              {downloading ? (
                <ActivityIndicator size="small" color={colors.sliderThumb} />
              ) : (
                <Text style={styles.actionIcon}>
                  {isDownloaded ? "✅ Saved" : "⬇️ Offline"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Ambient Glow Cover Art */}
        <View style={styles.coverArtBox}>
          <View style={styles.coverArtGlow}>
            <Text style={styles.coverEmoji}>🌙</Text>
            <Text style={styles.coverSubEmoji}>⭐ 🧸 ☁️</Text>
          </View>
        </View>

        {/* Story Details */}
        <View style={styles.storyDetails}>
          <Text style={styles.podcastBadge}>
            {story.narrator_name
              ? `Bedtime Tale • Narrated by ${story.narrator_icon || ""} ${story.narrator_name}`
              : "Bedtime Story Narration"}
          </Text>
          <Text style={styles.title}>{story.title}</Text>
          {!isClonedStory && story.teaser ? (
            <Text style={styles.teaser}>{story.teaser}</Text>
          ) : null}
        </View>

        {/* Story-Matched Ambient Soundscape Dock */}
        <View style={styles.ambientDock}>
          <TouchableOpacity
            style={styles.ambientTrackInfo}
            onPress={() => setShowAmbientModal(true)}
          >
            <Text style={styles.ambientIcon}>{activeAmbient.icon}</Text>
            <View style={styles.ambientTextCol}>
              <Text style={styles.ambientLabel}>Background Music (Auto-Matched)</Text>
              <Text style={styles.ambientTitle}>{activeAmbient.name} • ⚙️ Change</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.ambientMuteBtn} onPress={toggleAmbientMute}>
            <Text style={styles.ambientMuteText}>{ambientEnabled ? "🔊" : "🔇"}</Text>
          </TouchableOpacity>
        </View>

        {/* Background Music Volume */}
        {ambientEnabled && (
          <View style={styles.ambientVolumeRow}>
            <Text style={styles.ambientVolumeIcon}>🔉</Text>
            <Slider
              style={styles.ambientVolumeSlider}
              minimumValue={0}
              maximumValue={1}
              value={ambientVolume}
              onValueChange={handleAmbientVolumeChange}
              minimumTrackTintColor={colors.sliderTrackActive}
              maximumTrackTintColor={colors.sliderTrackInactive}
              thumbTintColor={colors.sliderThumb}
            />
            <Text style={styles.ambientVolumeIcon}>🔊</Text>
          </View>
        )}

        {/* Time Slider */}
        <View style={styles.sliderContainer}>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={durationMillis || 1}
            value={positionMillis}
            onSlidingComplete={onSeek}
            minimumTrackTintColor={colors.sliderTrackActive}
            maximumTrackTintColor={colors.sliderTrackInactive}
            thumbTintColor={colors.sliderThumb}
          />
          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{formatTime(positionMillis)}</Text>
            <Text style={styles.timeText}>{formatTime(durationMillis)}</Text>
          </View>
        </View>

        {/* Playback Controls */}
        <View style={styles.controlsRow}>
          <TouchableOpacity style={styles.skipButton} onPress={() => skipSeconds(-15)}>
            <Text style={styles.skipText}>-15s</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.playButton}
            onPress={togglePlayPause}
            activeOpacity={0.8}
          >
            {isBuffering ? (
              <ActivityIndicator color="#fff" size="large" />
            ) : (
              <Text style={styles.playIcon}>{isPlaying ? "⏸️" : "▶️"}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.skipButton} onPress={() => skipSeconds(15)}>
            <Text style={styles.skipText}>+15s</Text>
          </TouchableOpacity>
        </View>

        {/* Narration speed */}
        <View style={styles.speedRow}>
          <Text style={styles.speedLabel}>🐢 Voice speed</Text>
          <View style={styles.speedChips}>
            {SPEED_OPTIONS.map((rate) => (
              <TouchableOpacity
                key={rate}
                style={[styles.speedChip, playbackRate === rate && styles.speedChipActive]}
                onPress={() => handleChangeSpeed(rate)}
              >
                <Text style={[styles.speedChipText, playbackRate === rate && styles.speedChipTextActive]}>
                  {rate === 1 ? "Normal" : `${rate}x`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Story Star Rating Card */}
        <View style={styles.ratingCard}>
          <Text style={styles.ratingCardTitle}>⭐ Rate this Story</Text>
          <Text style={styles.ratingCardSubtitle}>
            How did your little dreamer like this tale?
          </Text>
          <View style={styles.ratingStarsRow}>
            {[1, 2, 3, 4, 5].map((star) => (
              <TouchableOpacity
                key={star}
                style={styles.starButton}
                onPress={() => handleRate(star)}
                disabled={isRatingSaving}
              >
                <Text
                  style={[
                    styles.starText,
                    userRating && userRating >= star ? styles.starTextActive : styles.starTextInactive,
                  ]}
                >
                  ⭐
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.ratingStatsRow}>
            <Text style={styles.ratingStatsText}>
              ⭐ {avgRating} avg • {totalRatings} {totalRatings === 1 ? "rating" : "ratings"}
            </Text>
            {userRating ? (
              <Text style={styles.userRatingBadge}>Your rating: {userRating} ★</Text>
            ) : null}
          </View>
          {ratingSubmitted ? (
            <Text style={styles.ratingThankYou}>✨ Thank you for your feedback!</Text>
          ) : null}
        </View>

        {!isClonedStory && (
          <>
          {/* Read Along Text Toggle */}
          <TouchableOpacity
            style={styles.readAlongButton}
            onPress={() => setShowFullText(!showFullText)}
          >
            <Text style={styles.readAlongText}>
              {showFullText ? "▲ Hide Story Text" : "📖 Read Along Story Text"}
            </Text>
          </TouchableOpacity>

          {showFullText && (
            <View style={styles.storyTextBox}>
              <Text style={styles.fullStoryContent}>{story.full_text}</Text>
            </View>
          )}
          </>
        )}
      </ScrollView>

      {/* STORY COMPLETION & RATING MODAL */}
      <Modal visible={showRatingModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalCompletedEmoji}>🌙 ✨</Text>
            <Text style={styles.modalTitle}>Story Finished!</Text>
            <Text style={styles.modalSubtitle}>
              Hope your little dreamer had a magical time. How would you rate this story?
            </Text>

            <View style={[styles.ratingStarsRow, { marginVertical: 14 }]}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity
                  key={star}
                  style={styles.starButton}
                  onPress={() => handleRate(star)}
                >
                  <Text
                    style={[
                      styles.starModalText,
                      userRating && userRating >= star ? styles.starTextActive : styles.starTextInactive,
                    ]}
                  >
                    ⭐
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {userRating ? (
              <Text style={styles.modalRatingSaved}>
                ✨ Rated {userRating} Stars • Thank you!
              </Text>
            ) : null}

            <TouchableOpacity
              style={[styles.modalCloseButton, { marginTop: 12 }]}
              onPress={() => setShowRatingModal(false)}
            >
              <Text style={styles.modalCloseText}>Done & Goodnight</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* AMBIENT MUSIC PICKER MODAL */}
      <Modal visible={showAmbientModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🎵 Bedtime Soundscapes</Text>
            <Text style={styles.modalSubtitle}>
              Calibrated ambient music playing softly beneath the story.
            </Text>

            {AMBIENT_SOUNDSCAPES.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.ambientOption,
                  activeAmbient.id === item.id && styles.ambientOptionActive,
                ]}
                onPress={() => switchAmbientTrack(item)}
              >
                <Text style={styles.ambientOptionIcon}>{item.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.ambientOptionTitle,
                      activeAmbient.id === item.id && styles.ambientOptionTitleActive,
                    ]}
                  >
                    {item.name}
                  </Text>
                  <Text style={styles.ambientOptionDesc}>{item.description}</Text>
                </View>
                {activeAmbient.id === item.id && <Text style={styles.checkIcon}>✓</Text>}
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowAmbientModal(false)}
            >
              <Text style={styles.modalCloseText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Sleep Timer Modal */}
      <Modal visible={showTimerModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🌙 Sleep Timer</Text>
            <Text style={styles.modalSubtitle}>
              Automatically pauses narration and music when timer ends.
            </Text>

            {[
              { label: "Off", mins: null },
              { label: "5 Minutes", mins: 5 },
              { label: "10 Minutes", mins: 10 },
              { label: "15 Minutes", mins: 15 },
            ].map((opt) => (
              <TouchableOpacity
                key={opt.label}
                style={[
                  styles.modalOption,
                  sleepTimerMinutes === opt.mins && styles.modalOptionActive,
                ]}
                onPress={() => handleSetSleepTimer(opt.mins)}
              >
                <Text
                  style={[
                    styles.modalOptionText,
                    sleepTimerMinutes === opt.mins && styles.modalOptionTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowTimerModal(false)}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
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
    alignItems: "center",
  },
  topBar: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  backButtonText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  topActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(147, 51, 234, 0.15)",
  },
  actionIcon: {
    color: colors.sliderThumb,
    fontSize: 12,
    fontWeight: "700",
  },
  coverArtBox: {
    width: 220,
    height: 220,
    borderRadius: 36,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 14,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  coverArtGlow: {
    alignItems: "center",
  },
  coverEmoji: {
    fontSize: 66,
    marginBottom: 8,
  },
  coverSubEmoji: {
    fontSize: 20,
    letterSpacing: 4,
  },
  storyDetails: {
    width: "100%",
    alignItems: "center",
    marginTop: 10,
    marginBottom: 16,
  },
  podcastBadge: {
    color: colors.sliderThumb,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
  teaser: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: 10,
  },
  ambientDock: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(147, 51, 234, 0.12)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(147, 51, 234, 0.3)",
    marginBottom: 20,
  },
  ambientTrackInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  ambientIcon: {
    fontSize: 22,
  },
  ambientTextCol: {
    flex: 1,
  },
  ambientLabel: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  ambientTitle: {
    color: colors.sliderThumb,
    fontSize: 12,
    fontWeight: "700",
  },
  ambientMuteBtn: {
    padding: 6,
    borderRadius: 10,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  ambientMuteText: {
    fontSize: 16,
  },
  ambientVolumeRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  ambientVolumeIcon: {
    fontSize: 14,
    opacity: 0.8,
  },
  ambientVolumeSlider: {
    flex: 1,
    height: 32,
  },
  sliderContainer: {
    width: "100%",
    marginBottom: 20,
  },
  slider: {
    width: "100%",
    height: 40,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 10,
  },
  timeText: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: "600",
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 28,
    marginBottom: 24,
  },
  skipButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  skipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  playIcon: {
    fontSize: 28,
  },
  speedRow: {
    width: "100%",
    alignItems: "center",
    marginBottom: 20,
  },
  speedLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  speedChips: {
    flexDirection: "row",
    gap: 8,
  },
  speedChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  speedChipActive: {
    backgroundColor: colors.sliderThumb,
  },
  speedChipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  speedChipTextActive: {
    color: "#0b0e20",
  },
  readAlongButton: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    marginBottom: 16,
  },
  readAlongText: {
    color: colors.sliderThumb,
    fontSize: 13,
    fontWeight: "600",
  },
  storyTextBox: {
    width: "100%",
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  fullStoryContent: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 24,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 6,
  },
  modalSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    marginBottom: 18,
  },
  ambientOption: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    marginBottom: 8,
    gap: 12,
  },
  ambientOptionActive: {
    backgroundColor: "rgba(147, 51, 234, 0.2)",
    borderWidth: 1,
    borderColor: colors.sliderThumb,
  },
  ambientOptionIcon: {
    fontSize: 24,
  },
  ambientOptionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  ambientOptionTitleActive: {
    color: colors.sliderThumb,
  },
  ambientOptionDesc: {
    color: colors.textDim,
    fontSize: 11,
    marginTop: 2,
  },
  checkIcon: {
    color: colors.sliderThumb,
    fontSize: 16,
    fontWeight: "800",
  },
  modalOption: {
    width: "100%",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 8,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  modalOptionActive: {
    backgroundColor: colors.primary,
  },
  modalOptionText: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: "600",
  },
  modalOptionTextActive: {
    color: "#fff",
    fontWeight: "700",
  },
  modalCloseButton: {
    marginTop: 10,
    paddingVertical: 8,
  },
  modalCloseText: {
    color: colors.textDim,
    fontSize: 14,
  },
  ratingCard: {
    width: "100%",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
    marginBottom: 16,
  },
  ratingCardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 4,
  },
  ratingCardSubtitle: {
    color: colors.textDim,
    fontSize: 12,
    marginBottom: 10,
    textAlign: "center",
  },
  ratingStarsRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  starButton: {
    padding: 4,
  },
  starText: {
    fontSize: 28,
  },
  starModalText: {
    fontSize: 34,
  },
  starTextActive: {
    opacity: 1,
  },
  starTextInactive: {
    opacity: 0.28,
  },
  ratingStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  ratingStatsText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  userRatingBadge: {
    color: colors.sliderThumb,
    fontSize: 12,
    fontWeight: "700",
    backgroundColor: "rgba(147, 51, 234, 0.2)",
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  ratingThankYou: {
    color: colors.sliderThumb,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 6,
  },
  modalCompletedEmoji: {
    fontSize: 36,
    marginBottom: 8,
  },
  modalRatingSaved: {
    color: colors.sliderThumb,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 4,
    marginBottom: 8,
  },
});
