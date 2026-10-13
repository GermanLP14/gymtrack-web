import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View, useWindowDimensions } from 'react-native';

import { CoachCard } from '@/components/coach-card';
import { ExerciseImage } from '@/components/exercise-image';
import { ThemedText } from '@/components/themed-text';
import { Card, Chip, Row, Screen, SectionTitle } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { bodyPartLabel, capitalize, getExercise, type Exercise } from '@/lib/exercisedb';
import type { Recommendation } from '@/lib/progression';
import { getRecommendation } from '@/lib/repo';

export default function ExerciseDetail() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getExercise(db, id)
      .then(setExercise)
      .catch((e: Error) => setError(e.message));
    getRecommendation(db, id).then(setRec);
  }, [db, id]);

  if (error) {
    return (
      <Screen>
        <ThemedText style={{ color: theme.danger }}>{error}</ThemedText>
      </Screen>
    );
  }
  if (!exercise) return <ActivityIndicator style={{ marginTop: Spacing.six }} />;

  return (
    <Screen>
      <Stack.Screen options={{ title: capitalize(exercise.name) }} />
      <View style={{ alignItems: 'center' }}>
        <ExerciseImage uri={exercise.gifUrl} size={Math.min(width - Spacing.three * 2, 360)} animate />
      </View>
      <ThemedText type="subtitle" style={{ fontSize: 26, lineHeight: 32 }}>
        {capitalize(exercise.name)}
      </ThemedText>
      <Row style={{ flexWrap: 'wrap' }}>
        {exercise.bodyParts.map((b) => (
          <Chip key={b} label={bodyPartLabel(b)} selected />
        ))}
        {exercise.equipments.map((e) => (
          <Chip key={e} label={capitalize(e)} />
        ))}
      </Row>

      {rec ? (
        <>
          <SectionTitle>Recomendación del coach</SectionTitle>
          <CoachCard rec={rec} />
        </>
      ) : null}

      <SectionTitle>Músculos</SectionTitle>
      <Card>
        <ThemedText>
          <ThemedText style={{ fontWeight: 700 }}>Principales: </ThemedText>
          {exercise.targetMuscles.map(capitalize).join(', ') || '—'}
        </ThemedText>
        <ThemedText>
          <ThemedText style={{ fontWeight: 700 }}>Secundarios: </ThemedText>
          {exercise.secondaryMuscles.map(capitalize).join(', ') || '—'}
        </ThemedText>
      </Card>

      <SectionTitle>Cómo hacerlo</SectionTitle>
      <Card>
        {exercise.instructions.map((step, i) => (
          <Row key={i} style={{ alignItems: 'flex-start' }}>
            <ThemedText style={{ fontWeight: 700, color: theme.accent, width: 22 }}>{i + 1}.</ThemedText>
            <ThemedText style={{ flex: 1 }}>{step}</ThemedText>
          </Row>
        ))}
      </Card>
      <ThemedText type="small" themeColor="textSecondary">
        Datos e imágenes: ExerciseDB
      </ThemedText>
    </Screen>
  );
}
