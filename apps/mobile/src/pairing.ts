// Pairing + credential storage. Token lives in iOS Keychain via
// expo-secure-store, never in plaintext files or AsyncStorage.
// Gateway URL (tailnet address) is non-secret and lives in AsyncStorage.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'hermes_gateway_token';
const URL_KEY = 'hermes_gateway_url';
const MODEL_KEY = 'hermes_model_id';
const FEED_PROMPT_KEY = 'hermes_feed_prompt';

export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Already gone; pairing state is what matters.
  }
}

export async function getGatewayUrl(): Promise<string> {
  return (await AsyncStorage.getItem(URL_KEY)) ?? '';
}

export async function setGatewayUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(URL_KEY, url.replace(/\/+$/, ''));
}

export async function getModelId(): Promise<string> {
  return (await AsyncStorage.getItem(MODEL_KEY)) ?? '';
}

export async function setModelId(id: string): Promise<void> {
  await AsyncStorage.setItem(MODEL_KEY, id);
}

export async function getFeedPrompt(): Promise<string> {
  return (await AsyncStorage.getItem(FEED_PROMPT_KEY)) ?? '';
}

export async function setFeedPrompt(prompt: string): Promise<void> {
  await AsyncStorage.setItem(FEED_PROMPT_KEY, prompt);
}

export async function isPaired(): Promise<boolean> {
  const [url, token] = await Promise.all([getGatewayUrl(), getToken()]);
  return url.length > 0 && token !== null && token.length > 0;
}
