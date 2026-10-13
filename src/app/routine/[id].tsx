import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Alert } from '@/components/dialog';
import { ExerciseImage } from '@/components/exercise-image';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Row, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useFocusData } from '@/hooks/use-focus-data';
import { useRoutineColors, useTheme } from '@/hooks/use-theme';
import { goBack } from '@/lib/navigation';
import { capitalize } from '@/lib/exercisedb';
import { deleteRoutine, getActiveWorkoutId, getRoutine, startWorkout } from '@/lib/repo';
import { formatRepRange, formatRest } from '@/lib/stats';

/** Read-only view of a routine; editing happens in /routine/edit. */
export default function RoutineScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const colorOf = useRoutineColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const routineId = Number(id);
  const { data: routine } = useFocusData(useCallback(() => getRoutine(db, routineId), [db, routineId]));

  if (!routine) return <Screen>{null}</Screen>;

  const edit = () => router.push({ pathname: '/routine/edit', params: { id: String(routineId) } });

  const start = async () => {
    const active = await getActiveWorkoutId(db);
    if (active) {
      Alert.alert('Entrenamiento en curso', 'Terminá o descartá el entrenamiento actual antes de empezar otro.', [
        { text: 'Ir al actual', onPress: () => router.push(`/workout/${active}`) },
        { text: 'Cancelar', style: 'cancel' },
      ]);
      return;
    }
    router.push(`/workout/${await startWorkout(db, routineId)}`);
  };

  const remove = () =>
    Alert.alert('Eliminar rutina', `¿Eliminar "${routine.name}"? Tu historial de entrenamientos se conserva.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          await deleteRoutine(db, routineId);
          goBack();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen
        options={{ title: routine.name, headerRight: () => <Button title="Editar" small variant="ghost" onPress={edit} /> }}
      />

      {routine.exercises.length === 0 ? (
        <EmptyState
          title="Rutina vacía"
          body="Editá la rutina para agregarle ejercicios."
          action={<Button title="Editar rutina" small onPress={edit} />}
        />
      ) : (
        <Card style={{ gap: 0, paddingVertical: Spacing.one, borderLeftWidth: 5, borderLeftColor: colorOf(routine.color) }}>
          {routine.exercises.map((ex, i) => (
            <Pressable
              key={ex.id}
              onPress={() => router.push(`/exercise/${ex.exerciseId}`)}
              accessibilityRole="button"
              style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border }]}>
              <View style={styles.thumb}>
                <ExerciseImage uri={ex.gifUrl} size={56} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <ThemedText style={{ fontWeight: 700 }} numberOfLines={2}>
                  {capitalize(ex.name)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {ex.targetSets} series · {formatRepRange(ex.repMin, ex.repMax)} · ⏱ Descansa {formatRest(ex.restSec)}
                </ThemedText>
              </View>
            </Pressable>
          ))}
        </Card>
      )}

      <Button title="Empezar rutina" onPress={start} disabled={routine.exercises.length === 0} />
      <Row>
        <Button title="Editar rutina" variant="secondary" onPress={edit} style={{ flex: 1 }} />
        <Button title="Eliminar" variant="ghost" onPress={remove} style={{ flex: 1 }} />
      </Row>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: 12 },
  thumb: { borderRadius: 28, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: '#ddd' },
});
