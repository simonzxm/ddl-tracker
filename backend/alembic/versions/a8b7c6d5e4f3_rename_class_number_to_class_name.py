"""rename_class_number_to_class_name

Revision ID: a8b7c6d5e4f3
Revises: 1fe0cfdf2b89
Create Date: 2026-04-04 21:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a8b7c6d5e4f3'
down_revision: Union[str, None] = '1fe0cfdf2b89'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Rename class_number to class_name and change length from 20 to 100
    op.drop_constraint('uq_course_teacher_semester_class', 'courses', type_='unique')
    op.alter_column('courses', 'class_number', new_column_name='class_name', type_=sa.String(length=100))
    op.create_unique_constraint('uq_course_teacher_semester_class', 'courses', ['course_code', 'teacher', 'semester', 'class_name'])


def downgrade() -> None:
    # Rename class_name back to class_number and change length from 100 to 20
    op.drop_constraint('uq_course_teacher_semester_class', 'courses', type_='unique')
    op.alter_column('courses', 'class_name', new_column_name='class_number', type_=sa.String(length=20))
    op.create_unique_constraint('uq_course_teacher_semester_class', 'courses', ['course_code', 'teacher', 'semester', 'class_number'])
