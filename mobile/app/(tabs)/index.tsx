import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { api } from '../../src/services/api';
import { TaskCard } from '../../src/components/TaskCard';
import { Task, Course } from '../../src/types';

type FilterType = 'all' | 'overdue' | string;

export default function HomeScreen() {
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [completedTasks, setCompletedTasks] = useState<Set<number>>(new Set());
  const initialLoadDone = useRef(false);

  const loadData = async () => {
    try {
      const [tasksData, coursesData, completedData] = await Promise.all([
        api.getMyDeadlines(90),
        api.getFollowedCourses(),
        api.getCompletedTasks(),
      ]);
      setAllTasks(tasksData);
      setCourses(coursesData);
      setCompletedTasks(new Set(completedData));
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Only load data once on mount
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      loadData();
    }
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleVote = async (taskId: number, type: 'upvote' | 'downvote') => {
    try {
      await api.voteTask(taskId, type);
      loadData();
    } catch (error) {
      console.error('Vote failed:', error);
    }
  };

  const toggleComplete = async (taskId: number) => {
    const newCompleted = new Set(completedTasks);
    const isCompleting = !newCompleted.has(taskId);
    
    if (isCompleting) {
      newCompleted.add(taskId);
    } else {
      newCompleted.delete(taskId);
    }
    setCompletedTasks(newCompleted);
    
    // Sync to server
    try {
      await api.setTaskCompleted(taskId, isCompleting);
    } catch (error) {
      console.error('Failed to sync completion status:', error);
    }
  };

  // Filter and sort tasks like Microsoft To Do
  const displayTasks = useMemo(() => {
    const now = new Date();
    let filtered = [...allTasks];

    // Apply filter
    if (filter === 'overdue') {
      // Only show overdue AND not completed
      filtered = filtered.filter(t => {
        const isOverdue = new Date(t.due_time) < now;
        const isCompleted = completedTasks.has(t.id);
        return isOverdue && !isCompleted;
      });
    } else if (filter.startsWith('course_')) {
      const courseId = parseInt(filter.replace('course_', ''));
      filtered = filtered.filter(t => t.course_id === courseId);
    }
    // 'all' shows everything

    // Sort: incomplete first (by due_time), then completed (by due_time)
    filtered.sort((a, b) => {
      const aCompleted = completedTasks.has(a.id);
      const bCompleted = completedTasks.has(b.id);
      
      // Completed tasks go to bottom
      if (aCompleted && !bCompleted) return 1;
      if (!aCompleted && bCompleted) return -1;
      
      // Within same completion status, sort by due time
      const aDate = new Date(a.due_time);
      const bDate = new Date(b.due_time);
      
      // For incomplete tasks: overdue first, then by due time
      if (!aCompleted && !bCompleted) {
        const aOverdue = aDate < now;
        const bOverdue = bDate < now;
        if (aOverdue && !bOverdue) return -1;
        if (!aOverdue && bOverdue) return 1;
      }
      
      return aDate.getTime() - bDate.getTime();
    });

    return filtered;
  }, [allTasks, filter, completedTasks]);

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

  // Count overdue (not completed)
  const overdueCount = useMemo(() => {
    const now = new Date();
    return allTasks.filter(t => 
      new Date(t.due_time) < now && !completedTasks.has(t.id)
    ).length;
  }, [allTasks, completedTasks]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header with tabs */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>我的 DDL</Text>
        <View style={styles.filters}>
          <FilterButton type="all" label="全部" />
          <FilterButton 
            type="overdue" 
            label={overdueCount > 0 ? `已逾期 (${overdueCount})` : '已逾期'} 
          />
        </View>
        {courses.length > 0 && (
          <View style={styles.courseFilters}>
            {courses.map((course) => (
              <FilterButton 
                key={course.id} 
                type={`course_${course.id}`} 
                label={course.name_abbr || course.name} 
              />
            ))}
          </View>
        )}
      </View>

      <FlatList
        data={displayTasks}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <TaskCard
            task={item}
            onPress={() => router.push(`/task/${item.id}`)}
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
              <Text style={styles.emptyIcon}>
                {filter === 'overdue' ? '✨' : '📋'}
              </Text>
              <Text style={styles.emptyText}>
                {filter === 'overdue' 
                  ? '没有逾期的任务，做得好！' 
                  : '暂无DDL，去关注课程吧'}
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
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: 16,
  },
  filters: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  courseFilters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
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
    textAlign: 'center',
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
