import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.gnani.dukaansaathi',
  appName: 'Dukaan Saathi',
  webDir: 'dist',
  // The shop server runs on a laptop on the same Wi-Fi, usually over plain
  // HTTP. The shell bundles the UI locally and only calls `/api` cross-origin.
  android: {
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
};

export default config;
