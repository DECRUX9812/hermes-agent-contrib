import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { GatewayError, listSessions, streamChat, type ChatMessage, type ChatSession } from '../api/client';
import { getGatewayUrl, getToken } from '../pairing';
import { palette } from '../theme';

interface Props {
  askAbout: string | null;
  onAskConsumed: () => void;
  onNeedPairing: () => void;
}

export default function ChatScreen({ askAbout, onAskConsumed, onNeedPairing }: Props) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionId, setSessionId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [base, token] = await Promise.all([getGatewayUrl(), getToken()]);
    if (!base || !token) {
      setLoading(false);
      onNeedPairing();
      return;
    }
    try {
      const list = await listSessions(base, token);
      setSessions(list);
      if (list.length > 0 && list[0]) setSessionId((s) => s || list[0].id);
    } catch (e) {
      setError(e instanceof GatewayError ? e.message : 'Could not reach the gateway.');
    } finally {
      setLoading(false);
    }
  }, [onNeedPairing]);

  useEffect(() => {
    void load();
  }, [load]);

  // Feed deep-link: "tell me more about this" arrives as a prefilled question.
  useEffect(() => {
    if (askAbout) {
      setDraft(askAbout);
      onAskConsumed();
    }
  }, [askAbout, onAskConsumed]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    const [base, token] = await Promise.all([getGatewayUrl(), getToken()]);
    if (!base || !token) {
      onNeedPairing();
      return;
    }
    const activeSession = sessionId || `mobile-${Date.now()}`;
    setSessionId(activeSession);
    setMessages((m) => [...m, { role: 'user', text }]);
    setDraft('');
    setSending(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    let assistantSoFar = '';
    setMessages((m) => [...m, { role: 'assistant', text: '' }]);
    try {
      await streamChat(base, token, activeSession, text, (soFar) => {
        assistantSoFar = soFar;
        setMessages((m) => {
          const next = [...m];
          next[next.length - 1] = { role: 'assistant', text: soFar };
          return next;
        });
      }, controller.signal);
      if (assistantSoFar.trim().length === 0) {
        throw new GatewayError(502, 'Gateway returned an empty reply. Nothing was fabricated locally.');
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // Keep the partial text; user stopped it deliberately.
      } else {
        const msg = e instanceof GatewayError ? e.message : 'Send failed.';
        setError(msg);
        setMessages((m) => m.slice(0, -1));
      }
    } finally {
      setSending(false);
      abortRef.current = null;
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [draft, sending, sessionId, onNeedPairing]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={palette.accent} />
        <Text style={styles.dim}>Connecting to Hermes…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {sessions.length > 1 && (
        <View style={styles.sessionRow}>
          <FlatList
            horizontal
            data={sessions}
            keyExtractor={(s) => s.id}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  setSessionId(item.id);
                  setMessages([]);
                }}
                style={[styles.sessionChip, item.id === sessionId && styles.sessionChipActive]}
              >
                <Text
                  style={[styles.sessionChipText, item.id === sessionId && styles.sessionChipTextActive]}
                  numberOfLines={1}
                >
                  {item.title || 'Untitled'}
                </Text>
              </Pressable>
            )}
          />
        </View>
      )}
      {error && (
        <Pressable style={styles.errorBar} onPress={() => void load()}>
          <Text style={styles.errorText}>{error} — tap to retry.</Text>
        </Pressable>
      )}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.dim}>No messages yet.</Text>
            <Text style={styles.dim}>Say hello — your Hermes answers, streamed live.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.role === 'user' ? styles.me : styles.them]}>
            <Text style={styles.bubbleText} selectable>
              {item.text}
            </Text>
          </View>
        )}
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message Hermes…"
          placeholderTextColor={palette.textDim}
          multiline
          editable={!sending}
          onSubmitEditing={() => void send()}
        />
        {sending ? (
          <Pressable style={styles.stopBtn} onPress={() => abortRef.current?.abort()}>
            <Text style={styles.sendText}>Stop</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.sendBtn, draft.trim().length === 0 && styles.sendBtnIdle]} onPress={() => void send()}>
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  dim: { color: palette.textDim, fontSize: 14, textAlign: 'center' },
  sessionRow: { borderBottomWidth: 1, borderBottomColor: palette.border, paddingVertical: 8, paddingLeft: 12 },
  sessionChip: { borderWidth: 1, borderColor: palette.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8 },
  sessionChipActive: { backgroundColor: palette.accentSoft, borderColor: palette.accent },
  sessionChipText: { color: palette.textDim, fontSize: 13, maxWidth: 160 },
  sessionChipTextActive: { color: palette.text },
  errorBar: { backgroundColor: 'rgba(248,113,113,0.12)', padding: 10, borderBottomWidth: 1, borderBottomColor: palette.border },
  errorText: { color: palette.red, fontSize: 13 },
  list: { padding: 14, gap: 10, flexGrow: 1 },
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9 },
  me: { alignSelf: 'flex-end', backgroundColor: palette.bubbleMe },
  them: { alignSelf: 'flex-start', backgroundColor: palette.bubbleThem, borderWidth: 1, borderColor: palette.border },
  bubbleText: { color: palette.text, fontSize: 16, lineHeight: 23 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.bgRaised },
  input: { flex: 1, color: palette.text, fontSize: 16, maxHeight: 120, backgroundColor: palette.card, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 },
  sendBtn: { backgroundColor: palette.accent, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  sendBtnIdle: { opacity: 0.45 },
  stopBtn: { backgroundColor: palette.card, borderWidth: 1, borderColor: palette.red, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  sendText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
