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
} from 'react-native';
import { router } from 'expo-router';
import { api } from '../../src/services/api';
import { Course } from '../../src/types';

export default function CreateTaskScreen() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('23:59');
  const [loading, setLoading] = useState(false);
  const [showCourses, setShowCourses] = useState(false);

  useEffect(() => {
    loadFollowedCourses();
  }, []);

  const loadFollowedCourses = async () => {
    try {
      const data = await api.getFollowedCourses();
      setCourses(data);
    } catch (error) {
      console.error('Failed to load courses:', error);
    }
  };

  // Auto-format date input: YYYY-MM-DD
  const handleDateChange = (text: string) => {
    // Remove non-digits
    let cleaned = text.replace(/\D/g, '');
    
    // Auto-insert dashes
    if (cleaned.length >= 4) {
      cleaned = cleaned.slice(0, 4) + '-' + cleaned.slice(4);
    }
    if (cleaned.length >= 7) {
      cleaned = cleaned.slice(0, 7) + '-' + cleaned.slice(7);
    }
    
    // Limit to YYYY-MM-DD format
    if (cleaned.length > 10) {
      cleaned = cleaned.slice(0, 10);
    }
    
    setDueDate(cleaned);
  };

  // Auto-format time input: HH:MM
  const handleTimeChange = (text: string) => {
    // Remove non-digits
    let cleaned = text.replace(/\D/g, '');
    
    // Auto-insert colon
    if (cleaned.length >= 2) {
      cleaned = cleaned.slice(0, 2) + ':' + cleaned.slice(2);
    }
    
    // Limit to HH:MM format
    if (cleaned.length > 5) {
      cleaned = cleaned.slice(0, 5);
    }
    
    setDueTime(cleaned);
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
    if (!dueDate || dueDate.length !== 10) {
      Alert.alert('提示', '请输入完整的截止日期 (YYYY-MM-DD)');
      return;
    }

    const dueDateTime = `${dueDate}T${dueTime}:00`;

    setLoading(true);
    try {
      await api.createTask({
        course_id: selectedCourse.id,
        title: title.trim(),
        description: description.trim() || undefined,
        due_time: dueDateTime,
      });
      Alert.alert('成功', 'DDL已创建', [
        { text: '好的', onPress: () => router.back() },
      ]);
    } catch (error: any) {
      Alert.alert('创建失败', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backBtn}>← 返回</Text>
        </TouchableOpacity>
        <Text style={styles.pageTitle}>创建 DDL</Text>
      </View>

      <View style={styles.form}>
        <View style={styles.field}>
          <Text style={styles.label}>课程 *</Text>
          <TouchableOpacity
            style={styles.select}
            onPress={() => setShowCourses(!showCourses)}
          >
            <Text style={selectedCourse ? styles.selectValue : styles.selectPlaceholder}>
              {selectedCourse ? `${selectedCourse.name} (${selectedCourse.teacher})` : '选择课程'}
            </Text>
            <Text style={styles.selectArrow}>{showCourses ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          
          {showCourses && (
            <View style={styles.courseList}>
              {courses.length === 0 ? (
                <Text style={styles.noCourses}>请先关注课程</Text>
              ) : (
                courses.map((course) => (
                  <TouchableOpacity
                    key={course.id}
                    style={[
                      styles.courseItem,
                      selectedCourse?.id === course.id && styles.courseItemSelected,
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
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>标题 *</Text>
          <TextInput
            style={styles.input}
            placeholder="如：第三次作业"
            placeholderTextColor="#9ca3af"
            value={title}
            onChangeText={setTitle}
            maxLength={200}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>截止日期 *</Text>
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD（自动格式化）"
            placeholderTextColor="#9ca3af"
            value={dueDate}
            onChangeText={handleDateChange}
            keyboardType="numeric"
            maxLength={10}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>截止时间</Text>
          <TextInput
            style={styles.input}
            placeholder="HH:MM（自动格式化）"
            placeholderTextColor="#9ca3af"
            value={dueTime}
            onChangeText={handleTimeChange}
            keyboardType="numeric"
            maxLength={5}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>详细说明（可选）</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            placeholder="支持 Markdown 格式"
            placeholderTextColor="#9ca3af"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          <Text style={styles.submitText}>{loading ? '提交中...' : '创建 DDL'}</Text>
        </TouchableOpacity>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 24,
  },
  backBtn: {
    fontSize: 16,
    color: '#2563eb',
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1f2937',
  },
  form: {
    gap: 20,
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  textarea: {
    minHeight: 120,
  },
  select: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectValue: {
    fontSize: 16,
    color: '#1f2937',
  },
  selectPlaceholder: {
    fontSize: 16,
    color: '#9ca3af',
  },
  selectArrow: {
    color: '#9ca3af',
  },
  courseList: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginTop: 8,
    overflow: 'hidden',
  },
  courseItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  courseItemSelected: {
    backgroundColor: '#eff6ff',
  },
  courseName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1f2937',
  },
  courseTeacher: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 2,
  },
  noCourses: {
    padding: 16,
    color: '#9ca3af',
    textAlign: 'center',
  },
  submitBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
