import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { GatewayError, fetchFeed, type FeedCard } from '../api/client';
import { getGatewayUrl, getToken } from '../pairing';
import { palette } from '../theme';

interface Props {
  onAskAbout: (prompt: string) => void;
  onNeedPairing: () => void;
}

// Editorial briefing stream. Cards come from GET /mobile/feed, written by
// Hermes on schedule. Every card links its source; nothing is fabricated in
// the app. Tapping a card deep-links into Chat with "tell me more".
export default function FeedScreen({ onAskAbout, onNeedPairing }: Props) {
  const [cards, setCards] = useState<FeedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [base, token] = await Promise.all([getGatewayUrl(), getToken()]);
    if (!base || !token) {
      setLoading(false);
      onNeedPairing();
      return;
    }
    try {
      setCards(await fetchFeed(base, token));
    } catch (e) {
      setError(e instanceof GatewayError ? e.message : 'Could not load the feed.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onNeedPairing]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={palette.accent} />
        <Text style={styles.dim}>Loading today's brief…</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.root}
      data={cards}
      keyExtractor={(c) => c.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={palette.accent} />}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.dim}>
            {error ?? 'No briefs yet. Hermes publishes a morning brief and an evening wrap — check back after the next scheduled run.'}
          </Text>
          {error && (
            <Pressable style={styles.retry} onPress={() => void load()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          )}
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.kind}>{item.kind}</Text>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.summary}>{item.summary}</Text>
          <View style={styles.row}>
            <Pressable onPress={() => void Linking.openURL(item.source_url)}>
              <Text style={styles.source}>Source: {item.source_label}</Text>
            </Pressable>
            <Pressable style={styles.ask} onPress={() => onAskAbout(item.prompt || `Tell me more about: ${item.title}`)}>
              <Text style={styles.askText}>Tell me more</Text>
            </Pressable>
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  list: { padding: 14, gap: 12, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  dim: { color: palette.textDim, fontSize: 14, textAlign: 'center', lineHeight: 21 },
  card: { backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border, borderRadius: 14, padding: 14, gap: 6 },
  kind: { color: palette.accent, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  title: { color: palette.text, fontSize: 17, fontWeight: '700', lineHeight: 23 },
  summary: { color: palette.textDim, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  source: { color: palette.textDim, fontSize: 13, textDecorationLine: 'underline' },
  ask: { backgroundColor: palette.accentSoft, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7 },
  askText: { color: palette.accent, fontSize: 13, fontWeight: '700' },
  retry: { backgroundColor: palette.accent, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 8 },
  retryText: { color: '#fff', fontWeight: '700' },
});
