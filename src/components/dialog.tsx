import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type AlertButton = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void | Promise<void>;
};

type Request = { title: string; message?: string; buttons: AlertButton[] };

let enqueue: ((request: Request) => void) | null = null;

/**
 * Drop-in for React Native's `Alert`, which does nothing on web. Dialogs are
 * rendered by `<DialogHost />`, mounted once in the root layout.
 */
export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]) {
    enqueue?.({ title, message, buttons: buttons?.length ? buttons : [{ text: 'Aceptar' }] });
  },
};

export function DialogHost() {
  const theme = useTheme();
  const [queue, setQueue] = useState<Request[]>([]);

  useEffect(() => {
    enqueue = (request) => setQueue((q) => [...q, request]);
    return () => {
      enqueue = null;
    };
  }, []);

  const current = queue[0];
  const choose = (button?: AlertButton) => {
    setQueue((q) => q.slice(1));
    void button?.onPress?.();
  };
  // Escape or a click outside counts as the cancel button.
  const dismiss = () => choose(current?.buttons.find((b) => b.style === 'cancel'));

  return (
    <Modal visible={current != null} transparent animationType="fade" onRequestClose={dismiss}>
      <Pressable style={styles.backdrop} onPress={dismiss} accessibilityLabel="Cerrar">
        {current ? (
          <Pressable
            style={[styles.dialog, { backgroundColor: theme.backgroundElement, borderColor: theme.border, boxShadow: theme.shadow }]}
            accessibilityRole="alert">
            <ThemedText style={{ fontWeight: 700, fontSize: 18 }}>{current.title}</ThemedText>
            {current.message ? <ThemedText themeColor="textSecondary">{current.message}</ThemedText> : null}
            <View style={[styles.buttons, current.buttons.length > 2 && { flexDirection: 'column' }]}>
              {current.buttons.map((b) => (
                <Button
                  key={b.text}
                  title={b.text}
                  small
                  variant={b.style === 'destructive' ? 'danger' : b.style === 'cancel' ? 'secondary' : 'primary'}
                  onPress={() => choose(b)}
                />
              ))}
            </View>
          </Pressable>
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 6, 10, 0.55)',
    backdropFilter: 'blur(4px)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    padding: Spacing.four,
    gap: Spacing.two,
    cursor: 'auto',
  },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
});
