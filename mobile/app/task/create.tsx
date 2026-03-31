import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { api } from '../../src/services/api';
import { Course } from '../../src/types';

export default function CreateTaskScreen() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // Separate date/time fields for better UX
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [hour, setHour] = useState('23');
  const [minute, setMinute] = useState('59');
  const [loading, setLoading] = useState(false);
  const [showCourses, setShowCourses] = useState(false);

  useEffect(() => {
    loadFollowedCourses();
    // Set default date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setYear(tomorrow.getFullYear().toString());
    setMonth(String(tomorrow.getMonth() + 1).padStart(2, '0'));
    setDay(String(tomorrow.getDate()).padStart(2, '0'));
  }, []);

  const loadFollowedCourses = async () => {
    try {
      const data = await api.getFollowedCourses();
      setCourses(data);
    } catch (error) {
      console.error('Failed to load courses:', error);
    }
  };

  const handleSubmit = async () => {
    if (!selectedCourse) {
      Alert.alert('提示', '请选择课程');
      return;
    }
    if (!title.trim()) {
      Alert.alert('提示', '请输入DDL标题');
      return;
    }
    if (!year || !month || !day) {
      Alert.alert('提示', '请填写完整日期');
      return;
    }

    // Validate date
    const y = parseInt(year), m = parseInt(month), d = parseInt(day);
    const h = parseInt(hour) || 23, min = parseInt(minute) || 59;
    
    if (isNaN(y) || y < 2020 || y > 2100) {
      Alert.alert('提示', '年份无效');
      return;
    }
    if (isNaN(m) || m < 1 || m > 12) {
      Alert.alert('提示', '月份无效 (1-12)');
      return;
    }
    if (isNaN(d) || d < 1 || d > 31) {
      Alert.alert('提示', '日期无效 (1-31)');
      return;
    }
    if (h < 0 || h > 23) {
      Alert.alert('提示', '小时无效 (0-23)');
      return;
    }
    if (min < 0 || min > 59) {
      Alert.alert('提示', '分钟无效 (0-59)');
      return;
    }

    const dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const timeStr = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    const dueDateTime = `${dateStr}T${timeStr}:00`;

    setLoading(true);
    try {
      await api.createTask({
        course_id: selectedCourse.id,
        title: title.trim(),
        description: description.trim() || undefined,
        due_time: dueDateTime,
      });
      router.back();
    } catch (error: any) {
      Alert.alert('创建失败', error.message);
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView 
        style={styles.flex} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>取消</Text>
            </TouchableOpacity>
            <Text style={styles.pageTitle}>新建 DDL</Text>
            <TouchableOpacity 
              onPress={handleSubmit} 
              style={[styles.saveBtn, loading && styles.saveBtnDisabled]}
              disabled={loading}
            >
              <Text style={styles.saveText}>{loading ? '...' : '保存'}</Text>
            </TouchableOpacity>
          </View>

          {/* Course Selection */}
          <TouchableOpacity
            style={styles.courseSelect}
            onPress={() => setShowCourses(!showCourses)}
          >
            <Text style={styles.fieldLabel}>课程</Text>
            <View style={styles.courseSelectRow}>
              <Text style={selectedCourse ? styles.courseSelected : styles.coursePlaceholder}>
                {selectedCourse ? selectedCourse.name : '选择课程...'}
              </Text>
              <Text style={styles.arrow}>{showCourses ? '▲' : '▼'}</Text>
            </View>
          </TouchableOpacity>
          
          {showCourses && (
            <View style={styles.courseList}>
              {courses.length === 0 ? (
                <Text style={styles.noCourses}>请先在课程页面关注课程</Text>
              ) : (
                courses.map((course) => (
                  <TouchableOpacity
                    key={course.id}
                    style={[
                      styles.courseItem,
                      selectedCourse?.id === course.id && styles.courseItemActive,
                    ]}
                    onPress={() => {
                      setSelectedCourse(course);
                      setShowCourses(false);
                    }}
                  >
                    <Text style={styles.courseName}>{course.name}</Text>
                    <Text style={styles.courseTeacher}>{course.teacher}</Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
          )}

          {/* Title */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>标题</Text>
            <TextInput
              style={styles.titleInput}
              placeholder="例如：第三次作业"
              placeholderTextColor="#9ca3af"
              value={title}
              onChangeText={setTitle}
              maxLength={200}
              autoFocus
            />
          </View>

          {/* Due Date - Separate fields */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>截止日期</Text>
            <View style={styles.dateRow}>
              <TextInput
                style={styles.yearInput}
                placeholder="年"
                placeholderTextColor="#9ca3af"
                value={year}
                onChangeText={(t) => setYear(t.replace(/[^0-9]/g, '').slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
              />
              <Text style={styles.dateSep}>-</Text>
              <TextInput
                style={styles.mdInput}
                placeholder="月"
                placeholderTextColor="#9ca3af"
                value={month}
                onChangeText={(t) => setMonth(t.replace(/[^0-9]/g, '').slice(0, 2))}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={styles.dateSep}>-</Text>
              <TextInput
                style={styles.mdInput}
                placeholder="日"
                placeholderTextColor="#9ca3af"
                value={day}
                onChangeText={(t) => setDay(t.replace(/[^0-9]/g, '').slice(0, 2))}
                keyboardType="number-pad"
                maxLength={2}
              />
            </View>
          </View>

          {/* Due Time */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>截止时间</Text>
            <View style={styles.timeRow}>
              <TextInput
                style={styles.timeInput}
                placeholder="时"
                placeholderTextColor="#9ca3af"
                value={hour}
                onChangeText={(t) => setHour(t.replace(/[^0-9]/g, '').slice(0, 2))}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={styles.timeSep}>:</Text>
              <TextInput
                style={styles.timeInput}
                placeholder="分"
                placeholderTextColor="#9ca3af"
                value={minute}
                onChangeText={(t) => setMinute(t.replace(/[^0-9]/g, '').slice(0, 2))}
                keyboardType="number-pad"
                maxLength={2}
              />
            </View>
          </View>

          {/* Description */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>详细说明（可选，其他用户可见）</Text>
            <TextInput
              style={styles.descInput}
              placeholder="添加详细说明..."
              placeholderTextColor="#9ca3af"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 12,
  },
  cancelBtn: {
    padding: 8,
  },
  cancelText: {
    fontSize: 16,
    color: '#6b7280',
  },
  pageTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1f2937',
  },
  saveBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  courseSelect: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  courseSelectRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  courseSelected: {
    fontSize: 16,
    color: '#1f2937',
  },
  coursePlaceholder: {
    fontSize: 16,
    color: '#9ca3af',
  },
  arrow: {
    color: '#9ca3af',
    fontSize: 12,
  },
  courseList: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  courseItem: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  courseItemActive: {
    backgroundColor: '#eff6ff',
  },
  courseName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1f2937',
  },
  courseTeacher: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  noCourses: {
    padding: 16,
    color: '#9ca3af',
    textAlign: 'center',
  },
  field: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6b7280',
    marginBottom: 8,
  },
  titleInput: {
    fontSize: 16,
    color: '#1f2937',
    padding: 0,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  yearInput: {
    fontSize: 16,
    color: '#1f2937',
    textAlign: 'center',
    width: 60,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 4,
  },
  mdInput: {
    fontSize: 16,
    color: '#1f2937',
    textAlign: 'center',
    width: 40,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 4,
  },
  dateSep: {
    fontSize: 16,
    color: '#9ca3af',
    marginHorizontal: 4,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeInput: {
    fontSize: 16,
    color: '#1f2937',
    textAlign: 'center',
    width: 40,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 4,
  },
  timeSep: {
    fontSize: 16,
    color: '#9ca3af',
    marginHorizontal: 4,
  },
  descInput: {
    fontSize: 15,
    color: '#1f2937',
    minHeight: 80,
    padding: 0,
  },
});
