import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Course } from '../types';

interface CourseCardProps {
  course: Course;
  onPress?: () => void;
  onFollow?: () => void;
}

export function CourseCard({ course, onPress, onFollow }: CourseCardProps) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.content}>
        <View style={styles.info}>
          <Text style={styles.code}>{course.course_code}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {course.name}
            {course.name_abbr && <Text style={styles.abbr}> ({course.name_abbr})</Text>}
          </Text>
          <Text style={styles.teacher}>{course.teacher} · {course.semester}</Text>
        </View>
        
        <TouchableOpacity 
          style={[styles.followBtn, course.is_followed && styles.followedBtn]}
          onPress={onFollow}
        >
          <Text style={[styles.followText, course.is_followed && styles.followedText]}>
            {course.is_followed ? '已关注' : '关注'}
          </Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.footer}>
        <Text style={styles.followers}>{course.followers_count} 人关注</Text>
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
  content: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  info: {
    flex: 1,
    marginRight: 12,
  },
  code: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 4,
  },
  abbr: {
    fontWeight: '400',
    color: '#9ca3af',
  },
  teacher: {
    fontSize: 14,
    color: '#6b7280',
  },
  followBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  followedBtn: {
    backgroundColor: '#e5e7eb',
  },
  followText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  followedText: {
    color: '#6b7280',
  },
  footer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  followers: {
    fontSize: 13,
    color: '#9ca3af',
  },
});
