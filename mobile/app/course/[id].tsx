import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/services/api';
import { Course, Task } from '../../src/types';

export default function CourseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [course, setCourse] = useState<Course | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCourseData();
  }, [id]);

  const loadCourseData = async () => {
    if (!id) return;
    
    try {
      const [courseData, tasksData] = await Promise.all([
        api.getCourse(parseInt(id)),
        api.getCourseTasks(parseInt(id)),
      ]);
      setCourse(courseData);
      setTasks(tasksData);
    } catch (error) {
      console.error('Failed to load course data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFollow = async () => {
    if (!course) return;
    
    try {
      if (course.is_followed) {
        await api.unfollowCourse(course.id);
      } else {
        await api.followCourse(course.id);
      }
      setCourse({ ...course, is_followed: !course.is_followed });
    } catch (error) {
      console.error('Follow/unfollow failed:', error);
    }
  };

  const formatDueTime = (dueTime: string) => {
    const date = new Date(dueTime);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    
    const dateStr = date.toLocaleDateString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    if (days < 0) {
      return { text: `${dateStr} (已逾期)`, color: '#ef4444' };
    } else if (days === 0) {
      return { text: `${dateStr} (今天截止)`, color: '#f59e0b' };
    } else if (days <= 3) {
      return { text: `${dateStr} (${days}天后)`, color: '#f59e0b' };
    }
    return { text: dateStr, color: '#6b7280' };
  };

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.customHeader}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={28} color="#2563eb" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>课程详情</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={[styles.content, styles.center]}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      </View>
    );
  }

  if (!course) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.customHeader}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={28} color="#2563eb" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>课程详情</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={[styles.content, styles.center]}>
          <Text style={styles.errorText}>课程不存在</Text>
        </View>
      </View>
    );
  }

  // Build the info items
  const infoItems = [course.teacher];
  if (course.class_number) infoItems.push(course.class_number);
  if (course.campus) infoItems.push(course.campus);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.customHeader}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color="#2563eb" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>课程详情</Text>
        <View style={styles.headerRight} />
      </View>
      
      <ScrollView 
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
      >
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.courseInfo}>
              <Text style={styles.courseCode}>{course.course_code}</Text>
              <Text style={styles.courseName}>
                {course.name}
                {course.name_abbr && (
                  <Text style={styles.courseAbbr}> ({course.name_abbr})</Text>
                )}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.followBtn, course.is_followed && styles.followedBtn]}
              onPress={handleFollow}
            >
              <Text style={[styles.followText, course.is_followed && styles.followedText]}>
                {course.is_followed ? '已关注' : '关注'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoText}>{infoItems.join(' | ')}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.semesterText}>学期: {course.semester}</Text>
            <Text style={styles.followersText}>{course.followers_count} 人关注</Text>
          </View>

          {course.time_location && (
            <View style={styles.timeLocationContainer}>
              <Text style={styles.sectionLabel}>时间地点</Text>
              <Text style={styles.timeLocationText}>{course.time_location}</Text>
            </View>
          )}
        </View>

        <View style={styles.tasksSection}>
          <Text style={styles.sectionTitle}>DDL 预览</Text>
          {tasks.length === 0 ? (
            <View style={styles.emptyTasks}>
              <Text style={styles.emptyIcon}>📝</Text>
              <Text style={styles.emptyText}>暂无 DDL</Text>
            </View>
          ) : (
            tasks.map((task) => {
              const dueInfo = formatDueTime(task.due_time);
              return (
                <TouchableOpacity
                  key={task.id}
                  style={styles.taskCard}
                  onPress={() => router.push(`/task/${task.id}`)}
                >
                  <View style={styles.taskHeader}>
                    <Text style={styles.taskTitle} numberOfLines={1}>
                      {task.title}
                    </Text>
                    {task.status === 'verified' && (
                      <Text style={styles.verifiedBadge}>✓ 已验证</Text>
                    )}
                  </View>
                  <Text style={[styles.taskDue, { color: dueInfo.color }]}>
                    {dueInfo.text}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  customHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  backButton: {
    padding: 4,
    width: 44,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1f2937',
  },
  headerRight: {
    width: 44,
  },
  content: {
    flex: 1,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#6b7280',
  },
  header: {
    backgroundColor: '#fff',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  courseInfo: {
    flex: 1,
    marginRight: 12,
  },
  courseCode: {
    fontSize: 13,
    color: '#9ca3af',
    marginBottom: 4,
  },
  courseName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1f2937',
  },
  courseAbbr: {
    fontWeight: '400',
    color: '#6b7280',
    fontSize: 16,
  },
  followBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  followedBtn: {
    backgroundColor: '#e5e7eb',
  },
  followText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  followedText: {
    color: '#6b7280',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 15,
    color: '#4b5563',
  },
  semesterText: {
    fontSize: 14,
    color: '#6b7280',
  },
  followersText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  timeLocationContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  sectionLabel: {
    fontSize: 13,
    color: '#9ca3af',
    marginBottom: 4,
  },
  timeLocationText: {
    fontSize: 14,
    color: '#4b5563',
    lineHeight: 20,
  },
  tasksSection: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 12,
  },
  emptyTasks: {
    alignItems: 'center',
    paddingVertical: 40,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  taskCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1f2937',
    flex: 1,
    marginRight: 8,
  },
  verifiedBadge: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '500',
  },
  taskDue: {
    fontSize: 13,
  },
});
