import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { View } from 'react-native';

import { ProfileForm } from '@/components/profile-form';
import { ThemedText } from '@/components/themed-text';
import { Button, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { goBack } from '@/lib/navigation';
import { saveProfile, saveWeight } from '@/lib/body';
import { toDayKey } from '@/lib/dates';
import { setSetting } from '@/lib/repo';

/** First-launch setup: profile for calorie estimates. */
export default function OnboardingScreen() {
  const db = useSQLiteContext();

  const done = async () => {
    await setSetting(db, 'onboarded', '1');
    goBack();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Bienvenido', headerBackVisible: false, gestureEnabled: false }} />
      <View style={{ gap: Spacing.one }}>
        <ThemedText type="subtitle">Plitt Fit</ThemedText>
        <ThemedText themeColor="textSecondary">
          Con estos datos calculamos las calorías que gastás al entrenar. Podés cambiarlos después en Ajustes.
        </ThemedText>
      </View>

      <ProfileForm
        initial={null}
        submitLabel="Empezar"
        onSubmit={async (p) => {
          await saveProfile(db, p);
          await saveWeight(db, toDayKey(new Date()), p.weightKg);
          await done();
        }}
      />
      <Button title="Completar más tarde" variant="ghost" onPress={done} />
    </Screen>
  );
}
