import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "auth_jwt_token";
const USER_KEY = "auth_user_data";
const ACTIVE_PROFILE_KEY = "active_child_profile";

export const authStorage = {
  async saveToken(token) {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  },

  async getToken() {
    return await AsyncStorage.getItem(TOKEN_KEY);
  },

  async removeToken() {
    await AsyncStorage.removeItem(TOKEN_KEY);
  },

  async saveUser(user) {
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  async getUser() {
    const data = await AsyncStorage.getItem(USER_KEY);
    return data ? JSON.parse(data) : null;
  },

  async removeUser() {
    await AsyncStorage.removeItem(USER_KEY);
  },

  async saveActiveProfile(profile) {
    await AsyncStorage.setItem(ACTIVE_PROFILE_KEY, JSON.stringify(profile));
  },

  async getActiveProfile() {
    const data = await AsyncStorage.getItem(ACTIVE_PROFILE_KEY);
    return data ? JSON.parse(data) : null;
  },

  async clearAll() {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, ACTIVE_PROFILE_KEY]);
  },
};
