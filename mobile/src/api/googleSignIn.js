// Google sign-in helper (Android app build only).
// The native module is loaded lazily and optionally, so the web/Expo preview and
// builds without the module keep working (the button is simply hidden there).
const WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
  "1025505666090-5gi9l4j37k4ermm2lhelcf8bpe3pdf6u.apps.googleusercontent.com";

let mod = null;
let configured = false;

function loadModule() {
  if (mod) return mod;
  try {
    // eslint-disable-next-line global-require
    mod = require("@react-native-google-signin/google-signin");
  } catch (e) {
    mod = null;
  }
  return mod;
}

export function googleSignInAvailable() {
  const m = loadModule();
  return !!(m && m.GoogleSignin);
}

// Returns a Google ID token. Throws an Error with code "cancelled" if the user backs out.
export async function signInWithGoogle() {
  const m = loadModule();
  if (!m || !m.GoogleSignin) {
    throw new Error("Google sign-in is not available in this version of the app.");
  }
  const { GoogleSignin, statusCodes } = m;
  if (!configured) {
    GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });
    configured = true;
  }
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    try {
      await GoogleSignin.signOut(); // always show the account chooser
    } catch (e) {
      // ignore
    }
    const res = await GoogleSignin.signIn();
    if (res && res.type === "cancelled") {
      const err = new Error("cancelled");
      err.code = "cancelled";
      throw err;
    }
    const idToken = (res && res.data && res.data.idToken) || (res && res.idToken);
    if (!idToken) throw new Error("Google did not return a sign-in token. Please try again.");
    return idToken;
  } catch (e) {
    if (e && statusCodes && e.code === statusCodes.SIGN_IN_CANCELLED) {
      const err = new Error("cancelled");
      err.code = "cancelled";
      throw err;
    }
    throw e;
  }
}
