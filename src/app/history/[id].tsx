import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Alert } from '@/components/dialog';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Row, Screen, SectionTitle, StatTile } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useFocusData } from '@/hooks/use-focus-data';
import { useRoutineColors, useTheme } from '@/hooks/use-theme';
import { goBack } from '@/lib/navigation';
import { AiError, generateWorkoutSummary, getApiKey, type AiModel } from '@/lib/ai';
import { compareWorkouts, formatSets, type CompareStatus } from '@/lib/compare';
import { formatDuration, fromDayKey, longDate, shortDate } from '@/lib/dates';
import { capitalize } from '@/lib/exercisedb';
import { deleteWorkout, getPreviousRoutineWorkout, getSetting, getWorkout, setWorkoutSummary } from '@/lib/repo';
import { formatNumber } from '@/lib/stats';

const STATUS: Record<CompareStatus, { icon: string; label: string }> = {
  up: { icon: '▲', label: 'Mejoraste' },
  same: { icon: '■', label: 'Igualaste' },
  down: { icon: '▼', label: 'No igualaste' },
  mixed: { icon: '◆', label: 'Mixto' },
  new: { icon: '●', label: 'Primera vez' },
};

export default function HistoryDetailScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const colorOf = useRoutineColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const workoutId = Number(id);

  const { data, reload } = useFocusData(
    useCallback(async () => {
      const workout = await getWorkout(db, workoutId);
      if (!workout) return null;
      const [previous, apiKey, model, auto] = await Promise.all([
        getPreviousRoutineWorkout(db, workout),
        getApiKey(),
        getSetting(db, 'aiModel'),
        getSetting(db, 'aiAuto'),
      ]);
      return {
        workout,
        previous,
        comparisons: compareWorkouts(workout, previous),
        ai: { configured: !!apiKey, model: (model ?? 'claude-opus-5') as AiModel, auto: auto !== '0' },
      };
    }, [db, workoutId]),
  );

  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const autoTried = useRef(false);

  const generate = useCallback(async () => {
    if (!data) return;
    setGenerating(true);
    setAiError(null);
    try {
      const { workout, previous, comparisons } = data;
      const summary = await generateWorkoutSummary(data.ai.model, {
        routineName: workout.name,
        date: workout.date,
        durationMs: (workout.finishedAt ?? workout.startedAt) - workout.startedAt,
        previousDate: previous?.date ?? null,
        comparisons,
      });
      await setWorkoutSummary(db, workout.id, summary);
      await reload();
    } catch (e) {
      setAiError(e instanceof AiError ? e.message : 'No se pudo generar el resumen.');
    } finally {
      setGenerating(false);
    }
  }, [data, db, reload]);

  // Generate once automatically for a workout that has no summary yet.
  useEffect(() => {
    if (!data || autoTried.current) return;
    if (data.ai.configured && data.ai.auto && !data.workout.aiSummary && data.workout.finishedAt) {
      // Deferred so the request starts after this render commits; marked as tried
      // only when it actually fires, so a cancelled timer can run again.
      const t = setTimeout(() => {
        autoTried.current = true;
        void generate();
      }, 0);
      return () => clearTimeout(t);
    }
  }, [data, generate]);

  if (!data) return <Screen>{null}</Screen>;
  const { workout: w, previous, comparisons } = data;
  const sets = w.exercises.flatMap((e) => e.sets);
  const volume = sets.reduce((v, s) => v + s.weight * s.reps, 0);

  const remove = () =>
    Alert.alert('Eliminar entrenamiento', 'Se borra del historial junto con todas sus series.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          await deleteWorkout(db, w.id);
          goBack();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: w.name }} />
      <View style={{ borderLeftWidth: 5, borderLeftColor: colorOf(w.color), paddingLeft: Spacing.two }}>
        <ThemedText type="subtitle" style={{ fontSize: 26, lineHeight: 32 }}>
          {w.name}
        </ThemedText>
        <ThemedText themeColor="textSecondary">{capitalize(longDate(fromDayKey(w.date)))}</ThemedText>
      </View>

      <Row>
        <StatTile label="Duración" value={w.finishedAt ? formatDuration(w.finishedAt - w.startedAt) : '—'} />
        <StatTile label="Calorías" value={w.calories != null ? `${formatNumber(w.calories)} kcal` : '—'} />
      </Row>
      <Row>
        <StatTile label="Volumen" value={`${formatNumber(volume)} kg`} />
        <StatTile label="Series" value={String(sets.length)} />
      </Row>
      {w.calories == null ? (
        <ThemedText type="small" themeColor="textSecondary">
          Completá tu perfil en Ajustes para calcular las calorías de los próximos entrenamientos.
        </ThemedText>
      ) : null}

      <SectionTitle>Resumen de la IA</SectionTitle>
      <Card>
        {w.aiSummary ? (
          <ThemedText>{w.aiSummary}</ThemedText>
        ) : generating ? (
          <Row>
            <ActivityIndicator />
            <ThemedText themeColor="textSecondary">Analizando tu entrenamiento…</ThemedText>
          </Row>
        ) : data.ai.configured ? (
          <ThemedText themeColor="textSecondary">
            Generá un resumen de tu rendimiento comparado con la vez anterior y consejos para la semana.
          </ThemedText>
        ) : (
          <ThemedText themeColor="textSecondary">
            Conectá Claude en Ajustes con tu API key de Anthropic para recibir un resumen y consejos después de cada
            entrenamiento.
          </ThemedText>
        )}
        {aiError ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {aiError}
          </ThemedText>
        ) : null}
        {data.ai.configured ? (
          <Button
            title={w.aiSummary ? 'Regenerar resumen' : 'Generar resumen'}
            small
            variant="secondary"
            loading={generating}
            onPress={generate}
          />
        ) : (
          <Button title="Ir a Ajustes" small variant="secondary" onPress={() => router.push('/settings')} />
        )}
      </Card>

      <SectionTitle>{previous ? `Comparado con el ${shortDate(fromDayKey(previous.date))}` : 'Ejercicios y series'}</SectionTitle>
      {comparisons.map((c) => {
        const st = STATUS[c.status];
        const color =
          c.status === 'up'
            ? theme.success
            : c.status === 'down'
              ? theme.danger
              : c.status === 'mixed'
                ? theme.warning
                : theme.textSecondary;
        return (
          <Card key={c.exerciseId}>
            <Row style={{ justifyContent: 'space-between' }}>
              <ThemedText style={{ fontWeight: 700, flex: 1 }} numberOfLines={2}>
                {capitalize(c.name)}
              </ThemedText>
              {previous ? (
                <ThemedText type="smallBold" style={{ color }}>
                  {st.icon} {st.label}
                </ThemedText>
              ) : null}
            </Row>
            <ThemedText type="small">Hoy: {formatSets(c.today)}</ThemedText>
            {c.previous ? (
              <ThemedText type="small" themeColor="textSecondary">
                Antes: {formatSets(c.previous)}
              </ThemedText>
            ) : null}
          </Card>
        );
      })}

      <Button title="Editar series" variant="secondary" onPress={() => router.push(`/workout/${w.id}`)} />
      <Button title="Eliminar entrenamiento" variant="ghost" onPress={remove} />
    </Screen>
  );
}
