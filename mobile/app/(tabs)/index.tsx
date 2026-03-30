import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../../src/services/api';
import { TaskCard } from '../../src/components/TaskCard';
import { Task, Course } from '../../src/types';

type FilterType = 'all' | 'overdue' | string; // string for course_id

export default function HomeScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [completedTasks, setCompletedTasks] = useState<Set<number>>(new Set());

  // Load saved filter and completed tasks
  useEffect(() => {
    const loadSavedState = async () => {
      try {
        // Restore filter from params or storage
        if (params.tab) {
          setFilter(params.tab);
        } else {
          const savedFilter = await AsyncStorage.getItem('ddl_filter');
          if (savedFilter) setFilter(savedFilter);
        }
        
        // Load completed tasks
        const saved = await AsyncStorage.getItem('completed_tasks');
        if (saved) setCompletedTasks(new Set(JSON.parse(saved)));
      } catch (e) {
        console.error('Failed to load saved state:', e);
      }
    };
    loadSavedState();
  }, [params.tab]);

  // Save filter when changed
  useEffect(() => {
    AsyncStorage.setItem('ddl_filter', filter);
  }, [filter]);

  // Load followed courses
  useEffect(() => {
    api.getFollowedCourses().then(setCourses).catch(console.error);
  }, []);

  const loadTasks = async () => {
    try {
      let data: Task[];
      
      if (filter === 'overdue') {
        data = await api.getOverdueTasks();
      } else if (filter.startsWith('course_')) {
        const courseId = parseInt(filter.replace('course_', ''));
        data = await api.getTasks({ course_id: courseId });
      } else {
        // 'all' - get all tasks from followed courses, 90 days
        data = await api.getMyDeadlines(90);
      }
      
      // Sort: overdue first (by due_time asc), then upcoming (by due_time asc)
      const now = new Date();
      data.sort((a, b) => {
        const aDate = new Date(a.due_time);
        const bDate = new Date(b.due_time);
        const aOverdue = aDate < now;
        const bOverdue = bDate < now;
        
        // Overdue items first
        if (aOverdue && !bOverdue) return -1;
        if (!aOverdue && bOverdue) return 1;
        
        // Within same category, sort by due time
        return aDate.getTime() - bDate.getTime();
      });
      
      setTasks(data);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadTasks();
    }, [filter])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTasks();
    setRefreshing(false);
  };

  const handleVote = async (taskId: number, type: 'upvote' | 'downvote') => {
    try {
      await api.voteTask(taskId, type);
      loadTasks();
    } catch (error) {
      console.error('Vote failed:', error);
    }
  };

  const toggleComplete = async (taskId: number) => {
    const newCompleted = new Set(completedTasks);
    if (newCompleted.has(taskId)) {
      newCompleted.delete(taskId);
    } else {
      newCompleted.add(taskId);
    }
    setCompletedTasks(newCompleted);
    await AsyncStorage.setItem('completed_tasks', JSON.stringify([...newCompleted]));
  };

  const FilterButton = ({ type, label }: { type: FilterType; label: string }) => (
    <TouchableOpacity
      style={[styles.filterBtn, filter === type && styles.filterBtnActive]}
      onPress={() => setFilter(type)}
    >
      <Text style={[styles.filterText, filter === type && styles.filterTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
          <View style={styles.filters}>
            <FilterButton type="all" label="全部" />
            <FilterButton type="overdue" label="已逾期" />
            {courses.map((course) => (
              <FilterButton 
                key={course.id} 
                type={`course_${course.id}`} 
                label={course.name_abbr || course.name} 
              />
            ))}
          </View>
        </ScrollView>
      </View>

      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <TaskCard
            task={item}
            onPress={() => router.push({ pathname: `/task/${item.id}`, params: { tab: filter } })}
            onVote={(type) => handleVote(item.id, type)}
            onComplete={() => toggleComplete(item.id)}
            isCompleted={completedTasks.has(item.id)}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🎉</Text>
              <Text style={styles.emptyText}>
                {filter === 'overdue' ? '没有逾期的DDL' : '暂无DDL，去关注课程吧'}
              </Text>
            </View>
          ) : null
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/task/create')}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  filtersScroll: {
    paddingVertical: 12,
  },
  filters: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
  },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
  },
  filterBtnActive: {
    backgroundColor: '#2563eb',
  },
  filterText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6b7280',
  },
  filterTextActive: {
    color: '#fff',
  },
  list: {
    padding: 16,
    paddingBottom: 100,
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
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  fabText: {
    fontSize: 28,
    color: '#fff',
    fontWeight: '300',
    marginTop: -2,
  },
});
