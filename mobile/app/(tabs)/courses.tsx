import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  StyleSheet,
  RefreshControl,
  SafeAreaView,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../../src/services/api';
import { CourseCard } from '../../src/components/CourseCard';
import { Course } from '../../src/types';

export default function CoursesScreen() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [semesters, setSemesters] = useState<string[]>([]);
  const [selectedSemester, setSelectedSemester] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showSemesterModal, setShowSemesterModal] = useState(false);

  const loadSemesters = async () => {
    try {
      const data = await api.getSemesters();
      setSemesters(data);
      // Auto-select the first (latest) semester if not already selected
      if (data.length > 0 && !selectedSemester) {
        setSelectedSemester(data[0]);
      }
    } catch (error) {
      console.error('Failed to load semesters:', error);
    }
  };

  const loadCourses = async (query?: string, semester?: string) => {
    try {
      const params: { q?: string; semester?: string } = {};
      if (query) params.q = query;
      if (semester) params.semester = semester;
      const data = await api.getCourses(Object.keys(params).length > 0 ? params : undefined);
      setCourses(data);
    } catch (error) {
      console.error('Failed to load courses:', error);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadSemesters();
    }, [])
  );

  useEffect(() => {
    if (selectedSemester !== undefined) {
      const timer = setTimeout(() => {
        loadCourses(search, selectedSemester);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [search, selectedSemester]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadCourses(search, selectedSemester);
    setRefreshing(false);
  };

  const handleFollow = async (course: Course) => {
    try {
      if (course.is_followed) {
        await api.unfollowCourse(course.id);
      } else {
        await api.followCourse(course.id);
      }
      loadCourses(search, selectedSemester);
    } catch (error) {
      console.error('Follow/unfollow failed:', error);
    }
  };

  const handleCoursePress = (course: Course) => {
    router.push(`/course/${course.id}`);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerContainer}>
        <TouchableOpacity 
          style={styles.semesterSelector}
          onPress={() => setShowSemesterModal(true)}
        >
          <Text style={styles.semesterLabel}>学期</Text>
          <Text style={styles.semesterValue}>
            {selectedSemester || '全部'}
            <Text style={styles.dropdownArrow}> ▼</Text>
          </Text>
        </TouchableOpacity>
        
        <TextInput
          style={styles.searchInput}
          placeholder="搜索课程名称、课号或教师..."
          placeholderTextColor="#9ca3af"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <FlatList
        data={courses}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <CourseCard
            course={item}
            onPress={() => handleCoursePress(item)}
            onFollow={() => handleFollow(item)}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📚</Text>
              <Text style={styles.emptyText}>未找到课程</Text>
            </View>
          ) : null
        }
      />

      <Modal
        visible={showSemesterModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSemesterModal(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowSemesterModal(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>选择学期</Text>
            <ScrollView style={styles.semesterList}>
              <TouchableOpacity
                style={[
                  styles.semesterItem,
                  !selectedSemester && styles.semesterItemActive
                ]}
                onPress={() => {
                  setSelectedSemester(undefined);
                  setShowSemesterModal(false);
                }}
              >
                <Text style={[
                  styles.semesterItemText,
                  !selectedSemester && styles.semesterItemTextActive
                ]}>全部学期</Text>
              </TouchableOpacity>
              {semesters.map((sem) => (
                <TouchableOpacity
                  key={sem}
                  style={[
                    styles.semesterItem,
                    selectedSemester === sem && styles.semesterItemActive
                  ]}
                  onPress={() => {
                    setSelectedSemester(sem);
                    setShowSemesterModal(false);
                  }}
                >
                  <Text style={[
                    styles.semesterItemText,
                    selectedSemester === sem && styles.semesterItemTextActive
                  ]}>{sem}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  headerContainer: {
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  semesterSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  semesterLabel: {
    fontSize: 14,
    color: '#6b7280',
    marginRight: 8,
  },
  semesterValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2563eb',
  },
  dropdownArrow: {
    fontSize: 12,
  },
  searchInput: {
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
  },
  list: {
    padding: 16,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    color: '#9ca3af',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '80%',
    maxHeight: '60%',
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 16,
    textAlign: 'center',
  },
  semesterList: {
    maxHeight: 300,
  },
  semesterItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 4,
  },
  semesterItemActive: {
    backgroundColor: '#eff6ff',
  },
  semesterItemText: {
    fontSize: 16,
    color: '#374151',
  },
  semesterItemTextActive: {
    color: '#2563eb',
    fontWeight: '600',
  },
});
