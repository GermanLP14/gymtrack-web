import type Anthropic from '@anthropic-ai/sdk';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';

import { AiError } from './ai';
import { runCoachTurn, type RoutineProposal } from './coach-agent';

/**
 * The coach conversation lives in memory for the whole app session, so leaving
 * the chat and coming back keeps it. "Nueva conversación" starts over.
 */

export type ProposalStatus = 'pending' | 'applied' | 'declined' | 'cancelled';

export type ChatItem =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; text: string }
  | { id: number; kind: 'activity'; text: string }
  | { id: number; kind: 'error'; text: string }
  | { id: number; kind: 'proposal'; proposal: RoutineProposal; status: ProposalStatus };

type ChatState = { items: ChatItem[]; busy: boolean };

let state: ChatState = { items: [], busy: false };
/** What Claude sees: full API turns, including thinking and tool blocks the UI hides. */
let apiMessages: Anthropic.Beta.BetaMessageParam[] = [];
/** Bumped by reset(), so a turn still running for an old conversation is ignored. */
let generation = 0;
let nextId = 1;
const pendingAnswers = new Map<number, (approved: boolean) => void>();
const listeners = new Set<() => void>();

function set(next: Partial<ChatState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

type NewItem = ChatItem extends infer T ? (T extends ChatItem ? Omit<T, 'id'> : never) : never;

function push(item: NewItem) {
  // The activity line is transient: it is replaced by whatever comes next.
  const items = state.items.filter((i) => i.kind !== 'activity');
  set({ items: [...items, { ...item, id: nextId++ } as ChatItem] });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useCoachChat(): ChatState {
  return useSyncExternalStore(subscribe, () => state);
}

export async function sendCoachMessage(db: SQLiteDatabase, text: string) {
  const trimmed = text.trim();
  if (!trimmed || state.busy) return;
  const gen = generation;
  const isCancelled = () => gen !== generation;

  push({ kind: 'user', text: trimmed });
  set({ busy: true });
  // Work on a copy: if the turn fails halfway, the stored history stays valid.
  const messages = [...apiMessages, { role: 'user' as const, content: trimmed }];
  try {
    await runCoachTurn(db, messages, {
      isCancelled,
      onEvent: (e) => {
        if (isCancelled()) return;
        push(e.type === 'text' ? { kind: 'assistant', text: e.text } : { kind: 'activity', text: e.text });
      },
      confirm: (proposal) =>
        new Promise<boolean>((resolve) => {
          if (isCancelled()) return resolve(false);
          const id = nextId;
          push({ kind: 'proposal', proposal, status: 'pending' });
          pendingAnswers.set(id, resolve);
        }),
    });
    if (!isCancelled()) apiMessages = messages;
  } catch (e) {
    if (isCancelled()) return;
    // Keep the history consistent: a failed turn is dropped as if never sent.
    push({ kind: 'error', text: e instanceof AiError ? e.message : 'Algo salió mal al hablar con el coach. Probá de nuevo.' });
  } finally {
    if (!isCancelled()) set({ busy: false, items: state.items.filter((i) => i.kind !== 'activity') });
  }
}

/** The user's answer to a proposed routine change. */
export function answerProposal(itemId: number, approved: boolean) {
  const resolve = pendingAnswers.get(itemId);
  if (!resolve) return;
  pendingAnswers.delete(itemId);
  set({
    items: state.items.map((i) =>
      i.id === itemId && i.kind === 'proposal' ? { ...i, status: approved ? 'applied' : 'declined' } : i,
    ),
  });
  resolve(approved);
}

export function resetCoachChat() {
  generation++;
  pendingAnswers.forEach((resolve) => resolve(false));
  pendingAnswers.clear();
  apiMessages = [];
  set({ items: [], busy: false });
}
