import { Tabs } from 'expo-router';
import { Text, View, StyleSheet, Platform } from 'react-native';

function TabIcon({ name }: { name: string }) {
  const icons: Record<string, string> = {
    index: '📋',
    courses: '📚',
    profile: '👤',
  };
  
  return (
    <View style={styles.tabIcon}>
      <Text style={styles.iconText}>{icons[name] || '📄'}</Text>
    </View>
  );
}

export default function TabsLayout() {
  const bottomPadding = Platform.OS === 'ios' ? 20 : 8;
  
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#2563eb',
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopWidth: 1,
          borderTopColor: '#f3f4f6',
          paddingTop: 6,
          paddingBottom: bottomPadding,
          height: 56 + bottomPadding,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500' as const,
        },
        headerStyle: {
          backgroundColor: '#fff',
        },
        headerTitleStyle: {
          fontWeight: '600' as const,
          color: '#1f2937',
        },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '我的DDL',
          headerShown: false,
          tabBarIcon: () => <TabIcon name="index" />,
        }}
      />
      <Tabs.Screen
        name="courses"
        options={{
          title: '课程',
          tabBarIcon: () => <TabIcon name="courses" />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
          tabBarIcon: () => <TabIcon name="profile" />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 22,
  },
});
