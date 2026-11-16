"""phase 1 foundation: audio duration and query indexes

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('media', schema=None) as batch_op:
        batch_op.add_column(sa.Column('duration_ms', sa.Integer(), nullable=True))

    with op.batch_alter_table('journal_entries', schema=None) as batch_op:
        batch_op.create_index('ix_journal_entries_owner_taken', ['owner_id', 'taken_at'], unique=False)

    with op.batch_alter_table('live_captures', schema=None) as batch_op:
        batch_op.create_index('ix_live_captures_media_id', ['media_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('live_captures', schema=None) as batch_op:
        batch_op.drop_index('ix_live_captures_media_id')

    with op.batch_alter_table('journal_entries', schema=None) as batch_op:
        batch_op.drop_index('ix_journal_entries_owner_taken')

    with op.batch_alter_table('media', schema=None) as batch_op:
        batch_op.drop_column('duration_ms')
