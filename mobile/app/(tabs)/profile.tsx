import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../src/hooks/useAuth';

export default function ProfileScreen() {
  const { user, logout } = useAuth();

  const handleLogout = () => {
    Alert.alert('确认登出', '确定要退出登录吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '确定',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const getKarmaLevel = (karma: number) => {
    if (karma >= 50) return { label: '信誉卓著', color: '#16a34a' };
    if (karma >= 20) return { label: '活跃贡献者', color: '#2563eb' };
    if (karma >= 0) return { label: '普通用户', color: '#6b7280' };
    return { label: '需要改进', color: '#dc2626' };
  };

  const karmaLevel = user ? getKarmaLevel(user.karma) : null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.nickname?.[0] || '?'}</Text>
        </View>
        <Text style={styles.nickname}>{user?.nickname}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        
        <View style={styles.karmaContainer}>
          <Text style={styles.karmaLabel}>Karma</Text>
          <Text style={styles.karmaValue}>{user?.karma || 0}</Text>
          {karmaLevel && (
            <View style={[styles.levelBadge, { backgroundColor: karmaLevel.color + '20' }]}>
              <Text style={[styles.levelText, { color: karmaLevel.color }]}>
                {karmaLevel.label}
              </Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Karma 说明</Text>
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>👍</Text>
            <Text style={styles.infoText}>你的 DDL 被确认真实 → +5 Karma</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>👎</Text>
            <Text style={styles.infoText}>你的 DDL 被标记有误 → -2 Karma</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>⭐</Text>
            <Text style={styles.infoText}>Karma ≥50 时，提交自动标记为"已验证"</Text>
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>退出登录</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  profileCard: {
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
  },
  nickname: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 16,
  },
  karmaContainer: {
    alignItems: 'center',
  },
  karmaLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 4,
  },
  karmaValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  levelBadge: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  levelText: {
    fontSize: 12,
    fontWeight: '600',
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 12,
    paddingLeft: 4,
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  infoIcon: {
    fontSize: 20,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: '#4b5563',
  },
  actions: {
    padding: 16,
    marginTop: 'auto',
  },
  logoutBtn: {
    backgroundColor: '#fee2e2',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  logoutText: {
    color: '#dc2626',
    fontWeight: '600',
    fontSize: 16,
  },
});
