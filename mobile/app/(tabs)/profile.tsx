import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/hooks/useAuth';
import { api } from '../../src/services/api';

const AVATAR_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#ca8a04', '#9333ea',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#6366f1',
];

export default function ProfileScreen() {
  const { user, logout, refresh } = useAuth();
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [editNickname, setEditNickname] = useState('');
  const [editColor, setEditColor] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  // Refresh user data when screen is focused
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [])
  );

  const openEditModal = () => {
    setEditNickname(user?.nickname || '');
    setEditColor(user?.avatar_color || '#2563eb');
    setEditModalVisible(true);
  };

  const handleSaveProfile = async () => {
    if (!editNickname.trim()) {
      Alert.alert('错误', '昵称不能为空');
      return;
    }
    setSaving(true);
    try {
      await api.updateProfile({ nickname: editNickname.trim(), avatar_color: editColor });
      await refresh();
      setEditModalVisible(false);
      Alert.alert('成功', '资料已更新');
    } catch (error: any) {
      Alert.alert('错误', error.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword) {
      Alert.alert('错误', '请填写所有字段');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('错误', '新密码至少需要8个字符');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('错误', '两次输入的新密码不一致');
      return;
    }
    setSaving(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      setPasswordModalVisible(false);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      Alert.alert('成功', '密码已修改');
    } catch (error: any) {
      Alert.alert('错误', error.message || '修改失败');
    } finally {
      setSaving(false);
    }
  };

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
  const avatarColor = user?.avatar_color || '#2563eb';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView>
        <View style={styles.profileCard}>
          <TouchableOpacity onPress={openEditModal}>
            <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
              <Text style={styles.avatarText}>{user?.nickname?.[0] || '?'}</Text>
            </View>
          </TouchableOpacity>
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
          <Text style={styles.sectionTitle}>账户设置</Text>
          <View style={styles.menuCard}>
            <TouchableOpacity style={styles.menuItem} onPress={openEditModal}>
              <Text style={styles.menuIcon}>✏️</Text>
              <Text style={styles.menuText}>修改资料</Text>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => setPasswordModalVisible(true)}>
              <Text style={styles.menuIcon}>🔑</Text>
              <Text style={styles.menuText}>修改密码</Text>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>
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
      </ScrollView>

      {/* Edit Profile Modal */}
      <Modal visible={editModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>修改资料</Text>
            
            <Text style={styles.inputLabel}>昵称</Text>
            <TextInput
              style={styles.input}
              value={editNickname}
              onChangeText={setEditNickname}
              placeholder="输入昵称"
              maxLength={50}
            />
            
            <Text style={styles.inputLabel}>头像颜色</Text>
            <View style={styles.colorPicker}>
              {AVATAR_COLORS.map(color => (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.colorOption,
                    { backgroundColor: color },
                    editColor === color && styles.colorSelected,
                  ]}
                  onPress={() => setEditColor(color)}
                />
              ))}
            </View>
            
            <View style={styles.previewRow}>
              <Text style={styles.inputLabel}>预览</Text>
              <View style={[styles.avatarPreview, { backgroundColor: editColor }]}>
                <Text style={styles.avatarPreviewText}>{editNickname?.[0] || '?'}</Text>
              </View>
            </View>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.cancelBtn} 
                onPress={() => setEditModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.saveBtn, saving && styles.savingBtn]} 
                onPress={handleSaveProfile}
                disabled={saving}
              >
                <Text style={styles.saveBtnText}>{saving ? '保存中...' : '保存'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Change Password Modal */}
      <Modal visible={passwordModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>修改密码</Text>
            
            <Text style={styles.inputLabel}>当前密码</Text>
            <TextInput
              style={styles.input}
              value={oldPassword}
              onChangeText={setOldPassword}
              placeholder="输入当前密码"
              secureTextEntry
            />
            
            <Text style={styles.inputLabel}>新密码</Text>
            <TextInput
              style={styles.input}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="输入新密码（至少8位）"
              secureTextEntry
            />
            
            <Text style={styles.inputLabel}>确认新密码</Text>
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="再次输入新密码"
              secureTextEntry
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.cancelBtn} 
                onPress={() => {
                  setPasswordModalVisible(false);
                  setOldPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                }}
              >
                <Text style={styles.cancelBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.saveBtn, saving && styles.savingBtn]} 
                onPress={handleChangePassword}
                disabled={saving}
              >
                <Text style={styles.saveBtnText}>{saving ? '保存中...' : '确认修改'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  menuCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  menuIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  menuText: {
    flex: 1,
    fontSize: 16,
    color: '#1f2937',
  },
  menuArrow: {
    fontSize: 20,
    color: '#9ca3af',
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
    paddingBottom: 32,
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
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 20,
    textAlign: 'center',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  colorPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  colorOption: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  colorSelected: {
    borderWidth: 3,
    borderColor: '#1f2937',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarPreview: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 16,
  },
  avatarPreviewText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#4b5563',
  },
  saveBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  savingBtn: {
    opacity: 0.7,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
