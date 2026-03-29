import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
} from 'react-native';
import { Link, router } from 'expo-router';
import { useAuth } from '../../src/hooks/useAuth';
import { api } from '../../src/services/api';

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const { register } = useAuth();

  const sendCode = async () => {
    if (!email) {
      Alert.alert('提示', '请输入邮箱');
      return;
    }
    if (!email.endsWith('@smail.nju.edu.cn') && !email.endsWith('@nju.edu.cn')) {
      Alert.alert('提示', '仅支持南京大学教育邮箱');
      return;
    }

    setLoading(true);
    try {
      await api.sendVerificationCode(email);
      setCodeSent(true);
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            clearInterval(timer);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
      Alert.alert('成功', '验证码已发送到邮箱');
    } catch (error: any) {
      Alert.alert('发送失败', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!email || !code || !nickname || !password) {
      Alert.alert('提示', '请填写所有字段');
      return;
    }
    if (password.length < 8) {
      Alert.alert('提示', '密码至少8位');
      return;
    }

    setLoading(true);
    try {
      await register(email, code, nickname, password);
      router.replace('/(tabs)');
    } catch (error: any) {
      Alert.alert('注册失败', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.logo}>📅</Text>
          <Text style={styles.title}>注册账号</Text>
          <Text style={styles.subtitle}>仅限南京大学师生</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.emailRow}>
            <TextInput
              style={[styles.input, styles.emailInput]}
              placeholder="教育邮箱 (@nju.edu.cn)"
              placeholderTextColor="#9ca3af"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={[styles.codeBtn, (countdown > 0 || loading) && styles.codeBtnDisabled]}
              onPress={sendCode}
              disabled={countdown > 0 || loading}
            >
              <Text style={styles.codeBtnText}>
                {countdown > 0 ? `${countdown}s` : '发送'}
              </Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.input}
            placeholder="验证码"
            placeholderTextColor="#9ca3af"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
          />

          <TextInput
            style={styles.input}
            placeholder="昵称"
            placeholderTextColor="#9ca3af"
            value={nickname}
            onChangeText={setNickname}
            maxLength={50}
          />

          <TextInput
            style={styles.input}
            placeholder="密码 (至少8位)"
            placeholderTextColor="#9ca3af"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleRegister}
            disabled={loading}
          >
            <Text style={styles.buttonText}>{loading ? '注册中...' : '注册'}</Text>
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>已有账号？</Text>
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity>
                <Text style={styles.linkText}>返回登录</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 36,
  },
  logo: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
  },
  form: {
    gap: 16,
  },
  emailRow: {
    flexDirection: 'row',
    gap: 12,
  },
  emailInput: {
    flex: 1,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  codeBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  codeBtnDisabled: {
    backgroundColor: '#9ca3af',
  },
  codeBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
    gap: 4,
  },
  footerText: {
    color: '#6b7280',
  },
  linkText: {
    color: '#2563eb',
    fontWeight: '600',
  },
});
