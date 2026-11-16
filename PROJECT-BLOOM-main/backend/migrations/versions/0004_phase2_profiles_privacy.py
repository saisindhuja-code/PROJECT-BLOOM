"""phase 2: user profiles, privacy settings and item visibility

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-16 01:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('bio', sa.String(length=500), nullable=False, server_default=''))
        batch_op.add_column(sa.Column('avatar_media_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('privacy_settings', sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
        batch_op.create_foreign_key(
            'fk_users_avatar_media_id', 'media', ['avatar_media_id'], ['id'], ondelete='SET NULL'
        )

    with op.batch_alter_table('flower_designs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('visibility', sa.String(length=12), nullable=False, server_default='private'))

    with op.batch_alter_table('albums', schema=None) as batch_op:
        batch_op.add_column(sa.Column('visibility', sa.String(length=12), nullable=False, server_default='private'))

    with op.batch_alter_table('journal_entries', schema=None) as batch_op:
        batch_op.add_column(sa.Column('visibility', sa.String(length=12), nullable=False, server_default='private'))


def downgrade() -> None:
    with op.batch_alter_table('journal_entries', schema=None) as batch_op:
        batch_op.drop_column('visibility')

    with op.batch_alter_table('albums', schema=None) as batch_op:
        batch_op.drop_column('visibility')

    with op.batch_alter_table('flower_designs', schema=None) as batch_op:
        batch_op.drop_column('visibility')

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_constraint('fk_users_avatar_media_id', type_='foreignkey')
        batch_op.drop_column('privacy_settings')
        batch_op.drop_column('avatar_media_id')
        batch_op.drop_column('bio')
