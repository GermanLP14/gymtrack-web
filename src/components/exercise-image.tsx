import { Image } from 'expo-image';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';

/**
 * Starts downloading exercise GIFs before their rows are on screen. ExerciseDB
 * only serves full animated GIFs (~100 KB each), so getting a whole page of
 * results in flight at once is the main lever on perceived load time.
 */
export function prefetchExerciseImages(uris: (string | null)[]) {
  const urls = uris.filter((u): u is string => !!u);
  if (urls.length) void Image.prefetch(urls, 'memory-disk').catch(() => {});
}

/**
 * Animated exercise demo from ExerciseDB. The GIFs have a white background,
 * so they sit on a white tile in both color schemes. The spinner sits under
 * the image and is covered by it once the GIF has loaded.
 */
export function ExerciseImage({ uri, size = 56, animate = false }: { uri: string | null; size?: number; animate?: boolean }) {
  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: size > 100 ? 16 : 10 }]}>
      {uri ? (
        <>
          <ActivityIndicator color="#999" size={size > 100 ? 'large' : 'small'} />
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            cachePolicy="memory-disk"
            recyclingKey={uri}
            autoplay={animate}
            transition={100}
            accessibilityIgnoresInvertColors
          />
        </>
      ) : (
        <ThemedText type="small" style={{ color: '#888' }}>
          —
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: '#ffffff', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
