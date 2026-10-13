import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Input, Row } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { syncNow, useSyncStatus } from '@/lib/sync';

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Account and status for syncing this device with the user's other devices. */
export function SyncSettings() {
  const theme = useTheme();
  const status = useSyncStatus();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'in' | 'up' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!supabase) {
    return (
      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          Falta configurar Supabase: cargá EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY en el archivo .env
          (ver README) y volvé a generar la app.
        </ThemedText>
      </Card>
    );
  }
  const client = supabase;

  if (status.email) {
    return (
      <Card>
        <ThemedText style={{ fontWeight: 700 }}>{status.email}</ThemedText>
        {status.error ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            No se pudo sincronizar: {status.error}
          </ThemedText>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {status.syncing
              ? 'Sincronizando…'
              : status.lastSyncAt
                ? `Sincronizado a las ${formatTime(status.lastSyncAt)}`
                : 'Todavía no se sincronizó'}
          </ThemedText>
        )}
        <ThemedText type="small" themeColor="textSecondary">
          Rutinas, entrenamientos terminados, peso y perfil se copian solos entre tus dispositivos. Las fotos de progreso quedan
          en el dispositivo donde las cargaste.
        </ThemedText>
        <Row style={{ justifyContent: 'space-between' }}>
          <Button title="Sincronizar ahora" small variant="secondary" loading={status.syncing} onPress={() => syncNow()} />
          <Button title="Cerrar sesión" small variant="ghost" onPress={() => client.auth.signOut()} />
        </Row>
      </Card>
    );
  }

  const submit = async (mode: 'in' | 'up') => {
    setBusy(mode);
    setMessage(null);
    try {
      const credentials = { email: email.trim(), password };
      const { data, error } =
        mode === 'in' ? await client.auth.signInWithPassword(credentials) : await client.auth.signUp(credentials);
      if (error) setMessage(error.message);
      else if (!data.session) setMessage('Te mandamos un mail para confirmar la cuenta. Confirmala y después iniciá sesión.');
      else setPassword('');
    } finally {
      setBusy(null);
    }
  };

  const incomplete = !email.trim() || password.length < 6;
  return (
    <Card>
      <ThemedText type="small" themeColor="textSecondary">
        Iniciá sesión con la misma cuenta en el celular y en la web para ver los mismos datos en los dos.
      </ThemedText>
      <Input
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Input value={password} onChangeText={setPassword} placeholder="Contraseña (mínimo 6 caracteres)" secureTextEntry />
      {message ? <ThemedText type="small">{message}</ThemedText> : null}
      <Row>
        <Button title="Iniciar sesión" small loading={busy === 'in'} disabled={incomplete} onPress={() => submit('in')} style={{ flex: 1 }} />
        <Button
          title="Crear cuenta"
          small
          variant="secondary"
          loading={busy === 'up'}
          disabled={incomplete}
          onPress={() => submit('up')}
          style={{ flex: 1 }}
        />
      </Row>
    </Card>
  );
}
