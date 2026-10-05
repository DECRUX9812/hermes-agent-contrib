import { useCallback, useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import ChatScreen from './src/screens/ChatScreen';
import FeedScreen from './src/screens/FeedScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { palette } from './src/theme';

type Tab = 'chat' | 'feed' | 'settings';

export default function App() {
  const system = useColorScheme();
  const [appearance, setAppearance] = useState<'dark' | 'light'>('dark');
  const [tab, setTab] = useState<Tab>('chat');
  const [askAbout, setAskAbout] = useState<string | null>(null);

  void system; // System-follow is a future step; dark-first per the mission.
  const goToPairing = useCallback(() => setTab('settings'), []);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style={appearance === 'dark' ? 'light' : 'dark'} />
      <View style={styles.body}>
        {tab === 'chat' && (
          <ChatScreen
            askAbout={askAbout}
            onAskConsumed={() => setAskAbout(null)}
            onNeedPairing={goToPairing}
          />
        )}
        {tab === 'feed' && (
          <FeedScreen
            onAskAbout={(prompt) => {
              setAskAbout(prompt);
              setTab('chat');
            }}
            onNeedPairing={goToPairing}
          />
        )}
        {tab === 'settings' && (
          <SettingsScreen appearance={appearance} onAppearance={setAppearance} onPaired={() => setTab('chat')} />
        )}
      </View>
      <View style={styles.tabs}>
        {(
          [
            ['chat', 'Chat'],
            ['feed', 'Feed'],
            ['settings', 'Settings'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <Pressable key={id} style={styles.tab} onPress={() => setTab(id)}>
            <Text style={[styles.tabText, tab === id && styles.tabTextActive]}>{label}</Text>
            {tab === id && <View style={styles.tabDot} />}
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  body: { flex: 1 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.bgRaised, paddingBottom: 18, paddingTop: 8 },
  tab: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 4 },
  tabText: { color: palette.textDim, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: palette.text },
  tabDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: palette.accent },
});
