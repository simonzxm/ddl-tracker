import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Task } from '../types';

interface TaskCardProps {
  task: Task;
  onPress?: () => void;
  onVote?: (type: 'upvote' | 'downvote') => void;
  onComplete?: () => void;
  isCompleted?: boolean;
}

export function TaskCard({ task, onPress, onVote, onComplete, isCompleted }: TaskCardProps) {
  const dueDate = new Date(task.due_time);
  const now = new Date();
  const isOverdue = dueDate < now;

  // Calculate remaining time
  const diffMs = dueDate.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  const formatRemaining = () => {
    if (isOverdue) {
      const overdueDays = Math.floor(-diffMs / (1000 * 60 * 60 * 24));
      const overdueHours = Math.floor((-diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      if (overdueDays > 0) return `已逾期 ${overdueDays}天${overdueHours}小时`;
      return `已逾期 ${overdueHours}小时`;
    }
    if (diffDays > 0) return `剩余 ${diffDays}天${diffHours}小时`;
    if (diffHours > 0) return `剩余 ${diffHours}小时${diffMins}分钟`;
    return `剩余 ${diffMins}分钟`;
  };

  // Color based on urgency: green -> yellow -> orange -> red
  const getTimeColor = () => {
    if (isOverdue) return '#dc2626'; // red
    if (diffDays < 1) return '#ea580c'; // orange - less than 1 day
    if (diffDays < 3) return '#ca8a04'; // yellow - less than 3 days
    return '#16a34a'; // green - more than 3 days
  };

  const formatDueTime = () => {
    return dueDate.toLocaleDateString('zh-CN', { 
      month: 'numeric', 
      day: 'numeric',
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <TouchableOpacity 
      style={[styles.card, isCompleted && styles.cardCompleted]} 
      onPress={onPress} 
      activeOpacity={0.7}
    >
      <View style={styles.row1}>
        <View style={styles.courseTag}>
          <Text style={styles.courseText}>{task.course_name || task.course_abbr}</Text>
        </View>
        <Text style={styles.dueTime}>{formatDueTime()}</Text>
        {task.status === 'verified' && (
          <View style={styles.verifiedTag}>
            <Text style={styles.verifiedText}>✓</Text>
          </View>
        )}
        {onComplete && (
          <TouchableOpacity 
            style={[styles.checkBtn, isCompleted && styles.checkBtnCompleted]}
            onPress={(e) => { e.stopPropagation?.(); onComplete(); }}
          >
            <Text style={styles.checkText}>{isCompleted ? '✓' : '○'}</Text>
          </TouchableOpacity>
        )}
      </View>
      
      <Text style={[styles.title, isCompleted && styles.titleCompleted]} numberOfLines={2}>
        {task.title}
      </Text>
      
      <View style={styles.row3}>
        <Text style={[styles.remaining, { color: getTimeColor() }]}>
          {formatRemaining()}
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
  cardCompleted: {
    backgroundColor: '#f9fafb',
    opacity: 0.7,
  },
  row1: {
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
  dueTime: {
    fontSize: 12,
    color: '#6b7280',
    flex: 1,
  },
  verifiedTag: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  verifiedText: {
    color: '#166534',
    fontSize: 12,
  },
  checkBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBtnCompleted: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  checkText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 10,
  },
  titleCompleted: {
    textDecorationLine: 'line-through',
    color: '#9ca3af',
  },
  row3: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  remaining: {
    fontSize: 13,
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
