import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { CoachCard } from '@/components/coach-card';
import { Alert } from '@/components/dialog';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Row, Screen, SectionTitle, StatTile } from '@/components/ui';
import { useFocusData } from '@/hooks/use-focus-data';
import { SidebarBreakpoint, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getEffectiveProfile } from '@/lib/body';
import { basalSoFar } from '@/lib/calories';
import { longDate, toDayKey } from '@/lib/dates';
import { capitalize } from '@/lib/exercisedb';
import {
  getActiveWorkoutId,
  getCoachOverview,
  getSetting,
  listRoutines,
  startWorkout,
  weeklyVolume,
  workoutCaloriesForDay,
} from '@/lib/repo';
import { formatNumber } from '@/lib/stats';

export default function TodayScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [starting, setStarting] = useState<number | 'free' | null>(null);
  // On wide screens Ajustes lives in the sidebar.
  const wide = useWindowDimensions().width >= SidebarBreakpoint;

  const askedOnboarding = useRef(false);

  const { data } = useFocusData(
    useCallback(async () => {
      const [activeId, routines, weeks, coach, profile, workoutKcal, onboarded] = await Promise.all([
        getActiveWorkoutId(db),
        listRoutines(db),
        weeklyVolume(db, 2),
        getCoachOverview(db),
        getEffectiveProfile(db),
        workoutCaloriesForDay(db, toDayKey(new Date())),
        getSetting(db, 'onboarded'),
      ]);
      // First launch: ask for the profile once (the user can skip it). Decided here, on
      // freshly read data and only while this tab is in front, so opening another page
      // directly (with this tab underneath) does not stack a second onboarding on it.
      if (!onboarded && !profile && !askedOnboarding.current) {
        askedOnboarding.current = true;
        router.push('/onboarding');
      }
      return { activeId, routines, thisWeek: weeks[1], lastWeek: weeks[0], coach, profile, workoutKcal };
    }, [db]),
  );

  const begin = async (routineId: number | null) => {
    if (data?.activeId) {
      Alert.alert('Entrenamiento en curso', 'Terminá o descartá el entrenamiento actual antes de empezar otro.', [
        { text: 'Ir al actual', onPress: () => router.push(`/workout/${data.activeId}`) },
        { text: 'Cancelar', style: 'cancel' },
      ]);
      return;
    }
    setStarting(routineId ?? 'free');
    try {
      const id = await startWorkout(db, routineId);
      router.push(`/workout/${id}`);
    } finally {
      setStarting(null);
    }
  };

  const volumeDelta =
    data && data.lastWeek.volume > 0 ? ((data.thisWeek.volume - data.lastWeek.volume) / data.lastWeek.volume) * 100 : null;

  return (
    <Screen tabs>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View>
          <ThemedText type="subtitle">Hoy</ThemedText>
          <ThemedText themeColor="textSecondary">{capitalize(longDate(new Date()))}</ThemedText>
        </View>
        {wide ? null : (
          <Row>
            <Pressable
              onPress={() => router.push('/coach')}
              accessibilityRole="button"
              accessibilityLabel="Coach IA"
              hitSlop={10}
              style={[styles.gear, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <ThemedText style={{ fontSize: 20 }}>💬</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => router.push('/settings')}
              accessibilityRole="button"
              accessibilityLabel="Ajustes"
              hitSlop={10}
              style={[styles.gear, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <ThemedText style={{ fontSize: 20 }}>⚙️</ThemedText>
            </Pressable>
          </Row>
        )}
      </Row>

      <Pressable onPress={() => router.push('/coach')} accessibilityRole="button">
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
          <ThemedText style={{ fontSize: 28 }}>💬</ThemedText>
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontWeight: 700 }}>Hablá con tu coach IA</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Consultale sobre tus rutinas, pesos y progreso. Puede ajustar tus rutinas con tu confirmación.
            </ThemedText>
          </View>
          <ThemedText themeColor="textSecondary" style={{ fontSize: 20 }}>
            ›
          </ThemedText>
        </Card>
      </Pressable>

      <Card>
        <ThemedText type="smallBold" themeColor="textSecondary" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Calorías gastadas hoy
        </ThemedText>
        {data?.profile ? (
          <>
            <ThemedText style={styles.hero}>{formatNumber(data.workoutKcal)} kcal</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              🏋️ En tus entrenamientos de hoy
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Con tu metabolismo basal hasta ahora: {formatNumber(data.workoutKcal + basalSoFar(data.profile, new Date()))} kcal
            </ThemedText>
          </>
        ) : (
          <>
            <ThemedText themeColor="textSecondary">
              Completá tu edad, altura y peso para calcular las calorías de tus entrenamientos.
            </ThemedText>
            <Button title="Completar perfil" small onPress={() => router.push('/settings')} />
          </>
        )}
      </Card>

      {data?.activeId ? (
        <Card style={{ borderWidth: 1, borderColor: theme.accent }}>
          <ThemedText style={{ fontWeight: 700 }}>Tenés un entrenamiento en curso</ThemedText>
          <Button title="Continuar entrenamiento" onPress={() => router.push(`/workout/${data.activeId}`)} />
        </Card>
      ) : null}

      <SectionTitle>Esta semana</SectionTitle>
      <Row>
        <StatTile
          label="Entrenamientos"
          value={String(data?.thisWeek.workouts ?? 0)}
          hint={`${data?.lastWeek.workouts ?? 0} la anterior`}
        />
        <StatTile
          label="Volumen"
          value={`${formatNumber(data?.thisWeek.volume ?? 0)} kg`}
          hint={
            volumeDelta != null ? `${volumeDelta >= 0 ? '▲' : '▼'} ${Math.abs(volumeDelta).toFixed(0)} % vs anterior` : undefined
          }
        />
      </Row>

      <SectionTitle>Empezar a entrenar</SectionTitle>
      {data && data.routines.length === 0 ? (
        <EmptyState
          title="Todavía no tenés rutinas"
          body="Armá una rutina para que el coach te prepare pesos y repeticiones en cada sesión."
          action={<Button title="Crear rutina" small onPress={() => router.push('/routine/edit')} />}
        />
      ) : (
        data?.routines.map((r) => (
          <Button
            key={r.id}
            title={`${r.name} · ${r.exerciseCount} ejercicios`}
            variant="secondary"
            loading={starting === r.id}
            disabled={r.exerciseCount === 0}
            onPress={() => begin(r.id)}
          />
        ))
      )}
      <Button title="Entrenamiento libre" variant="ghost" loading={starting === 'free'} onPress={() => begin(null)} />

      <SectionTitle>Coach de sobrecarga progresiva</SectionTitle>
      {data && data.coach.length === 0 ? (
        <EmptyState
          title="Sin recomendaciones todavía"
          body="Después de tu primer entrenamiento vas a ver acá qué ejercicios subir, mantener o bajar."
        />
      ) : (
        data?.coach.slice(0, 6).map((c) => <CoachCard key={c.exerciseId} name={c.name} rec={c.recommendation} compact />)
      )}
      {data && data.coach.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Tocá Estadísticas para ver el detalle y la explicación de cada recomendación.
        </ThemedText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { fontSize: 44, lineHeight: 50, fontWeight: 700 },
  gear: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
