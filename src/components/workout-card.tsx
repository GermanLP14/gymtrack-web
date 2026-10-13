import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, Row } from '@/components/ui';
import { useRoutineColors } from '@/hooks/use-theme';
import { formatDuration, fromDayKey, longDate } from '@/lib/dates';
import { capitalize } from '@/lib/exercisedb';
import type { Workout } from '@/lib/repo';
import { formatNumber } from '@/lib/stats';

/** A finished workout as shown in Historial; opens its detail. */
export function WorkoutCard({ workout: w }: { workout: Workout }) {
  const colorOf = useRoutineColors();
  const sets = w.exercises.flatMap((e) => e.sets);
  const volume = sets.reduce((v, s) => v + s.weight * s.reps, 0);
  const meta = [
    w.finishedAt ? formatDuration(w.finishedAt - w.startedAt) : null,
    `${sets.length} series`,
    `${formatNumber(volume)} kg`,
    w.calories != null ? `${formatNumber(w.calories)} kcal` : null,
  ].filter(Boolean);

  return (
    <Pressable onPress={() => router.push(`/history/${w.id}`)} accessibilityRole="button">
      <Card style={{ borderLeftWidth: 5, borderLeftColor: colorOf(w.color) }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontWeight: 700 }} numberOfLines={1}>
              {w.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {capitalize(longDate(fromDayKey(w.date)))}
            </ThemedText>
          </View>
          {w.aiSummary ? (
            <ThemedText type="small" themeColor="textSecondary">
              ✦ IA
            </ThemedText>
          ) : null}
        </Row>
        <ThemedText type="small" themeColor="textSecondary">
          {meta.join(' · ')}
        </ThemedText>
        {w.exercises.map((e) => (
          <ThemedText key={e.order} type="small" numberOfLines={1}>
            <ThemedText type="smallBold">{capitalize(e.name)}</ThemedText>
            {'  '}
            {e.sets.map((s) => `${s.weight}×${s.reps}`).join('  ')}
          </ThemedText>
        ))}
      </Card>
    </Pressable>
  );
}
