"""Initial migration - create all tables

Revision ID: 001_initial
Revises: 
Create Date: 2026-03-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Users table
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('nickname', sa.String(length=50), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('karma', sa.Integer(), nullable=False, default=0),
        sa.Column('role', sa.Enum('STUDENT', 'ADMIN', name='userrole'), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_users_email', 'users', ['email'], unique=True)
    
    # Courses table
    op.create_table(
        'courses',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('course_code', sa.String(length=50), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('name_abbr', sa.String(length=50), nullable=True),
        sa.Column('teacher', sa.String(length=100), nullable=False),
        sa.Column('semester', sa.String(length=20), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('course_code', 'teacher', 'semester', name='uq_course_teacher_semester')
    )
    op.create_index('ix_courses_course_code', 'courses', ['course_code'])
    op.create_index('ix_course_semester', 'courses', ['semester'])
    
    # User-Course association table
    op.create_table(
        'user_courses',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('course_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'course_id')
    )
    
    # Tasks table
    op.create_table(
        'tasks',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('course_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('due_time', sa.DateTime(), nullable=False),
        sa.Column('creator_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.Enum('PENDING', 'VERIFIED', 'HIDDEN', name='taskstatus'), nullable=False),
        sa.Column('upvotes', sa.Integer(), nullable=False, default=0),
        sa.Column('downvotes', sa.Integer(), nullable=False, default=0),
        sa.Column('is_reported', sa.Boolean(), nullable=False, default=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['creator_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_tasks_course_id', 'tasks', ['course_id'])
    op.create_index('ix_tasks_due_time', 'tasks', ['due_time'])
    op.create_index('ix_task_status_due', 'tasks', ['status', 'due_time'])
    
    # Task votes table
    op.create_table(
        'task_votes',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('task_id', sa.Integer(), nullable=False),
        sa.Column('vote_type', sa.Enum('UPVOTE', 'DOWNVOTE', name='votetype'), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'task_id')
    )


def downgrade() -> None:
    op.drop_table('task_votes')
    op.drop_table('tasks')
    op.drop_table('user_courses')
    op.drop_table('courses')
    op.drop_table('users')
    
    # Drop enums
    op.execute("DROP TYPE IF EXISTS votetype")
    op.execute("DROP TYPE IF EXISTS taskstatus")
    op.execute("DROP TYPE IF EXISTS userrole")
