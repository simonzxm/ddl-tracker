import React, { useState, useEffect, useRef } from 'react';
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
  
  const prevDateRef = useRef('');
  const prevTimeRef = useRef('23:59');

  useEffect(() => {
    loadFollowedCourses();
    // Set default date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    setDueDate(dateStr);
    prevDateRef.current = dateStr;
  }, []);

  const loadFollowedCourses = async () => {
    try {
      const data = await api.getFollowedCourses();
      setCourses(data);
    } catch (error) {
      console.error('Failed to load courses:', error);
    }
  };

  // Smart date formatting that handles backspace properly
  const handleDateChange = (text: string) => {
    const prev = prevDateRef.current;
    const isDeleting = text.length < prev.length;
    
    if (isDeleting) {
      // If deleting and cursor was after a dash, also remove the dash
      if (prev.endsWith('-') && !text.endsWith('-')) {
        setDueDate(text);
      } else {
        setDueDate(text);
      }
    } else {
      // Adding characters - auto-format
      let cleaned = text.replace(/[^0-9-]/g, '');
      
      // Remove extra dashes
      const parts = cleaned.split('-').filter(p => p !== '');
      
      if (parts.length === 1 && parts[0].length >= 4 && !cleaned.includes('-')) {
        // Auto add first dash after year
        cleaned = parts[0].slice(0, 4) + '-' + parts[0].slice(4);
      } else if (parts.length === 2 && parts[1].length >= 2 && cleaned.split('-').length === 2) {
        // Auto add second dash after month
        cleaned = parts[0] + '-' + parts[1].slice(0, 2) + '-' + parts[1].slice(2);
      }
      
      // Limit length
      if (cleaned.length > 10) {
        cleaned = cleaned.slice(0, 10);
      }
      
      setDueDate(cleaned);
    }
    
    prevDateRef.current = text.length < prev.length ? text : (dueDate.length < text.length ? text : dueDate);
  };

  // Smart time formatting
  const handleTimeChange = (text: string) => {
    const prev = prevTimeRef.current;
    const isDeleting = text.length < prev.length;
    
    if (isDeleting) {
      setDueTime(text);
    } else {
      let cleaned = text.replace(/[^0-9:]/g, '');
      const parts = cleaned.split(':').filter(p => p !== '');
      
      if (parts.length === 1 && parts[0].length >= 2 && !cleaned.includes(':')) {
        cleaned = parts[0].slice(0, 2) + ':' + parts[0].slice(2);
      }
      
      if (cleaned.length > 5) {
        cleaned = cleaned.slice(0, 5);
      }
      
      setDueTime(cleaned);
    }
    
    prevTimeRef.current = text;
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
    if (!dueDate) {
      Alert.alert('提示', '请输入截止日期');
      return;
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dueDate)) {
      Alert.alert('提示', '日期格式错误，请使用 YYYY-MM-DD 格式');
      return;
    }

    const dueDateTime = `${dueDate}T${dueTime || '23:59'}:00`;

    setLoading(true);
    try {
      await api.createTask({
        course_id: selectedCourse.id,
        title: title.trim(),
        description: description.trim() || undefined,
        due_time: dueDateTime,
      });
      // Success - go back immediately
      router.back();
    } catch (error: any) {
      Alert.alert('创建失败', error.message);
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
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

        {/* Due Date & Time */}
        <View style={styles.dateTimeRow}>
          <View style={styles.dateField}>
            <Text style={styles.fieldLabel}>截止日期</Text>
            <TextInput
              style={styles.dateInput}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#9ca3af"
              value={dueDate}
              onChangeText={handleDateChange}
              maxLength={10}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={styles.timeField}>
            <Text style={styles.fieldLabel}>时间</Text>
            <TextInput
              style={styles.timeInput}
              placeholder="HH:MM"
              placeholderTextColor="#9ca3af"
              value={dueTime}
              onChangeText={handleTimeChange}
              maxLength={5}
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>

        {/* Description */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>备注（可选）</Text>
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingTop: Platform.OS === 'ios' ? 60 : 16,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 24,
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
  dateTimeRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    gap: 12,
    marginBottom: 12,
  },
  dateField: {
    flex: 2,
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
  },
  timeField: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
  },
  dateInput: {
    fontSize: 16,
    color: '#1f2937',
    padding: 0,
  },
  timeInput: {
    fontSize: 16,
    color: '#1f2937',
    padding: 0,
  },
  descInput: {
    fontSize: 15,
    color: '#1f2937',
    minHeight: 80,
    padding: 0,
  },
});
