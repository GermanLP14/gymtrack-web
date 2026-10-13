import { Colors, ROUTINE_COLOR_COUNT, RoutineColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  return Colors[useColorScheme()];
}

/** Maps a routine color slot to this theme's shade; free workouts (null) are gray. */
export function useRoutineColors() {
  const palette = RoutineColors[useColorScheme()];
  const theme = useTheme();
  return (slot: number | null | undefined) => (slot == null ? theme.textSecondary : palette[slot % ROUTINE_COLOR_COUNT]);
}
