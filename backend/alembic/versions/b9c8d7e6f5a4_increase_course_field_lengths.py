"""increase_course_field_lengths

Revision ID: b9c8d7e6f5a4
Revises: a8b7c6d5e4f3
Create Date: 2026-04-04 22:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b9c8d7e6f5a4'
down_revision: Union[str, None] = 'a8b7c6d5e4f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Increase field sizes to accommodate longer data
    
    # class_name: 100 -> 200
    op.alter_column('courses', 'class_name', type_=sa.String(length=200), existing_nullable=True)
    
    # teacher: 100 -> 200 (多位教师)
    op.alter_column('courses', 'teacher', type_=sa.String(length=200), existing_nullable=False)
    
    # semester: 20 -> 50 (支持 "2025-2026学年 第2学期" 格式)
    op.alter_column('courses', 'semester', type_=sa.String(length=50), existing_nullable=False)
    
    # time_location: String(200) -> Text (无限制长度)
    op.alter_column('courses', 'time_location', type_=sa.Text(), existing_nullable=True)


def downgrade() -> None:
    # Revert field sizes
    op.alter_column('courses', 'time_location', type_=sa.String(length=200), existing_nullable=True)
    op.alter_column('courses', 'semester', type_=sa.String(length=20), existing_nullable=False)
    op.alter_column('courses', 'teacher', type_=sa.String(length=100), existing_nullable=False)
    op.alter_column('courses', 'class_name', type_=sa.String(length=100), existing_nullable=True)
