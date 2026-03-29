import { Slot } from 'expo-router';
import { AuthProvider } from '../src/hooks/useAuth';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <Slot />
    </AuthProvider>
  );
}
