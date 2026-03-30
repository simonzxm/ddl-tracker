import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { Task } from '../types';

interface TaskCardProps {
  task: Task;
  onPress?: () => void;
  onVote?: (type: 'upvote' | 'downvote') => void;
  onComplete?: () => void;
  isCompleted?: boolean;
}

export function TaskCard({ task, onPress, onVote, onComplete, isCompleted }: TaskCardProps) {
  const [now, setNow] = useState(new Date());
  const dueDate = new Date(task.due_time);
  const isOverdue = dueDate < now && !isCompleted;

  // Update countdown every second
  useEffect(() => {
    if (isCompleted) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [isCompleted]);

  // Calculate remaining time precisely
  const diffMs = dueDate.getTime() - now.getTime();
  const absDiffMs = Math.abs(diffMs);
  const diffDays = Math.floor(absDiffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((absDiffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const diffMinutes = Math.floor((absDiffMs % (1000 * 60 * 60)) / (1000 * 60));
  const diffSeconds = Math.floor((absDiffMs % (1000 * 60)) / 1000);

  const formatRemaining = () => {
    if (isCompleted) return '已完成';
    const prefix = isOverdue ? '逾期 ' : '';
    if (diffDays > 0) {
      return `${prefix}${diffDays}天${diffHours}时${diffMinutes}分`;
    }
    if (diffHours > 0) {
      return `${prefix}${diffHours}时${diffMinutes}分${diffSeconds}秒`;
    }
    return `${prefix}${diffMinutes}分${diffSeconds}秒`;
  };

  // Color based on urgency
  const getTimeColor = () => {
    if (isCompleted) return '#9ca3af';
    if (isOverdue) return '#dc2626';
    if (diffDays === 0 && diffHours < 6) return '#ea580c';
    if (diffDays < 3) return '#d97706';
    return '#059669';
  };

  return (
    <Pressable 
      style={[styles.card, isCompleted && styles.cardCompleted]} 
      onPress={onPress}
    >
      {/* Checkbox */}
      <TouchableOpacity 
        style={[styles.checkbox, isCompleted && styles.checkboxCompleted]}
        onPress={onComplete}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        {isCompleted && <Text style={styles.checkmark}>✓</Text>}
      </TouchableOpacity>

      {/* Content */}
      <View style={styles.content}>
        <Text 
          style={[styles.title, isCompleted && styles.titleCompleted]} 
          numberOfLines={2}
        >
          {task.title}
        </Text>
        <View style={styles.meta}>
          <Text style={styles.course}>{task.course_name || task.course_abbr}</Text>
          <Text style={styles.dot}>·</Text>
          <Text style={[styles.due, { color: getTimeColor() }]}>
            {formatRemaining()}
          </Text>
        </View>
      </View>

      {/* Right side: votes + verified */}
      {!isCompleted && (
        <View style={styles.rightColumn}>
          {(task.upvotes > 0 || task.downvotes > 0) && (
            <View style={styles.votes}>
              {task.upvotes > 0 && <Text style={styles.voteUp}>👍{task.upvotes}</Text>}
              {task.downvotes > 0 && <Text style={styles.voteDown}>👎{task.downvotes}</Text>}
            </View>
          )}
          {task.status === 'verified' && (
            <Text style={styles.verified}>✓</Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardCompleted: {
    backgroundColor: '#fafafa',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#d1d5db',
    marginRight: 12,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxCompleted: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  checkmark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1f2937',
    marginBottom: 4,
    lineHeight: 20,
  },
  titleCompleted: {
    color: '#9ca3af',
    textDecorationLine: 'line-through',
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  course: {
    fontSize: 13,
    color: '#6b7280',
  },
  dot: {
    fontSize: 13,
    color: '#d1d5db',
    marginHorizontal: 6,
  },
  due: {
    fontSize: 13,
    fontWeight: '500',
  },
  rightColumn: {
    alignItems: 'flex-end',
    marginLeft: 8,
    gap: 4,
  },
  votes: {
    flexDirection: 'row',
    gap: 6,
  },
  voteUp: {
    fontSize: 11,
    color: '#6b7280',
  },
  voteDown: {
    fontSize: 11,
    color: '#6b7280',
  },
  verified: {
    fontSize: 12,
    color: '#16a34a',
  },
});
