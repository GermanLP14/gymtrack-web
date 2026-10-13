import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ExerciseImage, prefetchExerciseImages } from '@/components/exercise-image';
import { ThemedText } from '@/components/themed-text';
import { Button, Chip, Input, Row } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  bodyPartLabel,
  capitalize,
  getBodyParts,
  listLocalExercises,
  saveExercise,
  searchExercises,
  type Exercise,
} from '@/lib/exercisedb';
import { goBack } from '@/lib/navigation';
import { addWorkoutExercise } from '@/lib/repo';
import { addExerciseToDraft } from '@/lib/routine-draft';

const SEARCH_DEBOUNCE_MS = 300;

/** Modal that adds an ExerciseDB exercise to the routine draft or to a workout. */
export default function ExercisePicker() {
  const db = useSQLiteContext();
  const theme = useTheme();
  // `draft` adds to the routine being edited; `workoutId` adds to that workout.
  const { draft, workoutId } = useLocalSearchParams<{ draft?: string; workoutId?: string }>();

  const [query, setQuery] = useState('');
  const [bodyPart, setBodyPart] = useState<string | null>(null);
  const [bodyParts, setBodyParts] = useState<string[]>([]);
  const [items, setItems] = useState<Exercise[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    getBodyParts(db)
      .then(setBodyParts)
      .catch(() => {});
  }, [db]);

  const searching = query.trim().length >= 2 || bodyPart != null;

  // Debounced search; with no filters, show exercises already saved on the device.
  useEffect(() => {
    let cancelled = false;
    if (!searching) {
      listLocalExercises(db).then((local) => {
        if (!cancelled) {
          setError(null);
          setItems(local);
          setCursor(null);
        }
      });
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const page = await searchExercises(db, { name: query, bodyPart: bodyPart ?? undefined });
        prefetchExerciseImages(page.items.map((i) => i.gifUrl));
        if (!cancelled) {
          setItems(page.items);
          setCursor(page.nextCursor);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [db, query, bodyPart, searching]);

  const loadMore = async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await searchExercises(db, { name: query, bodyPart: bodyPart ?? undefined, cursor });
      prefetchExerciseImages(page.items.map((i) => i.gifUrl));
      setItems((prev) => [...prev, ...page.items.filter((i) => !prev.some((p) => p.id === i.id))]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const pick = async (exercise: Exercise) => {
    setAdding(exercise.id);
    try {
      await saveExercise(db, exercise);
      if (draft) addExerciseToDraft(exercise);
      else if (workoutId) await addWorkoutExercise(db, Number(workoutId), exercise.id);
      goBack();
    } finally {
      setAdding(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={styles.header}>
        <Input
          placeholder="Buscar en inglés: bench press, squat, curl…"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
          <Chip label="Todos" selected={bodyPart == null} onPress={() => setBodyPart(null)} />
          {bodyParts.map((b) => (
            <Chip
              key={b}
              label={bodyPartLabel(b)}
              selected={bodyPart === b}
              onPress={() => setBodyPart(bodyPart === b ? null : b)}
            />
          ))}
        </ScrollView>
        {!searching ? (
          <ThemedText type="small" themeColor="textSecondary">
            {items.length
              ? 'Ejercicios guardados en tu dispositivo'
              : 'Escribí un nombre o elegí un grupo muscular para buscar en ExerciseDB.'}
          </ThemedText>
        ) : null}
        {error ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {error}
          </ThemedText>
        ) : null}
      </View>

      <FlatList
        data={items}
        keyExtractor={(e) => e.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six }}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          searching && !loading && !error ? (
            <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
              Sin resultados. Probá con otro término en inglés.
            </ThemedText>
          ) : null
        }
        ListFooterComponent={loading ? <ActivityIndicator style={{ margin: Spacing.three }} /> : null}
        renderItem={({ item }) => (
          <Row style={[styles.item, { backgroundColor: theme.backgroundElement }]}>
            <Pressable
              onPress={() => router.push(`/exercise/${item.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Ver ${item.name}`}>
              <ExerciseImage uri={item.gifUrl} size={64} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontWeight: 700 }} numberOfLines={2}>
                {capitalize(item.name)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {[...item.targetMuscles, ...item.equipments].map(capitalize).join(' · ')}
              </ThemedText>
            </View>
            <Button title="Agregar" small loading={adding === item.id} onPress={() => pick(item)} />
          </Row>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { padding: Spacing.three, paddingBottom: 0, gap: Spacing.two },
  item: { borderRadius: 14, padding: Spacing.two },
});
