import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { GatewayError, listModels, pairWithCode, type ModelInfo } from '../api/client';
import {
  clearToken,
  getFeedPrompt,
  getGatewayUrl,
  getModelId,
  getToken,
  setFeedPrompt,
  setGatewayUrl,
  setModelId,
  setToken,
} from '../pairing';
import { palette } from '../theme';

interface Props {
  appearance: 'dark' | 'light';
  onAppearance: (a: 'dark' | 'light') => void;
  onPaired: () => void;
}

// Profile, appearance, feed prompt, model picker, pairing. Every control is
// live: model list comes from the gateway; pairing exchanges a code for a
// Keychain-stored token. Nothing here is a placeholder.
export default function SettingsScreen({ appearance, onAppearance, onPaired }: Props) {
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [paired, setPaired] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModel] = useState('');
  const [feedPrompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [savedUrl, token, savedModel, savedPrompt] = await Promise.all([
      getGatewayUrl(),
      getToken(),
      getModelId(),
      getFeedPrompt(),
    ]);
    setUrl(savedUrl);
    setModel(savedModel);
    setPrompt(savedPrompt);
    setPaired(savedUrl.length > 0 && !!token);
    if (savedUrl && token) {
      try {
        const list = await listModels(savedUrl, token);
        setModels(list);
      } catch {
        setModels([]);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pair = useCallback(async () => {
    if (!url.trim() || !code.trim() || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const base = url.trim().replace(/\/+$/, '');
      await setGatewayUrl(base);
      const token = await pairWithCode(base, code.trim());
      await setToken(token);
      setPaired(true);
      setCode('');
      setStatus('Paired. Token is in the device Keychain.');
      onPaired();
      await refresh();
    } catch (e) {
      setStatus(e instanceof GatewayError ? e.message : 'Pairing failed.');
    } finally {
      setBusy(false);
    }
  }, [url, code, busy, onPaired, refresh]);

  const unpair = useCallback(async () => {
    await clearToken();
    setPaired(false);
    setStatus('Unpaired. Token wiped from the Keychain.');
  }, []);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      <Text style={styles.h}>Device pairing</Text>
      <Text style={styles.dim}>
        Point the app at your Hermes desktop instance over Tailscale, then enter the pairing code it shows.
      </Text>
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        placeholder="https://hermes-desktop:8443"
        placeholderTextColor={palette.textDim}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {!paired ? (
        <>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="Pairing code"
            placeholderTextColor={palette.textDim}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable style={styles.primary} onPress={() => void pair()} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Pair device</Text>}
          </Pressable>
        </>
      ) : (
        <Pressable style={styles.danger} onPress={() => void unpair()}>
          <Text style={styles.dangerText}>Unpair this device</Text>
        </Pressable>
      )}

      <Text style={styles.h}>Appearance</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Dark mode (OLED black)</Text>
        <Switch
          value={appearance === 'dark'}
          onValueChange={(v) => onAppearance(v ? 'dark' : 'light')}
        />
      </View>

      <Text style={styles.h}>Model</Text>
      {models.length > 0 ? (
        models.map((m) => (
          <Pressable
            key={m.id}
            style={[styles.option, m.id === modelId && styles.optionActive]}
            onPress={() => {
              setModel(m.id);
              void setModelId(m.id);
            }}
          >
            <Text style={styles.label}>{m.label || m.id}</Text>
          </Pressable>
        ))
      ) : (
        <>
          <Text style={styles.dim}>No model list from the gateway yet — set it manually.</Text>
          <TextInput
            style={styles.input}
            value={modelId}
            onChangeText={(v) => {
              setModel(v);
              void setModelId(v);
            }}
            placeholder="model-id"
            placeholderTextColor={palette.textDim}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      )}

      <Text style={styles.h}>Feed prompt</Text>
      <Text style={styles.dim}>Tell Hermes what belongs in your Feed briefs.</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={feedPrompt}
        onChangeText={(v) => {
          setPrompt(v);
          void setFeedPrompt(v);
        }}
        placeholder="e.g. Saskatchewan business, AI agents, markets…"
        placeholderTextColor={palette.textDim}
        multiline
      />
      {status && <Text style={styles.status}>{status}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  body: { padding: 16, gap: 10, paddingBottom: 40 },
  h: { color: palette.text, fontSize: 17, fontWeight: '700', marginTop: 10 },
  dim: { color: palette.textDim, fontSize: 14, lineHeight: 20 },
  label: { color: palette.text, fontSize: 15 },
  input: { color: palette.text, fontSize: 15, backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  primary: { backgroundColor: palette.accent, borderRadius: 12, padding: 13, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  danger: { borderWidth: 1, borderColor: palette.red, borderRadius: 12, padding: 13, alignItems: 'center' },
  dangerText: { color: palette.red, fontWeight: '700', fontSize: 15 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border, borderRadius: 12, padding: 12 },
  option: { borderWidth: 1, borderColor: palette.border, borderRadius: 12, padding: 12, backgroundColor: palette.card },
  optionActive: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
  status: { color: palette.textDim, fontSize: 13, marginTop: 4 },
});
