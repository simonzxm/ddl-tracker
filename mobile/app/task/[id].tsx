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
  const { id } = useLocalSearchParams<{ id: string }>();
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
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>返回</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const dueDate = new Date(task.due_time);
  const now = new Date();
  const isOverdue = dueDate < now;
  const diffMs = dueDate.getTime() - now.getTime();
  const diffDays = Math.floor(Math.abs(diffMs) / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((Math.abs(diffMs) % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  const formatRemaining = () => {
    if (isOverdue) {
      if (diffDays > 0) return `已逾期 ${diffDays}天`;
      return `已逾期 ${diffHours}小时`;
    }
    if (diffDays === 0) return `${diffHours}小时后截止`;
    return `${diffDays}天${diffHours}小时后截止`;
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← 返回</Text>
        </TouchableOpacity>
      </View>

      {/* Main Content */}
      <View style={styles.main}>
        <View style={styles.courseBadge}>
          <Text style={styles.courseText}>{task.course_name || task.course_abbr}</Text>
        </View>

        <Text style={styles.title}>{task.title}</Text>

        <View style={styles.dueRow}>
          <Text style={[styles.dueTime, isOverdue && styles.overdue]}>
            {dueDate.toLocaleDateString('zh-CN', {
              month: 'long',
              day: 'numeric',
              weekday: 'short',
            })}
            {' '}
            {dueDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </Text>
          <Text style={[styles.remaining, isOverdue && styles.overdue]}>
            {formatRemaining()}
          </Text>
        </View>

        {task.status === 'verified' && (
          <View style={styles.verifiedBanner}>
            <Text style={styles.verifiedText}>✓ 信息已验证</Text>
          </View>
        )}

        {task.description && (
          <View style={styles.descSection}>
            <Text style={styles.descLabel}>详细说明</Text>
            <Text style={styles.description}>{task.description}</Text>
          </View>
        )}

        <Text style={styles.meta}>
          由 {task.creator_nickname || '匿名用户'} 创建
        </Text>
      </View>

      {/* Vote Section */}
      <View style={styles.voteSection}>
        <Text style={styles.voteQuestion}>这个信息准确吗？</Text>
        <View style={styles.voteButtons}>
          <TouchableOpacity
            style={[styles.voteBtn, task.my_vote === 'upvote' && styles.votedUp]}
            onPress={() => handleVote('upvote')}
          >
            <Text style={styles.voteEmoji}>👍</Text>
            <Text style={styles.voteCount}>{task.upvotes}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.voteBtn, task.my_vote === 'downvote' && styles.votedDown]}
            onPress={() => handleVote('downvote')}
          >
            <Text style={styles.voteEmoji}>👎</Text>
            <Text style={styles.voteCount}>{task.downvotes}</Text>
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
    paddingTop: Platform.OS === 'ios' ? 60 : 16,
    paddingBottom: 40,
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
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  backBtn: {
    padding: 4,
  },
  backText: {
    fontSize: 16,
    color: '#2563eb',
  },
  main: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 20,
  },
  courseBadge: {
    backgroundColor: '#e0e7ff',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 12,
  },
  courseText: {
    color: '#4338ca',
    fontSize: 13,
    fontWeight: '600',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: 12,
  },
  dueRow: {
    marginBottom: 12,
  },
  dueTime: {
    fontSize: 15,
    color: '#4b5563',
    marginBottom: 4,
  },
  remaining: {
    fontSize: 14,
    fontWeight: '600',
    color: '#059669',
  },
  overdue: {
    color: '#dc2626',
  },
  verifiedBanner: {
    backgroundColor: '#dcfce7',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  verifiedText: {
    color: '#166534',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  descSection: {
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    paddingTop: 16,
    marginTop: 4,
    marginBottom: 12,
  },
  descLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 8,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: '#374151',
  },
  meta: {
    fontSize: 13,
    color: '#9ca3af',
  },
  voteSection: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  voteQuestion: {
    fontSize: 15,
    fontWeight: '600',
    color: '#4b5563',
    marginBottom: 16,
  },
  voteButtons: {
    flexDirection: 'row',
    gap: 20,
  },
  voteBtn: {
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
    minWidth: 80,
  },
  votedUp: {
    backgroundColor: '#dbeafe',
  },
  votedDown: {
    backgroundColor: '#fee2e2',
  },
  voteEmoji: {
    fontSize: 24,
    marginBottom: 4,
  },
  voteCount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
  },
});
