import { Platform } from "react-native";

// Lazy resolve expo-audio module (official Expo SDK 52+ audio module for Expo Go)
let ExpoAudioModule = null;
if (Platform.OS !== "web") {
  try {
    ExpoAudioModule = require("expo-audio");
  } catch (e) {
    console.warn("expo-audio native module load note:", e?.message);
  }
}

// Universal Web HTML5 Audio Player
class SafeWebSound {
  constructor(source, initialStatus = {}, onStatusUpdate = null) {
    this.uri = typeof source === "string" ? source : source?.uri;
    this.audio = typeof Audio !== "undefined" && this.uri ? new window.Audio(this.uri) : null;
    this.onStatusUpdate = onStatusUpdate;
    this.isLooping = initialStatus.isLooping || false;
    this.volume = initialStatus.volume !== undefined ? initialStatus.volume : 1.0;
    this.shouldPlay = initialStatus.shouldPlay !== undefined ? initialStatus.shouldPlay : false;
    this.durationMillis = 0;
    this.positionMillis = 0;
    this.isPlaying = false;
    this.isBuffering = true;

    if (this.audio) {
      this.audio.loop = this.isLooping;
      this.audio.volume = Math.max(0, Math.min(1, this.volume));
      this.audio.preload = "auto";

      this.audio.addEventListener("loadedmetadata", () => {
        if (!this.audio) return;
        this.durationMillis = (this.audio.duration || 0) * 1000;
        this._notifyStatus();
      });

      this.audio.addEventListener("timeupdate", () => {
        if (!this.audio) return;
        this.positionMillis = (this.audio.currentTime || 0) * 1000;
        this._notifyStatus();
      });

      this.audio.addEventListener("playing", () => {
        if (!this.audio) return;
        this.isPlaying = true;
        this.isBuffering = false;
        this._notifyStatus();
      });

      this.audio.addEventListener("pause", () => {
        if (!this.audio) return;
        this.isPlaying = false;
        this._notifyStatus();
      });

      this.audio.addEventListener("ended", () => {
        if (!this.audio) return;
        this.isPlaying = false;
        this.positionMillis = this.durationMillis;
        this._notifyStatus({ didJustFinish: true });
      });

      this.audio.addEventListener("waiting", () => {
        if (!this.audio) return;
        this.isBuffering = true;
        this._notifyStatus();
      });

      if (this.shouldPlay) {
        this.playAsync().catch(() => {});
      }
    }
  }

  _notifyStatus(extra = {}) {
    if (this.onStatusUpdate) {
      this.onStatusUpdate({
        isLoaded: true,
        isPlaying: this.isPlaying,
        isBuffering: this.isBuffering,
        positionMillis: this.positionMillis,
        durationMillis: this.durationMillis,
        shouldPlay: this.isPlaying,
        isLooping: this.isLooping,
        volume: this.volume,
        ...extra,
      });
    }
  }

  async playAsync() {
    if (!this.audio) return;
    this.isPlaying = true;
    try {
      await this.audio.play();
    } catch (e) {}
    this._notifyStatus();
  }

  async pauseAsync() {
    if (!this.audio) return;
    this.isPlaying = false;
    this.audio.pause();
    this._notifyStatus();
  }

  async stopAsync() {
    if (!this.audio) return;
    this.isPlaying = false;
    this.audio.pause();
    this.audio.currentTime = 0;
    this.positionMillis = 0;
    this._notifyStatus();
  }

  async setPositionAsync(millis) {
    if (!this.audio) return;
    this.audio.currentTime = millis / 1000;
    this.positionMillis = millis;
    this._notifyStatus();
  }

  async setVolumeAsync(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.audio) {
      this.audio.volume = this.volume;
    }
    this._notifyStatus();
  }

  async setIsLoopingAsync(looping) {
    this.isLooping = looping;
    if (this.audio) {
      this.audio.loop = looping;
    }
    this._notifyStatus();
  }

  // Playback speed (1 = normal). Pitch is preserved so a slower voice still
  // sounds natural, just slower - not deeper.
  async setRateAsync(rate) {
    this.rate = rate;
    if (this.audio) {
      this.audio.playbackRate = rate;
      this.audio.preservesPitch = true;
      this.audio.mozPreservesPitch = true;
      this.audio.webkitPreservesPitch = true;
    }
  }

  setOnPlaybackStatusUpdate(callback) {
    this.onStatusUpdate = callback;
  }

  async unloadAsync() {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
  }
}

// Native Expo Audio Player (for Mobile Android & iOS in Expo Go)
class SafeNativeSound {
  constructor(source, initialStatus = {}, onStatusUpdate = null) {
    const uri = typeof source === "string" ? source : source?.uri;
    this.onStatusUpdate = onStatusUpdate;
    this.isLooping = initialStatus.isLooping || false;
    this.volume = initialStatus.volume !== undefined ? initialStatus.volume : 1.0;
    this.shouldPlay = initialStatus.shouldPlay !== undefined ? initialStatus.shouldPlay : false;
    this.player = null;
    this._subscription = null;

    if (ExpoAudioModule && typeof ExpoAudioModule.createAudioPlayer === "function" && uri) {
      try {
        this.player = ExpoAudioModule.createAudioPlayer(uri);
        if (this.player) {
          this.player.loop = this.isLooping;
          this.player.volume = this.volume;

          if (this.player.addListener) {
            this._subscription = this.player.addListener("playbackStatusUpdate", (status) => {
              if (this.onStatusUpdate) {
                this.onStatusUpdate({
                  isLoaded: status?.isLoaded ?? true,
                  isPlaying: status?.playing ?? false,
                  isBuffering: status?.isBuffering ?? false,
                  positionMillis: (status?.currentTime || 0) * 1000,
                  durationMillis: (status?.duration || 0) * 1000,
                  shouldPlay: status?.playing ?? false,
                  isLooping: this.isLooping,
                  volume: this.volume,
                  didJustFinish: status?.didJustFinish || false,
                });
              }
            });
          }

          if (this.shouldPlay) {
            this.player.play();
          }
        }
      } catch (err) {
        console.warn("expo-audio native player initialization error:", err);
      }
    }
  }

  async playAsync() {
    if (this.player && typeof this.player.play === "function") {
      try {
        this.player.play();
      } catch (e) {}
    }
  }

  async pauseAsync() {
    if (this.player && typeof this.player.pause === "function") {
      try {
        this.player.pause();
      } catch (e) {}
    }
  }

  async stopAsync() {
    if (this.player) {
      try {
        if (typeof this.player.pause === "function") this.player.pause();
        if (typeof this.player.seekTo === "function") this.player.seekTo(0);
      } catch (e) {}
    }
  }

  async setPositionAsync(millis) {
    if (this.player && typeof this.player.seekTo === "function") {
      try {
        this.player.seekTo(millis / 1000);
      } catch (e) {}
    }
  }

  async setVolumeAsync(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.player) {
      try {
        this.player.volume = this.volume;
      } catch (e) {}
    }
  }

  async setIsLoopingAsync(looping) {
    this.isLooping = looping;
    if (this.player) {
      try {
        this.player.loop = looping;
      } catch (e) {}
    }
  }

  // Playback speed (1 = normal). Pitch is preserved so a slower voice still
  // sounds natural, just slower - not deeper.
  async setRateAsync(rate) {
    this.rate = rate;
    if (this.player) {
      try {
        if (typeof this.player.setPlaybackRate === "function") {
          this.player.setPlaybackRate(rate, "high");
        } else {
          this.player.playbackRate = rate;
        }
      } catch (e) {}
    }
  }

  setOnPlaybackStatusUpdate(callback) {
    this.onStatusUpdate = callback;
  }

  async unloadAsync() {
    if (this._subscription && typeof this._subscription.remove === "function") {
      try {
        this._subscription.remove();
      } catch (e) {}
    }
    if (this.player && typeof this.player.release === "function") {
      try {
        this.player.release();
      } catch (e) {}
    }
    this.player = null;
  }
}

export const SafeAudio = {
  Sound: {
    createAsync: async function (source, initialStatus = {}, onPlaybackStatusUpdate = null) {
      if (Platform.OS !== "web" && ExpoAudioModule && typeof ExpoAudioModule.createAudioPlayer === "function") {
        const sound = new SafeNativeSound(source, initialStatus, onPlaybackStatusUpdate);
        return { sound, status: { isLoaded: true, shouldPlay: initialStatus.shouldPlay } };
      }

      const sound = new SafeWebSound(source, initialStatus, onPlaybackStatusUpdate);
      return { sound, status: { isLoaded: true, shouldPlay: initialStatus.shouldPlay } };
    },
  },

  setAudioModeAsync: async function (options) {
    if (ExpoAudioModule && typeof ExpoAudioModule.setAudioModeAsync === "function") {
      try {
        await ExpoAudioModule.setAudioModeAsync(options);
      } catch (e) {}
    }
  },

  setIsEnabledAsync: async function (enabled) {
    if (ExpoAudioModule && typeof ExpoAudioModule.setIsAudioActiveAsync === "function") {
      try {
        await ExpoAudioModule.setIsAudioActiveAsync(enabled);
      } catch (e) {}
    }
  },

  stopAllAudio: async function () {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.querySelectorAll("audio").forEach((el) => {
        try {
          el.pause();
          el.currentTime = 0;
          el.src = "";
        } catch (e) {}
      });
    }
    if (ExpoAudioModule && typeof ExpoAudioModule.setIsAudioActiveAsync === "function") {
      try {
        await ExpoAudioModule.setIsAudioActiveAsync(false);
        await ExpoAudioModule.setIsAudioActiveAsync(true);
      } catch (e) {}
    }
  },

  _previewSound: null,

  playPreview: async function (url) {
    await this.stopPreview();
    try {
      const { sound } = await this.Sound.createAsync(url, { shouldPlay: true });
      this._previewSound = sound;
    } catch (e) {
      console.warn("Failed to play preview:", e);
    }
  },

  stopPreview: async function () {
    if (this._previewSound) {
      try {
        await this._previewSound.stopAsync();
        await this._previewSound.unloadAsync();
      } catch (e) {}
      this._previewSound = null;
    }
  }
};

export default SafeAudio;
