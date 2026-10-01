import { registerRootComponent } from 'expo';
import { LogBox, Platform } from 'react-native';

// Suppress disruptive dev warning overlays on mobile screen
LogBox.ignoreAllLogs(true);
LogBox.ignoreLogs([
  'Cannot connect to Expo CLI',
  'Setting a timer',
  'expo-av',
  'ExponentAV',
  'Non-serializable values',
]);

// On web, Chrome/Edge paint autofilled inputs (e.g. a saved email/password on
// the login screen) with their own light-blue highlight, which overrides our
// dark theme's input background. This forces autofilled inputs to keep the
// app's dark "glass" look instead. Native platforms are unaffected.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    input:-webkit-autofill,
    input:-webkit-autofill:hover,
    input:-webkit-autofill:focus,
    input:-webkit-autofill:active {
      -webkit-text-fill-color: #f8fafc !important;
      caret-color: #f8fafc !important;
      transition: background-color 9999s ease-in-out 0s;
      box-shadow: 0 0 0 1000px rgba(22, 29, 54, 0.85) inset !important;
    }
  `;
  document.head.appendChild(style);
}

import App from './App';

registerRootComponent(App);
