import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

// Web fallback for SecureStore
const storage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return AsyncStorage.getItem(key);
    }
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      await AsyncStorage.setItem(key, value);
    } else {
      await SecureStore.setItemAsync(key, value);
    }
  },
  async deleteItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      await AsyncStorage.removeItem(key);
    } else {
      await SecureStore.deleteItemAsync(key);
    }
  },
};

class ApiClient {
  private sessionId: string | null = null;

  async init() {
    this.sessionId = await storage.getItem('session_id');
  }

  hasStoredSession(): boolean {
    return this.sessionId !== null && this.sessionId !== '';
  }

  async setSession(sessionId: string) {
    this.sessionId = sessionId;
    await storage.setItem('session_id', sessionId);
  }

  async clearSession() {
    this.sessionId = null;
    await storage.deleteItem('session_id');
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.sessionId) {
      headers['Cookie'] = `session_id=${this.sessionId}`;
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include',
    });

    // Extract session cookie from response
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const match = setCookie.match(/session_id=([^;]+)/);
      if (match) {
        await this.setSession(match[1]);
      }
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: 'Request failed' }));
      throw new Error(error.detail || `HTTP ${res.status}`);
    }

    return res.json();
  }

  // Auth
  async sendVerificationCode(email: string) {
    return this.request<{ message: string }>('/api/auth/send-code', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async register(email: string, code: string, nickname: string, password: string) {
    return this.request<{ message: string; user: any }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, code, nickname, password }),
    });
  }

  async login(email: string, password: string) {
    return this.request<{ message: string; user: any }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async logout() {
    const result = await this.request<{ message: string }>('/api/auth/logout', {
      method: 'POST',
    });
    await this.clearSession();
    return result;
  }

  async getMe() {
    return this.request<any>('/api/auth/me');
  }

  async updateProfile(data: { nickname?: string; avatar_color?: string }) {
    return this.request<any>('/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async changePassword(oldPassword: string, newPassword: string) {
    return this.request<{ message: string }>('/api/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    });
  }

  // Courses
  async getCourses(params?: { q?: string; semester?: string }) {
    const query = new URLSearchParams(params as any).toString();
    return this.request<any[]>(`/api/courses${query ? `?${query}` : ''}`);
  }

  async getFollowedCourses() {
    return this.request<any[]>('/api/courses/followed');
  }

  async followCourse(courseId: number) {
    return this.request<{ message: string }>(`/api/courses/${courseId}/follow`, {
      method: 'POST',
    });
  }

  async unfollowCourse(courseId: number) {
    return this.request<{ message: string }>(`/api/courses/${courseId}/follow`, {
      method: 'DELETE',
    });
  }

  // Tasks
  async getTasks(params?: { course_id?: number; status?: string }) {
    const query = new URLSearchParams(params as any).toString();
    return this.request<any[]>(`/api/tasks${query ? `?${query}` : ''}`);
  }

  async getMyDeadlines(days: number = 7) {
    return this.request<any[]>(`/api/tasks/my-deadlines?days=${days}`);
  }

  async getOverdueTasks() {
    return this.request<any[]>('/api/tasks/overdue');
  }

  async getTask(taskId: number) {
    return this.request<any>(`/api/tasks/${taskId}`);
  }

  async createTask(data: {
    course_id: number;
    title: string;
    description?: string;
    due_time: string;
  }) {
    return this.request<any>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async voteTask(taskId: number, voteType: 'upvote' | 'downvote') {
    return this.request<any>(`/api/tasks/${taskId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ vote_type: voteType }),
    });
  }

  // Task completion
  async getCompletedTasks() {
    return this.request<number[]>('/api/tasks/completed/list');
  }

  async setTaskCompleted(taskId: number, completed: boolean) {
    if (completed) {
      return this.request<any>(`/api/tasks/${taskId}/complete`, {
        method: 'POST',
      });
    } else {
      return this.request<any>(`/api/tasks/${taskId}/complete`, {
        method: 'DELETE',
      });
    }
  }

  // Task Notes
  async getTaskNote(taskId: number) {
    return this.request<{ task_id: number; content: string; updated_at: string }>(
      `/api/tasks/${taskId}/note`
    );
  }

  async saveTaskNote(taskId: number, content: string) {
    return this.request<{ task_id: number; content: string; updated_at: string }>(
      `/api/tasks/${taskId}/note`,
      {
        method: 'PUT',
        body: JSON.stringify({ content }),
      }
    );
  }

  async deleteTaskNote(taskId: number) {
    return this.request<{ message: string }>(`/api/tasks/${taskId}/note`, {
      method: 'DELETE',
    });
  }

  // Edit Proposals
  async getEditProposals(taskId: number) {
    return this.request<any[]>(`/api/tasks/${taskId}/proposals`);
  }

  async createEditProposal(taskId: number, data: { new_description: string; reason?: string }) {
    return this.request<any>(`/api/tasks/${taskId}/proposals`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async voteProposal(taskId: number, proposalId: number, voteType: 'upvote' | 'downvote') {
    return this.request<any>(`/api/tasks/${taskId}/proposals/${proposalId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ vote_type: voteType }),
    });
  }
}

export const api = new ApiClient();
