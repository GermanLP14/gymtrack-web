import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';

// Gives native a `localStorage` backed by SQLite for the session; a no-op on web.
import 'expo-sqlite/localStorage/install';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** `null` until the project's URL and publishable key are set in `.env`. */
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: { storage: localStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
      })
    : null;
