import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { capitalize } from '@/lib/exercisedb';
import type { CoachAction, Recommendation } from '@/lib/progression';
import { formatKg } from '@/lib/stats';

const ICON: Record<CoachAction, string> = {
  start: '●',
  increase: '▲',
  hold: '■',
  decrease: '▼',
  deload: '▼',
};

export function useActionColor(action: CoachAction): string {
  const theme = useTheme();
  return {
    start: theme.textSecondary,
    increase: theme.success,
    hold: theme.tint,
    decrease: theme.warning,
    deload: theme.warning,
  }[action];
}

/** One coach recommendation. `compact` hides the explanation. */
export function CoachCard({ rec, name, compact }: { rec: Recommendation; name?: string; compact?: boolean }) {
  const theme = useTheme();
  const color = useActionColor(rec.action);
  const plan = rec.weight != null ? `${rec.sets} × ${rec.reps} · ${formatKg(rec.weight)}` : `${rec.sets} × ${rec.reps}`;
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border, borderLeftColor: color }]}>
      {name ? (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {capitalize(name)}
        </ThemedText>
      ) : null}
      <View style={styles.header}>
        <ThemedText style={[styles.title, { color }]}>
          {ICON[rec.action]} {rec.title}
        </ThemedText>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {plan}
        </ThemedText>
      </View>
      {!compact ? (
        <ThemedText type="small" themeColor="textSecondary">
          {rec.reason}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, borderLeftWidth: 4, padding: 14, gap: Spacing.one },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  title: { fontSize: 16, fontWeight: 700 },
});
