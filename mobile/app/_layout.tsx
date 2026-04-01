import { Stack } from 'expo-router';
import { AuthProvider } from '../src/hooks/useAuth';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="task/[id]" options={{ presentation: 'card' }} />
          <Stack.Screen name="course/[id]" options={{ presentation: 'card' }} />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
