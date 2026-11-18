"""phase 7: scrapbook doc, page order, trash/restore and reusable stickers

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-18 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0007'
down_revision: Union[str, Sequence[str], None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('journal_entries', schema=None) as batch_op:
        batch_op.add_column(sa.Column('scrapbook_doc', sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        'stickers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=60), nullable=False),
        sa.Column('media_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['media_id'], ['media.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('stickers', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_stickers_media_id'), ['media_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_stickers_owner_id'), ['owner_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('stickers', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_stickers_owner_id'))
        batch_op.drop_index(batch_op.f('ix_stickers_media_id'))
    op.drop_table('stickers')

    with op.batch_alter_table('journal_entries', schema=None) as batch_op:
        batch_op.drop_column('deleted_at')
        batch_op.drop_column('sort_order')
        batch_op.drop_column('scrapbook_doc')
