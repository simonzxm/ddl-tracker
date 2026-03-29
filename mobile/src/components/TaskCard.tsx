import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Task } from '../types';

interface TaskCardProps {
  task: Task;
  onPress?: () => void;
  onVote?: (type: 'upvote' | 'downvote') => void;
}

export function TaskCard({ task, onPress, onVote }: TaskCardProps) {
  const dueDate = new Date(task.due_time);
  const now = new Date();
  const isOverdue = dueDate < now;
  const isToday = dueDate.toDateString() === now.toDateString();
  const isTomorrow = dueDate.toDateString() === new Date(now.getTime() + 86400000).toDateString();

  const formatDue = () => {
    if (isOverdue) return '已逾期';
    if (isToday) return `今天 ${dueDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    if (isTomorrow) return `明天 ${dueDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    return dueDate.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.header}>
        <View style={styles.courseTag}>
          <Text style={styles.courseText}>{task.course_abbr || task.course_name}</Text>
        </View>
        {task.status === 'verified' && (
          <View style={styles.verifiedTag}>
            <Text style={styles.verifiedText}>✓ 已验证</Text>
          </View>
        )}
      </View>
      
      <Text style={styles.title} numberOfLines={2}>{task.title}</Text>
      
      <View style={styles.footer}>
        <Text style={[styles.dueTime, isOverdue && styles.overdue]}>
          {formatDue()}
        </Text>
        
        <View style={styles.votes}>
          <TouchableOpacity 
            style={[styles.voteBtn, task.my_vote === 'upvote' && styles.votedUp]}
            onPress={() => onVote?.('upvote')}
          >
            <Text style={styles.voteText}>👍 {task.upvotes}</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.voteBtn, task.my_vote === 'downvote' && styles.votedDown]}
            onPress={() => onVote?.('downvote')}
          >
            <Text style={styles.voteText}>👎 {task.downvotes}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  courseTag: {
    backgroundColor: '#e0e7ff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  courseText: {
    color: '#4338ca',
    fontSize: 12,
    fontWeight: '600',
  },
  verifiedTag: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  verifiedText: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '500',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 12,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dueTime: {
    fontSize: 14,
    color: '#6b7280',
  },
  overdue: {
    color: '#dc2626',
    fontWeight: '600',
  },
  votes: {
    flexDirection: 'row',
    gap: 8,
  },
  voteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#f3f4f6',
  },
  votedUp: {
    backgroundColor: '#dbeafe',
  },
  votedDown: {
    backgroundColor: '#fee2e2',
  },
  voteText: {
    fontSize: 13,
  },
});
