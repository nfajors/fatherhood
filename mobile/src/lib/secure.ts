/** Small secrets (the session token) in the iOS Keychain / Android Keystore. The web build keeps them in localStorage. */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const web = Platform.OS === "web";

export async function getSecure(key: string): Promise<string | null> {
  if (web) return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

export async function setSecure(key: string, value: string): Promise<void> {
  if (web) return globalThis.localStorage?.setItem(key, value);
  await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
}

export async function deleteSecure(key: string): Promise<void> {
  if (web) return globalThis.localStorage?.removeItem(key);
  await SecureStore.deleteItemAsync(key);
}
