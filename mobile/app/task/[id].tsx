import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { api } from '../../src/services/api';
import { Task } from '../../src/types';

export default function TaskDetailScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      loadTask(parseInt(id));
    }
  }, [id]);

  const loadTask = async (taskId: number) => {
    try {
      const data = await api.getTask(taskId);
      setTask(data);
    } catch (error) {
      console.error('Failed to load task:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleVote = async (type: 'upvote' | 'downvote') => {
    if (!task) return;
    try {
      await api.voteTask(task.id, type);
      loadTask(task.id);
    } catch (error) {
      console.error('Vote failed:', error);
    }
  };

  const handleBack = () => {
    // Navigate back with tab parameter preserved
    if (tab) {
      router.replace({ pathname: '/(tabs)', params: { tab } });
    } else {
      router.back();
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (!task) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>任务不存在</Text>
        <TouchableOpacity onPress={handleBack}>
          <Text style={styles.backLink}>返回</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const dueDate = new Date(task.due_time);
  const now = new Date();
  const isOverdue = dueDate < now;

  // Calculate remaining time
  const diffMs = dueDate.getTime() - now.getTime();
  const diffDays = Math.floor(Math.abs(diffMs) / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((Math.abs(diffMs) % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  const formatRemaining = () => {
    if (isOverdue) {
      if (diffDays > 0) return `已逾期 ${diffDays}天${diffHours}小时`;
      return `已逾期 ${diffHours}小时`;
    }
    if (diffDays > 0) return `剩余 ${diffDays}天${diffHours}小时`;
    return `剩余 ${diffHours}小时`;
  };

  const getTimeColor = () => {
    if (isOverdue) return '#dc2626';
    if (diffDays < 1) return '#ea580c';
    if (diffDays < 3) return '#ca8a04';
    return '#16a34a';
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack}>
          <Text style={styles.backBtn}>← 返回</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <View style={styles.tags}>
          <View style={styles.courseTag}>
            <Text style={styles.courseTagText}>
              {task.course_name || task.course_abbr}
            </Text>
          </View>
          {task.status === 'verified' && (
            <View style={styles.verifiedTag}>
              <Text style={styles.verifiedTagText}>✓ 已验证</Text>
            </View>
          )}
        </View>

        <Text style={styles.title}>{task.title}</Text>

        <View style={styles.dueContainer}>
          <Text style={styles.dueLabel}>截止时间</Text>
          <Text style={[styles.dueTime, isOverdue && styles.overdue]}>
            {dueDate.toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            })}
            {' '}
            {dueDate.toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
          <Text style={[styles.remainingTime, { color: getTimeColor() }]}>
            {formatRemaining()}
          </Text>
        </View>

        {task.description && (
          <View style={styles.descriptionContainer}>
            <Text style={styles.descriptionLabel}>详细说明</Text>
            <Text style={styles.description}>{task.description}</Text>
          </View>
        )}

        <View style={styles.meta}>
          <Text style={styles.metaText}>
            由 {task.creator_nickname || '匿名用户'} 创建于{' '}
            {new Date(task.created_at).toLocaleDateString('zh-CN')}
          </Text>
        </View>
      </View>

      <View style={styles.voteSection}>
        <Text style={styles.voteTitle}>这个DDL信息准确吗？</Text>
        <View style={styles.voteButtons}>
          <TouchableOpacity
            style={[styles.voteBtn, task.my_vote === 'upvote' && styles.votedUp]}
            onPress={() => handleVote('upvote')}
          >
            <Text style={styles.voteEmoji}>👍</Text>
            <Text style={styles.voteCount}>{task.upvotes}</Text>
            <Text style={styles.voteLabel}>准确</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.voteBtn, task.my_vote === 'downvote' && styles.votedDown]}
            onPress={() => handleVote('downvote')}
          >
            <Text style={styles.voteEmoji}>👎</Text>
            <Text style={styles.voteCount}>{task.downvotes}</Text>
            <Text style={styles.voteLabel}>有误</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  errorText: {
    fontSize: 16,
    color: '#6b7280',
  },
  backLink: {
    color: '#2563eb',
    fontSize: 16,
  },
  header: {
    marginBottom: 16,
  },
  backBtn: {
    fontSize: 16,
    color: '#2563eb',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  tags: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  courseTag: {
    backgroundColor: '#e0e7ff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  courseTagText: {
    color: '#4338ca',
    fontSize: 13,
    fontWeight: '600',
  },
  verifiedTag: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  verifiedTagText: {
    color: '#166534',
    fontSize: 13,
    fontWeight: '500',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: 20,
  },
  dueContainer: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  dueLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
  },
  dueTime: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
  },
  overdue: {
    color: '#dc2626',
  },
  remainingTime: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: '700',
  },
  descriptionContainer: {
    marginBottom: 16,
  },
  descriptionLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 8,
  },
  description: {
    fontSize: 15,
    lineHeight: 24,
    color: '#374151',
  },
  meta: {
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  metaText: {
    fontSize: 13,
    color: '#9ca3af',
  },
  voteSection: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginTop: 16,
    alignItems: 'center',
  },
  voteTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 16,
  },
  voteButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  voteBtn: {
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
    minWidth: 100,
  },
  votedUp: {
    backgroundColor: '#dbeafe',
  },
  votedDown: {
    backgroundColor: '#fee2e2',
  },
  voteEmoji: {
    fontSize: 28,
    marginBottom: 4,
  },
  voteCount: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1f2937',
  },
  voteLabel: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
});
