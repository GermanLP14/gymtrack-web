import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CoachCard } from '@/components/coach-card';
import { Alert } from '@/components/dialog';
import { ExerciseImage } from '@/components/exercise-image';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Input, Row, Screen } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useFocusData } from '@/hooks/use-focus-data';
import { useTheme } from '@/hooks/use-theme';
import { goBack } from '@/lib/navigation';
import { capitalize } from '@/lib/exercisedb';
import { formatDuration } from '@/lib/dates';
import type { Recommendation } from '@/lib/progression';
import {
  addSet,
  deleteSet,
  deleteWorkout,
  finishWorkout,
  getPreviousRoutineWorkout,
  getRecommendation,
  getRoutine,
  getWorkout,
  removeWorkoutExercise,
  updateSet,
  type WorkoutExercise,
  type WorkoutSet,
} from '@/lib/repo';
import { formatKg, type SetLog } from '@/lib/stats';

const DEFAULT_REST_SEC = 90;

/** `previous` holds this exercise's sets from the last workout of the same routine. */
type ExerciseContext = { rec: Recommendation; previous: SetLog[] | null; restSec: number };

export default function WorkoutScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const workoutId = Number(id);
  const [restUntil, setRestUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const { data, reload } = useFocusData(
    useCallback(async () => {
      const workout = await getWorkout(db, workoutId);
      if (!workout) return null;
      const [routine, previousWorkout] = await Promise.all([
        workout.routineId != null ? getRoutine(db, workout.routineId) : null,
        getPreviousRoutineWorkout(db, workout),
      ]);
      const context: Record<string, ExerciseContext> = {};
      await Promise.all(
        workout.exercises.map(async (ex) => {
          const routineEx = routine?.exercises.find((r) => r.exerciseId === ex.exerciseId);
          const rec = await getRecommendation(db, ex.exerciseId, routineEx, workout.routineId);
          const previous = previousWorkout?.exercises.find((p) => p.exerciseId === ex.exerciseId)?.sets ?? null;
          context[ex.exerciseId] = { rec, previous, restSec: routineEx?.restSec ?? DEFAULT_REST_SEC };
        }),
      );
      return { workout, context };
    }, [db, workoutId]),
  );

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!data) return <Screen>{null}</Screen>;
  const { workout, context } = data;
  const finished = workout.finishedAt != null;
  const restLeft = restUntil != null ? Math.max(0, Math.ceil((restUntil - now) / 1000)) : 0;

  const finish = () =>
    Alert.alert('Terminar entrenamiento', 'Las series sin marcar como hechas se descartan.', [
      { text: 'Seguir entrenando', style: 'cancel' },
      {
        text: 'Terminar',
        onPress: async () => {
          const saved = await finishWorkout(db, workoutId);
          if (!saved) {
            Alert.alert('Nada para guardar', 'No marcaste ninguna serie como hecha, así que no se guardó el entrenamiento.');
            goBack();
            return;
          }
          // Land on the saved entry in Historial, where the summary is shown.
          router.replace(`/history/${workoutId}`);
        },
      },
    ]);

  const discard = () =>
    Alert.alert(finished ? 'Eliminar entrenamiento' : 'Descartar entrenamiento', 'Se borran todas las series de esta sesión.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: finished ? 'Eliminar' : 'Descartar',
        style: 'destructive',
        onPress: async () => {
          await deleteWorkout(db, workoutId);
          goBack();
        },
      },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          title: workout.name,
          headerRight: finished ? undefined : () => <Button title="Terminar" small onPress={finish} />,
        }}
      />
      <Screen>
        <ThemedText themeColor="textSecondary">
          {finished
            ? `Duración ${formatDuration(workout.finishedAt! - workout.startedAt)}`
            : `En curso · ${formatDuration(now - workout.startedAt)}`}
        </ThemedText>

        {workout.exercises.length === 0 ? (
          <EmptyState title="Sin ejercicios" body="Agregá ejercicios para empezar a registrar series." />
        ) : (
          workout.exercises.map((ex) => (
            <ExerciseBlock
              key={`${ex.order}-${ex.exerciseId}`}
              workoutId={workoutId}
              ex={ex}
              context={context[ex.exerciseId]}
              onChanged={reload}
              onSetCompleted={() => setRestUntil(Date.now() + (context[ex.exerciseId]?.restSec ?? DEFAULT_REST_SEC) * 1000)}
            />
          ))
        )}

        <Button
          title="+ Agregar ejercicio"
          variant="secondary"
          onPress={() => router.push({ pathname: '/exercise-picker', params: { workoutId: String(workoutId) } })}
        />
        {!finished ? <Button title="Terminar entrenamiento" onPress={finish} /> : null}
        <Button title={finished ? 'Eliminar entrenamiento' : 'Descartar'} variant="ghost" onPress={discard} />
      </Screen>

      {restLeft > 0 ? (
        <Pressable
          onPress={() => setRestUntil(null)}
          style={[styles.rest, { backgroundColor: theme.accent }]}
          accessibilityRole="button">
          <ThemedText style={{ color: theme.accentText, fontWeight: 700 }}>
            Descanso {Math.floor(restLeft / 60)}:{String(restLeft % 60).padStart(2, '0')}
          </ThemedText>
          <ThemedText type="small" style={{ color: theme.accentText }}>
            Tocá para saltear
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function ExerciseBlock({
  workoutId,
  ex,
  context,
  onChanged,
  onSetCompleted,
}: {
  workoutId: number;
  ex: WorkoutExercise;
  context?: ExerciseContext;
  onChanged: () => void;
  onSetCompleted: () => void;
}) {
  const db = useSQLiteContext();
  const done = ex.sets.filter((s) => s.completed).length;

  return (
    <Card>
      <Row>
        <Pressable onPress={() => router.push(`/exercise/${ex.exerciseId}`)} accessibilityRole="button">
          <ExerciseImage uri={ex.gifUrl} size={52} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <ThemedText style={{ fontWeight: 700 }} numberOfLines={2}>
            {capitalize(ex.name)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {done}/{ex.sets.length} series hechas
          </ThemedText>
        </View>
      </Row>

      {context ? <CoachCard rec={context.rec} compact /> : null}

      <Row style={styles.headerRow}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.colIndex}>
          #
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.colPrev}>
          Anterior
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.col}>
          kg
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.col}>
          reps
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.col}>
          RPE
        </ThemedText>
        <View style={styles.colCheck} />
      </Row>
      {ex.sets.map((s, i) => (
        <SetRow
          key={s.id}
          set={s}
          index={i}
          previous={context?.previous?.[i] ?? null}
          onCompleted={onSetCompleted}
          onDeleted={onChanged}
        />
      ))}

      <Row style={{ justifyContent: 'space-between' }}>
        <Button
          title="+ Serie"
          small
          variant="secondary"
          onPress={async () => {
            await addSet(db, workoutId, ex.order);
            onChanged();
          }}
        />
        <Button
          title="Quitar ejercicio"
          small
          variant="ghost"
          onPress={async () => {
            await removeWorkoutExercise(db, workoutId, ex.order);
            onChanged();
          }}
        />
      </Row>
    </Card>
  );
}

function parseNum(text: string): number | null {
  const n = Number(text.replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
}

function SetRow({
  set,
  index,
  previous,
  onCompleted,
  onDeleted,
}: {
  set: WorkoutSet;
  index: number;
  previous: SetLog | null;
  onCompleted: () => void;
  onDeleted: () => void;
}) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [weight, setWeight] = useState(String(set.weight));
  const [reps, setReps] = useState(String(set.reps));
  const [rpe, setRpe] = useState(set.rpe != null ? String(set.rpe) : '');
  const [completed, setCompleted] = useState(set.completed);

  const persist = async (nextCompleted = completed) => {
    const rpeValue = parseNum(rpe);
    await updateSet(db, set.id, {
      weight: parseNum(weight) ?? 0,
      reps: Math.round(parseNum(reps) ?? 0),
      rpe: rpeValue != null ? Math.min(10, Math.max(1, rpeValue)) : null,
      completed: nextCompleted,
    });
  };

  const toggle = async () => {
    const next = !completed;
    if (next && (parseNum(reps) ?? 0) <= 0) {
      Alert.alert('Faltan repeticiones', 'Cargá cuántas repeticiones hiciste antes de marcar la serie.');
      return;
    }
    setCompleted(next);
    await persist(next);
    if (next) onCompleted();
  };

  const remove = () =>
    Alert.alert(`Serie ${index + 1}`, `${formatKg(parseNum(weight) ?? 0)} × ${reps}`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar serie',
        style: 'destructive',
        onPress: async () => {
          await deleteSet(db, set.id);
          onDeleted();
        },
      },
    ]);

  const fieldStyle = [styles.col, styles.field, completed && { backgroundColor: theme.backgroundSelected }];

  return (
    <Row>
      <Pressable onPress={remove} style={styles.colIndex} accessibilityRole="button" accessibilityHint="Borrar esta serie">
        <ThemedText style={{ fontWeight: 700 }}>{index + 1}</ThemedText>
      </Pressable>
      <ThemedText
        type="small"
        themeColor="textSecondary"
        style={styles.colPrev}
        numberOfLines={1}
        accessibilityLabel={previous ? `La vez anterior: ${previous.weight} kilos por ${previous.reps}` : 'Sin dato anterior'}>
        {previous ? `${previous.weight}×${previous.reps}` : '—'}
      </ThemedText>
      <Input
        value={weight}
        onChangeText={setWeight}
        onBlur={() => persist()}
        keyboardType="decimal-pad"
        selectTextOnFocus
        style={fieldStyle}
      />
      <Input
        value={reps}
        onChangeText={setReps}
        onBlur={() => persist()}
        keyboardType="number-pad"
        selectTextOnFocus
        style={fieldStyle}
      />
      <Input
        value={rpe}
        onChangeText={setRpe}
        onBlur={() => persist()}
        keyboardType="decimal-pad"
        placeholder="—"
        selectTextOnFocus
        style={fieldStyle}
      />
      <Pressable
        onPress={toggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: completed }}
        accessibilityLabel={`Serie ${index + 1} hecha`}
        style={[styles.colCheck, styles.check, { backgroundColor: completed ? theme.success : theme.backgroundSelected }]}>
        <ThemedText style={{ color: completed ? '#fff' : theme.textSecondary, fontWeight: 700 }}>✓</ThemedText>
      </Pressable>
    </Row>
  );
}

const styles = StyleSheet.create({
  headerRow: { marginTop: Spacing.one },
  colIndex: { width: 20, alignItems: 'center' },
  colPrev: { width: 58, textAlign: 'center' },
  col: { flex: 1, textAlign: 'center' },
  colCheck: { width: 44 },
  field: { paddingHorizontal: 6, paddingVertical: 10 },
  check: { height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rest: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    maxWidth: MaxContentWidth - Spacing.three * 2,
    marginHorizontal: 'auto',
    bottom: Spacing.five,
    borderRadius: 16,
    padding: Spacing.three,
    alignItems: 'center',
  },
});
