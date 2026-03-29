export interface User {
  id: number;
  email: string;
  nickname: string;
  karma: number;
  role: 'student' | 'admin';
  created_at: string;
}

export interface Course {
  id: number;
  course_code: string;
  name: string;
  name_abbr?: string;
  teacher: string;
  semester: string;
  followers_count: number;
  is_followed?: boolean;
}

export interface Task {
  id: number;
  course_id: number;
  course_name: string;
  course_abbr?: string;
  title: string;
  description?: string;
  due_time: string;
  creator_id?: number;
  creator_nickname?: string;
  status: 'pending' | 'verified' | 'hidden';
  upvotes: number;
  downvotes: number;
  my_vote?: 'upvote' | 'downvote';
  is_reported?: boolean;
  created_at: string;
}

export interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}
