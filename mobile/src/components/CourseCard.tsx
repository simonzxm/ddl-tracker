import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Course } from '../types';

interface CourseCardProps {
  course: Course;
  onPress?: () => void;
  onFollow?: () => void;
}

export function CourseCard({ course, onPress, onFollow }: CourseCardProps) {
  // Build the info line: teacher | campus
  const infoItems = [course.teacher];
  if (course.campus) {
    infoItems.push(course.campus);
  }
  const infoLine = infoItems.join(' | ');

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.content}>
        <View style={styles.info}>
          <Text style={styles.code}>{course.course_code}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {course.name}
            {course.name_abbr && <Text style={styles.abbr}> ({course.name_abbr})</Text>}
          </Text>
          <Text style={styles.infoLine} numberOfLines={1}>{infoLine}</Text>
        </View>
        
        <View style={styles.rightColumn}>
          <TouchableOpacity 
            style={[styles.followBtn, course.is_followed && styles.followedBtn]}
            onPress={(e) => {
              e.stopPropagation();
              onFollow?.();
            }}
          >
            <Text style={[styles.followText, course.is_followed && styles.followedText]}>
              {course.is_followed ? '已关注' : '关注'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.followers}>{course.followers_count} 人关注</Text>
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
    color: '#9ca3af',
    marginBottom: 2,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 4,
  },
  abbr: {
    fontWeight: '400',
    color: '#6b7280',
    fontSize: 14,
  },
  infoLine: {
    fontSize: 14,
    color: '#6b7280',
  },
  rightColumn: {
    alignItems: 'flex-end',
  },
  followBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#2563eb',
    marginBottom: 6,
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
  followers: {
    fontSize: 12,
    color: '#9ca3af',
  },
});
